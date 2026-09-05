/**
 * talkingHeadPipeline.ts
 *
 * Extracted from /api/editor/project/[slug]/process so the pipeline can
 * also be invoked directly (without an internal HTTP fetch) by the
 * /extract-clips route when a long-form clip is promoted to a child
 * talking-head project.
 *
 * The shape mirrors runLongFormPipeline(): caller provides a `send`
 * function that emits SSE events; this module emits `stage`, `log`, and
 * `stage-stats` events as each phase runs.
 *
 * Phases (in order):
 *   preparing      bootstrap
 *   transcribing   whisper word-level + silence detect (skippable)
 *   silences       remove ≥ 0.5s gaps
 *   fillers        remove filler words from post-silence timeline
 *   stutters       remove stutters/repeats/partial words
 *   captioning     chunkCaptions over surviving clips
 *   [polish...]    round-2 polish pipeline (Claude disfluency + audit)
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

import { TAKES_ROOT, VIDEO_PROJECT_ROOT } from './paths';
import { probeDurationSec, killOnAbort } from './ffmpeg';
import { readPlan, writePlan } from './planStore';
import { applyAction, createPlan, type EditPlan } from './editPlan';
import { type Silence, type Word } from './autoCut';
import { runCutStages } from './cutPipeline';
import { chunkCaptions } from './captionChunker';
import { writeStatus } from './status';
import { runPolishStream } from './polishPipeline';
import { ingestProgress, expectedStageMs } from './progressParse';
import { readStageHistory } from './pipelineReport';

export type SendFn = (event: string, data: unknown) => void;

export type RunTalkingHeadInput = {
  slug: string;
  sourceAbsPath: string;
  send: SendFn;
  /** Reuse existing analysis.json instead of re-running Whisper. */
  skipTranscribe?: boolean;
  /** Forwarded to the polish stage. `null` = auto; `[]` = reviewed→none. */
  approvedRangeIds?: string[] | null;
  /** Aborts the whole pipeline + kills spawned children on client disconnect. */
  signal?: AbortSignal;
};

