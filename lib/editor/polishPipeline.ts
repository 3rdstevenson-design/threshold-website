/**
 * polishPipeline.ts
 *
 * Round-2 "Polish" pipeline, extracted from the original
 * `/api/editor/project/[slug]/polish/route.ts` so the unified
 * `/process` endpoint can invoke the same code without duplicating it.
 *
 * Phases (each emits `log`, `stage`, or other SSE events via `send`):
 *   1. loading       — read analysis.json + edit-plan.json
 *   2. detecting     — Claude disfluency pass OR load approved ranges
 *                      from the most recent disfluency-proposal.json
 *   3. polishing     — merge cuts → polished plan → write v2 artifacts
 *   4. concatenating — ffmpeg per-clip cut + concat demuxer → concat-v2.mp4
 *   5. rendering     — Remotion render EditsReelV2 → final-v2.mp4
 *   6. auditing      — spawn audit-render.ts → audit.json (Whisper drift)
 *   7. sync-auditing — NEW. Deepgram Nova-3 on final-v2 audio → drift.
 *   8. auto-correcting — NEW. If Deepgram drift > threshold, rewrite
 *                       caption timings, re-render, re-audit.
 *   9. promoting     — if overall audit passes, copy v2 → v1 slots.
 *
 * All heavy work is isolated to this module so it can be invoked from
 * multiple SSE endpoints with the same semantics.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  TAKES_ROOT,
  VIDEO_PROJECT_ROOT,
} from './paths';
import { readPlan } from './planStore';
import {
  editedDurationMs,
  type EditPlan,
  type Caption,
} from './editPlan';
import {
  DEFAULT_DISFLUENCY_MODEL,
  detectDisfluencies,
  disfluencyToRemoveRanges,
  type DisfluencyRange,
} from './disfluency';
import { buildPolishedPlan } from './polishPlan';
import { run, runStreaming } from './ffmpeg';
import { ffmpegProgress, remotionProgress, newRemotionState, expectedStageMs } from './progressParse';
import { readStageHistory, ReportWriter, type PipelineWarning } from './pipelineReport';
import { readProject, writeStatus } from './status';
import { decideAuditGate } from './auditGate';
import { buildConcatFilter, CONCAT_ENCODE_ARGS } from './concatFilter';
import { readReframeFile } from './reframe';
import type { Word } from './autoCut';
import {
  transcribeWithDeepgram,
  measureCaptionDrift,
  autoCorrectCaptions,
  rechunkFromDeepgram,
  type DeepgramWord,
} from './captionSync';

// ── Types ───────────────────────────────────────────────────────────

export type PolishStageName =
  | 'loading'
  | 'detecting'
  | 'polishing'
  | 'concatenating'
  | 'rendering'
  | 'auditing'
  | 'sync-auditing'
  | 'auto-correcting'
  | 'promoting'
  | 'done';

export type RunPolishStreamInput = {
  slug: string;
  /**
   * If provided, skip the Claude detection phase and load the most
   * recent `disfluency-proposal.json`, filtering its ranges to the
   * intersection of its `proposed` set and the approved ids.
   * `[]` means "the user reviewed but approved nothing" → render the
   * plan as-is with zero extra cuts.
   */
  approvedRangeIds: string[] | null;
  /** SSE emitter injected by the route. */
  send: (event: string, data: unknown) => void;
  /** Aborts the pipeline + kills spawned children on client disconnect. */
  signal?: AbortSignal;
  /** Open telemetry report from the calling pipeline (talking-head run). */
  report?: ReportWriter;
};