export async function runTalkingHeadPipeline(input: RunTalkingHeadInput): Promise<void> {
  const { slug, sourceAbsPath, send, skipTranscribe, approvedRangeIds, signal } = input;
  const log = (msg: string) => send('log', { msg });
  const stageHistory = readStageHistory();
  let sourceSecForEta = 0;
  const stage = (name: string) =>
    send('stage', { name, expectedMs: expectedStageMs(name, sourceSecForEta, stageHistory) });

  try { sourceSecForEta = await probeDurationSec(sourceAbsPath); } catch { /* fallback ratios */ }
  stage('preparing');
  log(`Processing ${slug}\u2026`);

  // ── Phase: transcribing (or skip) ─────────────────────────────────
  const analysisPath = path.join(TAKES_ROOT, slug, 'analysis.json');
  if (skipTranscribe && fs.existsSync(analysisPath)) {
    log('Reusing existing analysis.json (skipTranscribe).');
  } else {
    stage('transcribing');
    await runIngest({
      slug,
      sourceRel: path.relative(VIDEO_PROJECT_ROOT, sourceAbsPath),
      onLog: (line) => {
        log(line);
        const pct = ingestProgress(line);
        if (pct !== null) send('progress', { stage: 'transcribing', pct });
      },
      signal,
    });
  }
  if (!fs.existsSync(analysisPath)) {
    throw new Error('transcribe finished but analysis.json is missing');
  }
  const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf-8')) as {
    duration: number;
    words: Word[];
    silences: Silence[];
  };
  const words = analysis.words ?? [];
  const silences = analysis.silences ?? [];
  if (words.length === 0) {
    throw new Error('analysis.json has no words \u2014 audio may be silent or too short');
  }

  // Make sure there's a plan to mutate. If none exists yet, bootstrap one.
  let plan = readPlan(slug);
  if (!plan) {
    const duration = analysis.duration || (await probeDurationSec(sourceAbsPath));
    plan = createPlan({
      slug,
      sourceVideo: path.relative(VIDEO_PROJECT_ROOT, sourceAbsPath),
      sourceDuration: duration,
    });
    writePlan(plan);
  }

  // ── Phases: silences → fillers → stutters → retakes ──────────────
  // The four detection stages live in cutPipeline.ts (shared with the
  // client-side "Analyze audio" re-run so both cut identically). Tuning
  // comes from plan.cutSettings; the removed ranges land on plan.cutLog
  // so the timeline can mark removed segments by reason.
  const cut = runCutStages({
    duration: plan.sourceDuration,
    words,
    silences,
    fillerWords: plan.fillerWords,
    settings: plan.cutSettings,
    onStage: (name, stats) => {
      stage(name);
      send('stage-stats', { stage: name, stats });
    },
  });
  log(`Silences: ${cut.stages.silences.cutCount} cut · -${cut.stages.silences.secondsRemoved.toFixed(2)}s.`);
  log(`Fillers: ${cut.stages.fillers.cutCount} cut · -${cut.stages.fillers.secondsRemoved.toFixed(2)}s.`);
  log(
    `Stutters: ${cut.stages.stutters.phrasesRemoved} phrase(s), ` +
      `${cut.stages.stutters.singleWordsRemoved} single-word, ` +
      `${cut.stages.stutters.fragmentsRemoved} fragment(s) · ` +
      `-${cut.stages.stutters.secondsRemoved.toFixed(2)}s.`,
  );
  log(
    `Retakes: ${cut.stages.retakes.groupsFound} group(s), ` +
      `${cut.stages.retakes.cutCount} cut · ` +
      `-${cut.stages.retakes.secondsRemoved.toFixed(2)}s` +
      (cut.stages.retakes.flaggedGroups > 0
        ? ` · ${cut.stages.retakes.flaggedGroups} flagged for review`
        : ''),
  );

  let workingPlan: EditPlan = applyAction(plan, {
    type: 'auto_cut',
    params: { clips: cut.clips, stats: cut.stats },
  });
  workingPlan = { ...workingPlan, retakeGroups: cut.retakeGroups, cutLog: cut.cutLog };

  // ── Phase: captioning ────────────────────────────────────────────
  stage('captioning');
  const captions = chunkCaptions(words, workingPlan.clips, {
    customSpellings: workingPlan.customSpellings ?? [],
  });
  workingPlan = applyAction(workingPlan, {
    type: 'generate_captions',
    params: { captions },
  });
  writePlan(workingPlan);
  log(`Captions: ${captions.length} chunk(s) over ${workingPlan.clips.length} clip(s).`);

  // ── Phase: polish ────────────────────────────────────────────────
  await runPolishStream({
    slug,
    approvedRangeIds: approvedRangeIds ?? null,
    send,
    signal,
  });

  writeStatus(slug, { error: null });
}

/**
 * Spawn scripts/ingest-takes.ts inside the video-projects checkout to
 * produce analysis.json. Shared with longFormPipeline.ts \u2014 both
 * pipelines start from this step.
 */
function runIngest(input: {
  slug: string;
  sourceRel: string;
  onLog: (msg: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (input.signal?.aborted) { reject(new Error('aborted')); return; }
    const proc = spawn(
      'npx',
      ['tsx', 'scripts/ingest-takes.ts', input.sourceRel, '--slug', input.slug],
      { cwd: VIDEO_PROJECT_ROOT, detached: true },
    );
    const cleanup = killOnAbort(proc, input.signal);
    // Keep the tail of the child's output so a failure surfaces the real
    // reason (e.g. "Deepgram 408: …") instead of a bare exit code.
    const tail: string[] = [];
    const remember = (line: string) => {
      tail.push(line);
      if (tail.length > 10) tail.shift();
    };
    proc.stdout.on('data', (d) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (line.trim()) { input.onLog(line); remember(line); }
      }
    });
    proc.stderr.on('data', (d) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (line.trim()) { input.onLog(line); remember(line); }
      }
    });
    proc.on('error', (e) => { cleanup(); reject(e); });
    proc.on('close', (code) => {
      cleanup();
      if (code === 0) resolve();
      else {
        const detail = tail.length ? `: ${tail.join(' | ').slice(-500)}` : '';
        reject(new Error(`ingest exited ${code}${detail}`));
      }
    });
  });
}