type AuditReport = {
  overallStatus: 'clean' | 'warn' | 'fail';
  gate?: { verdict: 'pass' | 'fail'; by: string; reason: string };
  structural: {
    ok: boolean;
    durationMs: number;
    expectedDurationMs: number;
    durationDeltaMs: number;
    errors: string[];
    warnings: string[];
  };
  drift: {
    maxDriftMs: number;
    meanDriftMs: number;
    warnCount: number;
    failCount: number;
    noMatchCount: number;
    perCaption: Array<{
      id: string;
      text: string;
      expectedStartMs: number;
      matchedStartMs: number | null;
      driftMs: number | null;
      status: 'ok' | 'warn' | 'fail' | 'no-match';
    }>;
  };
  /**
   * New in v2 — Deepgram-based sync audit. Populated after the
   * `sync-auditing` phase. Allows the UI / promote logic to make a
   * decision informed by an independent transcription engine.
   */
  deepgram?: {
    maxDriftMs: number;
    meanDriftMs: number;
    matchedCount: number;
    captionCount: number;
    autoCorrected: boolean;
    /** Number of captions whose timings were rewritten by auto-correct. */
    rewritten?: number;
  };
};

/** Deepgram caption-drift threshold above which auto-correct kicks in. */
const DEEPGRAM_DRIFT_THRESHOLD_MS = 150;

// If the pre-correct Deepgram pass saw every matched caption within this
// bound, a whisper-audit 'fail' that rests only on max drift is treated
// as whisper matcher noise and downgraded to 'warn' (see the veto before
// the promoting phase). Chunker lead (~150ms) + ASR jitter lands real,
// well-synced renders around 250-450ms here; genuine cumulative desync
// (the pre-2026-07-25 concat bug) ramped well past 600ms.
const DEEPGRAM_VETO_MS = 600;
/**
 * Only rewrite individual captions whose drift exceeds this. Lower than
 * the gate threshold so auto-correct can catch mid-sized drifts that
 * wouldn't trip the overall gate on their own.
 */
const AUTO_CORRECT_PER_CAPTION_MS = 80;

// ── Entry point ─────────────────────────────────────────────────────

export async function runPolishStream(input: RunPolishStreamInput): Promise<void> {
  const { slug, approvedRangeIds, send, signal } = input;
  const log = (msg: string) => send('log', { msg });
  const stageHistory = readStageHistory();
  const sourceSecForEta = readPlan(slug)?.sourceDuration ?? 0;
  const stage = (name: PolishStageName) =>
    send('stage', { name, expectedMs: expectedStageMs(name, sourceSecForEta, stageHistory) });
  const progress = (stageName: PolishStageName, pct: number) => send('progress', { stage: stageName, pct });
  // Telemetry + warnings. The caller may pass an open report (the talking-
  // head pipeline does) so stage timings for the whole run land in one file.
  const report = input.report ?? new ReportWriter(slug, { durationSec: sourceSecForEta || undefined });
  const warnings: PipelineWarning[] = [];
  const warn = (w: Omit<PipelineWarning, 'at'>) => {
    warnings.push(w);
    report.warn(w);
    send('warning', w);
    log(`⚠ ${w.message}`);
    writeStatus(slug, { warnings: [...(readProject(slug)?.warnings ?? []), { ...w, at: new Date().toISOString() }] });
  };
  const stageT = (name: PolishStageName) => { report.stage(name); stage(name); };

  const slugDir = path.join(TAKES_ROOT, slug);
  const publicSlugDir = path.join(VIDEO_PROJECT_ROOT, 'public', 'takes', slug);
  fs.mkdirSync(slugDir, { recursive: true });
  fs.mkdirSync(publicSlugDir, { recursive: true });

  const analysisPath = path.join(slugDir, 'analysis.json');
  const proposalPath = path.join(slugDir, 'disfluency-proposal.json');
  const polishedPlanPath = path.join(slugDir, 'polished-plan.json');
  const planV2Path = path.join(publicSlugDir, 'edits-plan-v2.json');
  const concatV2Path = path.join(publicSlugDir, 'concat-v2.mp4');
  const finalV2Path = path.join(slugDir, 'final-v2.mp4');
  const finalV2FailedPath = path.join(slugDir, 'final-v2-FAILED.mp4');
  const auditPath = path.join(slugDir, 'audit.json');
  const auditAudioPath = path.join(slugDir, 'audit.ogg');

  // ── Phase 1: loading ─────────────────────────────────────────────
  stageT('loading');
  const basePlan = readPlan(slug);
  if (!basePlan) throw new Error('no edit plan — run Analyze first');
  if (basePlan.clips.length === 0) throw new Error('edit plan has no clips');
  if (!fs.existsSync(analysisPath)) {
    throw new Error('analysis.json missing — run Analyze first');
  }
  const analysisRaw = JSON.parse(fs.readFileSync(analysisPath, 'utf8')) as {
    words?: Word[];
  };
  const words: Word[] = analysisRaw.words ?? [];
  if (words.length === 0) {
    throw new Error('analysis.json has no words — re-run Analyze');
  }
  log(`Loaded ${words.length} words and ${basePlan.clips.length} clip(s).`);

  // ── Phase 2: detecting (or approve-from-proposal) ────────────────
  stageT('detecting');
  let ranges: DisfluencyRange[] = [];
  if (approvedRangeIds !== null) {
    if (!fs.existsSync(proposalPath)) {
      throw new Error(
        'approvedRangeIds provided but disfluency-proposal.json missing — run Preview cuts first',
      );
    }
    const prop = JSON.parse(fs.readFileSync(proposalPath, 'utf8')) as {
      proposed: DisfluencyRange[];
    };
    const approvedSet = new Set(approvedRangeIds);
    ranges = (prop.proposed ?? []).filter(
      (r) => approvedSet.has(r.id) && !r.rejected,
    );
    log(
      `Using ${ranges.length} user-approved range(s) from prior proposal ` +
        `(out of ${approvedRangeIds.length} approved, ${prop.proposed?.length ?? 0} proposed).`,
    );
  } else {
    // The LLM pass is an enhancement layer on top of the deterministic cuts.
    // When it can't run (no key, out of credits, 5xx after retries) the
    // reel still ships with rule-based cuts and a visible warning — it used
    // to fail the whole run ("credit balance too low", 2026-08-25).
    const apiKey = process.env.ANTHROPIC_API_KEY;
    let result: Awaited<ReturnType<typeof detectDisfluencies>> | null = null;
    if (!apiKey) {
      warn({ stage: 'detecting', code: 'llm-unavailable', message: 'ANTHROPIC_API_KEY not configured — skipped the Claude disfluency pass; rule-based cuts only.' });
    } else {
      try {
        result = await detectDisfluencies({ words, clips: basePlan.clips, apiKey, onLog: log });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        warn({ stage: 'detecting', code: 'llm-unavailable', message: `Claude disfluency pass failed (${msg.slice(0, 160)}) — rule-based cuts only.` });
      }
    }
    ranges = result?.ranges ?? [];
    const rejectedByKind: Record<string, number> = {};
    for (const r of result?.proposed ?? []) if (r.rejected) rejectedByKind[r.kind] = (rejectedByKind[r.kind] ?? 0) + 1;
    report.merge('disfluency', {
      model: result ? DEFAULT_DISFLUENCY_MODEL : null,
      proposed: result?.proposed.length ?? 0,
      kept: ranges.length,
      rejectedByKind,
      ...(result ? {} : { error: warnings.find((w) => w.code === 'llm-unavailable')?.message }),
    });
    // Persist proposal for observability / re-approval.
    if (result) {
      try {
        fs.writeFileSync(
          proposalPath,
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              wordCount: result.wordCount,
              scopedSeconds: result.scopedSeconds,
              proposed: result.proposed,
              keptIds: result.ranges.map((r) => r.id),
              raw: result.raw,
            },
            null,
            2,
          ),
        );
      } catch (e) {
        log(`(non-fatal) failed to persist disfluency-proposal.json: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // ── Phase 3: polishing (build polished plan + write v2 artifacts) ─
  stageT('polishing');
  const extraSkipRanges = disfluencyToRemoveRanges(ranges);
  const { plan: polishedPlan, stats } = buildPolishedPlan({
    basePlan,
    words,
    extraSkipRanges,
  });
  if (polishedPlan.clips.length === 0) {
    throw new Error('polished plan has no clips — check inputs');
  }
  fs.writeFileSync(polishedPlanPath, JSON.stringify(polishedPlan, null, 2));
  fs.writeFileSync(
    planV2Path,
    JSON.stringify(
      { ...polishedPlan, editedDurationMs: editedDurationMs(polishedPlan) },
      null,
      2,
    ),
  );
  log(
    `Polished plan: ${stats.clipCount} clip(s), ` +
      `+${stats.extraRanges} extra cuts, ` +
      `-${stats.extraSecondsRemoved.toFixed(2)}s over base.`,
  );

  // ── Phase 4: concatenating ───────────────────────────────────────
  stageT('concatenating');
  const sourceAbs = path.resolve(VIDEO_PROJECT_ROOT, polishedPlan.sourceVideo);
  if (!fs.existsSync(sourceAbs)) {
    throw new Error(`source missing: ${polishedPlan.sourceVideo}`);
  }
  // Single-pass trim+concat via filter_complex — one continuous encode.
  //
  // The previous shape (cut each clip to its own AAC-encoded mp4, then
  // `concat -c copy`) accumulated audio error at every splice: each AAC
  // segment carries ~21-42ms of encoder priming and rounds its length up
  // to whole 1024-sample frames, and stream-copy concat stitches those
  // artifacts end to end. On a 25-cut talking-head reel the captions
  // drifted progressively ~100ms → ~900ms across the timeline (audit
  // maxDrift 1440ms) and the render came out +292ms over plan. One
  // filter-graph pass encodes audio as ONE continuous stream, so there
  // are no per-boundary artifacts to accumulate.
  {
    const clips = polishedPlan.clips;
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      log(
        `  clip ${i + 1}/${clips.length}: ` +
          `${c.sourceStart.toFixed(2)}s → ${c.sourceEnd.toFixed(2)}s ` +
          `(${(c.sourceEnd - c.sourceStart).toFixed(2)}s)`,
      );
    }
    const graph = buildConcatFilter(clips, { reframe: readReframeFile(path.join(slugDir, 'reframe.json')) });

    log('Cutting + concatenating v2 clips (single pass)…');
    const totalMs = editedDurationMs(polishedPlan);
    let lastPct = -1;
    const rConcat = await runStreaming('ffmpeg', [
      '-y',
      '-i', sourceAbs,
      '-filter_complex', graph.filterComplex,
      '-map', graph.videoLabel, '-map', graph.audioLabel,
      ...CONCAT_ENCODE_ARGS,
      '-progress', 'pipe:1', '-nostats',
      concatV2Path,
    ], (line) => {
      const pct = ffmpegProgress(line, totalMs);
      if (pct !== null && pct !== lastPct) { lastPct = pct; progress('concatenating', pct); }
    }, { signal });
    if (rConcat.code !== 0) {
      throw new Error(`ffmpeg trim+concat failed: ${rConcat.stderr.slice(-300)}`);
    }
    log(`Concat → ${path.relative(VIDEO_PROJECT_ROOT, concatV2Path)}`);
  }

  // ── Phase 5: rendering (Remotion) ────────────────────────────────
  stageT('rendering');
  await renderV2({ slug, finalV2Path, log, signal, onProgress: (pct) => progress('rendering', pct) });

  // ── Phase 6: auditing (Whisper drift) ────────────────────────────
  stageT('auditing');
  const auditReport = await runAuditRender({ slug, log, signal });

  // ── Phase 7: sync-auditing (Deepgram) ────────────────────────────
  stageT('sync-auditing');
  const deepgramKey = process.env.DEEPGRAM_API_KEY;
  let dgWords: DeepgramWord[] = [];
  let dgReport: AuditReport['deepgram'] = undefined;
  // The PRE-correct Deepgram measurement — captions from the edit plan vs
  // Nova-3's transcription of the rendered audio. Unlike the post-correct
  // number (captions rebuilt FROM Deepgram words, so near-tautological),
  // this one genuinely cross-checks render sync, and it's what the
  // whisper-gate veto below keys on.
  let preCorrectDg: { maxDriftMs: number; meanDriftMs: number; matchedCount: number; captionCount: number } | null = null;
  if (!deepgramKey) {
    log('DEEPGRAM_API_KEY not set — skipping sync-audit layer.');
  } else {
    try {
      log('Extracting audio for Deepgram…');
      // ALWAYS force a fresh extract. force=false once reused a stale
      // audit.ogg left by an interrupted earlier run of the same slug —
      // a transcription of a DIFFERENT edit timeline — and the rechunk
      // then baked ~10s of phantom retake text into the captions
      // (2026-07-25: 19-00-03 and 19-10-51 failed audit twice this way).
      await ensureAuditAudio(finalV2Path, auditAudioPath, /*force*/ true, signal);
      log('Transcribing with Deepgram Nova-3…');
      const audio = fs.readFileSync(auditAudioPath);
      const dgRes = await transcribeWithDeepgram(audio, deepgramKey, {
        contentType: 'audio/ogg',
        signal,
        onLog: log,
      });
      dgWords = dgRes.words;
      log(`Deepgram returned ${dgWords.length} word(s).`);
      const captionsNow = readV2Captions(planV2Path);
      const drift = measureCaptionDrift(captionsNow, dgWords);
      preCorrectDg = {
        maxDriftMs: drift.maxDriftMs,
        meanDriftMs: drift.meanDriftMs,
        matchedCount: drift.matchedCount,
        captionCount: drift.captionCount,
      };
      dgReport = {
        maxDriftMs: drift.maxDriftMs,
        meanDriftMs: drift.meanDriftMs,
        matchedCount: drift.matchedCount,
        captionCount: drift.captionCount,
        autoCorrected: false,
      };
      log(
        `Deepgram drift: max=${drift.maxDriftMs}ms mean=${drift.meanDriftMs}ms ` +
          `(${drift.matchedCount}/${drift.captionCount} matched).`,
      );
    } catch (e) {
      log(
        `(non-fatal) Deepgram sync-audit failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  // ── Phase 8: auto-correcting ─────────────────────────────────────
  if (dgReport && dgReport.maxDriftMs > DEEPGRAM_DRIFT_THRESHOLD_MS) {
    const report = dgReport;
    stageT('auto-correcting');
    log(
      `Drift ${report.maxDriftMs}ms > ${DEEPGRAM_DRIFT_THRESHOLD_MS}ms — ` +
        'running caption auto-correct.',
    );
    const captionsNow = readV2Captions(planV2Path);
    const auto = autoCorrectCaptions(captionsNow, dgWords, {
      driftThresholdMs: AUTO_CORRECT_PER_CAPTION_MS,
    });
    log(
      `Auto-correct rewrote ${auto.rewritten}, left ${auto.untouched} untouched.`,
    );
    // Re-chunk from Deepgram so caption TEXT matches the rendered audio.
    // autoCorrect only fixes timing — if a caption's text dropped or
    // gained words vs what was actually spoken (which is exactly the
    // failure mode that produced the 1135ms Whisper drift), rechunk
    // replaces the text with what Deepgram heard. customSpellings carry
    // through so user-defined fixes (e.g. Coach Cav → Coach Kav) survive.
    const polishedOnDisk = JSON.parse(
      fs.readFileSync(polishedPlanPath, 'utf8'),
    ) as EditPlan;
    const rechunked = rechunkFromDeepgram(dgWords, {
      customSpellings: polishedOnDisk.customSpellings,
    });
    log(
      `Re-chunked from Deepgram: ${rechunked.length} caption(s) ` +
        `(was ${captionsNow.length}).`,
    );
    if (rechunked.length > 0 || auto.rewritten > 0) {
      // Write updated captions back to BOTH plans — polished-plan.json
      // (source of truth for the editor) and edits-plan-v2.json
      // (Remotion's input) stay in sync. Prefer rechunked when available.
      polishedOnDisk.captions = rechunked.length > 0 ? rechunked : auto.captions;
      fs.writeFileSync(polishedPlanPath, JSON.stringify(polishedOnDisk, null, 2));
      fs.writeFileSync(
        planV2Path,
        JSON.stringify(
          { ...polishedOnDisk, editedDurationMs: editedDurationMs(polishedOnDisk) },
          null,
          2,
        ),
      );
      // Re-render with new caption timings (concat stays the same — only
      // the Remotion overlay changes).
      log('Re-rendering with corrected caption timings…');
      await renderV2({ slug, finalV2Path, log, signal, onProgress: (pct) => progress('rendering', pct) });
      // Re-run the Whisper audit so the overall status reflects the new
      // render. Overwrites audit.json in place.
      stageT('auditing');
      const reAudit = await runAuditRender({ slug, log, signal });
      auditReport.overallStatus = reAudit.overallStatus;
      auditReport.structural = reAudit.structural;
      auditReport.drift = reAudit.drift;
      // Re-measure Deepgram drift for the final audit record.
      if (deepgramKey) {
        try {
          await ensureAuditAudio(finalV2Path, auditAudioPath, /*force*/ true, signal);
          const audio = fs.readFileSync(auditAudioPath);
          const dgRes2 = await transcribeWithDeepgram(audio, deepgramKey, {
            contentType: 'audio/ogg',
            signal,
            onLog: log,
          });
          const finalCaptions = polishedOnDisk.captions ?? auto.captions;
          const drift2 = measureCaptionDrift(finalCaptions, dgRes2.words);
          dgReport = {
            maxDriftMs: drift2.maxDriftMs,
            meanDriftMs: drift2.meanDriftMs,
            matchedCount: drift2.matchedCount,
            captionCount: drift2.captionCount,
            autoCorrected: true,
            rewritten: auto.rewritten,
          };
          log(
            `Post-correct Deepgram drift: max=${drift2.maxDriftMs}ms ` +
              `mean=${drift2.meanDriftMs}ms.`,
          );
        } catch (e) {
          log(
            `(non-fatal) re-measure failed: ${e instanceof Error ? e.message : e}`,
          );
          report.autoCorrected = true;
          report.rewritten = auto.rewritten;
        }
      } else {
        report.autoCorrected = true;
        report.rewritten = auto.rewritten;
      }
    }
  }

  // Merge Deepgram report into audit.json for downstream consumers.
  if (dgReport) {
    auditReport.deepgram = dgReport;
    try {
      fs.writeFileSync(auditPath, JSON.stringify(auditReport, null, 2));
    } catch (e) {
      log(
        `(non-fatal) failed to rewrite audit.json: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  // ── Gate decision: Deepgram primary, whisper advisory ────────────
  // (Replaces the older "Deepgram veto" special case: whisper.cpp small.en
  // produced isolated 1000ms+ spikes on disfluent regions that Nova-3 put
  // at ~200ms, and whisper's per-caption 150ms warn bar sat exactly on the
  // caption lead-in, so 18 of 28 in-sync renders were dead-ended as
  // final-v2-FAILED.mp4. See auditGate.ts for the policy.)
  const gate = decideAuditGate({
    deepgram: dgReport
      ? { maxDriftMs: dgReport.maxDriftMs, meanDriftMs: dgReport.meanDriftMs, matchedCount: dgReport.matchedCount, captionCount: dgReport.captionCount }
      : null,
    whisper: {
      overallStatus: auditReport.overallStatus,
      structuralOk: auditReport.structural.ok,
      meanDriftMs: auditReport.drift?.meanDriftMs ?? null,
      maxDriftMs: auditReport.drift?.maxDriftMs ?? null,
    },
  });
  log(`Audit gate: ${gate.verdict.toUpperCase()} by ${gate.by} — ${gate.reason}`);
  report.merge('audit', {
    deepgramPre: preCorrectDg,
    deepgramPost: dgReport?.autoCorrected ? { maxDriftMs: dgReport.maxDriftMs, meanDriftMs: dgReport.meanDriftMs, matchedCount: dgReport.matchedCount, captionCount: dgReport.captionCount } : null,
    whisper: { status: auditReport.overallStatus, meanDriftMs: auditReport.drift?.meanDriftMs, maxDriftMs: auditReport.drift?.maxDriftMs },
    gate: { verdict: gate.verdict, by: gate.by === 'structural' ? 'none' : gate.by, reason: gate.reason },
  });
  auditReport.gate = gate;
  // The whisper overallStatus is what the UI badge shows; align it with
  // the gate so a Deepgram pass never reads as "fail" in the editor.
  if (gate.verdict === 'pass' && auditReport.overallStatus === 'fail') auditReport.overallStatus = 'warn';
  if (gate.verdict === 'fail') auditReport.overallStatus = 'fail';
  try { fs.writeFileSync(auditPath, JSON.stringify(auditReport, null, 2)); } catch {}

  // ── Phase 9: promoting ───────────────────────────────────────────
  stageT('promoting');
  const promoted = maybePromote({
    slug,
    auditReport,
    polishedPlanPath,
    finalV2Path,
    finalV2FailedPath,
    concatV2Path,
    planV2Path,
    log,
  });

  // ── Done ─────────────────────────────────────────────────────────
  stageT('done');
  const reviewNow = readProject(slug)?.review ?? null;
  if (reviewNow?.required) send('review-required', { reasons: reviewNow.reasons });
  report.finish({ promoted, review: { paused: !!reviewNow?.required, reasons: reviewNow?.reasons ?? [] } });
  send('audit', summarizeAudit(auditReport, promoted));
  send('done', {
    ok: true,
    overallStatus: auditReport.overallStatus,
    promoted,
    review: reviewNow?.required ? reviewNow : null,
    warnings,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

async function renderV2(input: {
  slug: string;
  finalV2Path: string;
  log: (msg: string) => void;
  signal?: AbortSignal;
  onProgress?: (pct: number) => void;
}): Promise<void> {
  const inputProps = JSON.stringify({ slug: input.slug });
  const remo = newRemotionState();
  let lastPct = -1;
  const r = await runStreaming(
    'npx',
    [
      'remotion',
      'render',
      'EditsReelV2',
      input.finalV2Path,
      '--props',
      inputProps,
    ],
    (line) => {
      input.log(line);
      const pct = remotionProgress(remo, line);
      if (pct !== null && pct !== lastPct) { lastPct = pct; input.onProgress?.(pct); }
    },
    { cwd: VIDEO_PROJECT_ROOT, signal: input.signal },
  );
  if (r.code !== 0) {
    throw new Error(`remotion render failed with code ${r.code}`);
  }
  input.log(
    `Final-v2: ${path.relative(VIDEO_PROJECT_ROOT, input.finalV2Path)}`,
  );
}

async function runAuditRender(input: {
  slug: string;
  log: (msg: string) => void;
  signal?: AbortSignal;
}): Promise<AuditReport> {
  const slugDir = path.join(TAKES_ROOT, input.slug);
  const auditPath = path.join(slugDir, 'audit.json');
  const r = await runStreaming(
    'npx',
    ['tsx', 'scripts/audit-render.ts', input.slug],
    input.log,
    { cwd: VIDEO_PROJECT_ROOT, signal: input.signal },
  );
  // audit-render exits 0/1/2 for clean/warn/fail — all produce audit.json.
  if (!fs.existsSync(auditPath)) {
    throw new Error(`audit.json missing after audit-render (code ${r.code})`);
  }
  const report = JSON.parse(fs.readFileSync(auditPath, 'utf8')) as AuditReport;
  return report;
}

/**
 * Extract a 16 kHz mono WAV from the rendered video. Used as the input
 * to Deepgram. If `force` is true, the existing file is overwritten
 * even if it already exists (used after re-render).
 */
// Opus 32k, not WAV — raw PCM bodies hit Deepgram's upload window
// (408 SLOW_UPLOAD) past ~1 minute of audio. Deliberately no loudnorm
// here (unlike the ingest extract): drift is measured against the
// rendered mix as-is, and adding normalization would change timings vs.
// the historical audit baseline.
async function ensureAuditAudio(
  videoPath: string,
  audioPath: string,
  force = false,
  signal?: AbortSignal,
): Promise<void> {
  if (!force && fs.existsSync(audioPath)) return;
  const r = await run('ffmpeg', [
    '-y',
    '-i', videoPath,
    '-vn',
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip',
    audioPath,
  ], { signal });
  if (r.code !== 0) {
    throw new Error(`ffmpeg audio extract failed: ${r.stderr.slice(-300)}`);
  }
}

function readV2Captions(planV2Path: string): Caption[] {
  const raw = JSON.parse(fs.readFileSync(planV2Path, 'utf8')) as {
    captions?: Caption[];
  };
  return raw.captions ?? [];
}

function maybePromote(input: {
  slug: string;
  auditReport: AuditReport;
  polishedPlanPath: string;
  finalV2Path: string;
  finalV2FailedPath: string;
  concatV2Path: string;
  planV2Path: string;
  log: (msg: string) => void;
}): boolean {
  const { auditReport, log } = input;
  if (auditReport.overallStatus === 'fail') {
    // Keep final-v2.mp4 under its own name (no more silent -FAILED rename)
    // and park the project in needs-review so the failure is visible and
    // one tap away from "Approve & promote".
    log('Audit gate failed — keeping final-v2.mp4 for review; not promoting.');
    try { if (fs.existsSync(input.finalV2FailedPath)) fs.unlinkSync(input.finalV2FailedPath); } catch {}
    const reason = auditReport.gate?.reason ?? 'audit failed';
    const prev = readProject(input.slug)?.review;
    writeStatus(input.slug, {
      review: {
        required: true,
        reasons: [...(prev?.required ? prev.reasons.filter((r) => r.code !== 'audit-fail') : []), { code: 'audit-fail', detail: reason }],
        createdAt: prev?.required ? prev.createdAt : new Date().toISOString(),
      },
    });
    return false;
  }

  const slugDir = path.join(TAKES_ROOT, input.slug);
  const publicSlugDir = path.join(VIDEO_PROJECT_ROOT, 'public', 'takes', input.slug);
  const finalV1Path = path.join(slugDir, 'final.mp4');
  const editPlanV1Path = path.join(slugDir, 'edit-plan.json');
  const editPlanBackupPath = path.join(slugDir, 'edit-plan.pre-polish.json');
  const concatV1Path = path.join(publicSlugDir, 'concat.mp4');
  const editsPlanV1Path = path.join(publicSlugDir, 'edits-plan.json');

  try {
    if (fs.existsSync(editPlanV1Path)) {
      fs.copyFileSync(editPlanV1Path, editPlanBackupPath);
    }
    const polished = fs.readFileSync(input.polishedPlanPath, 'utf8');
    fs.writeFileSync(editPlanV1Path, polished);
    if (fs.existsSync(finalV1Path)) fs.unlinkSync(finalV1Path);
    fs.renameSync(input.finalV2Path, finalV1Path);
    if (fs.existsSync(concatV1Path)) fs.unlinkSync(concatV1Path);
    fs.renameSync(input.concatV2Path, concatV1Path);
    if (fs.existsSync(editsPlanV1Path)) fs.unlinkSync(editsPlanV1Path);
    fs.renameSync(input.planV2Path, editsPlanV1Path);
    log(`Promoted v2 → v1 (status=${auditReport.overallStatus}).`);
    return true;
  } catch (e) {
    log(
      `(non-fatal) promote failed: ${e instanceof Error ? e.message : e} — v2 artifacts retained.`,
    );
    return false;
  }
}

function summarizeAudit(report: AuditReport, promoted: boolean) {
  return {
    status: report.overallStatus,
    maxDriftMs: report.drift?.maxDriftMs ?? 0,
    meanDriftMs: report.drift?.meanDriftMs ?? 0,
    failCount: report.drift?.failCount ?? 0,
    warnCount: report.drift?.warnCount ?? 0,
    captionCount: report.drift?.perCaption?.length ?? 0,
    promoted,
    deepgram: report.deepgram ?? null,
  };
}
