/**
 * longFormPipeline.ts
 *
 * Long-form video processing: transcribe → diarize → propose-clips.
 *
 * Run from the /process SSE route when status.category === 'long-form',
 * and separately from the /propose-clips route when the user wants to
 * re-run just the Claude proposal step against an already-transcribed
 * long-form source (e.g. to try a new prompt or different clip count).
 *
 * Differs from the talking-head pipeline in three ways:
 *   1. No silence/filler/caption removal — those only make sense on the
 *      extracted short-form clips that come out the other side.
 *   2. Runs Deepgram with `diarize=true` so we know who's speaking when.
 *      This feeds the reframing step during extraction (active-speaker
 *      tiebreaker when two faces don't fit a 9:16 crop).
 *   3. Asks Claude to propose 5-15 viral clippable moments from the
 *      transcript.
 *
 * Each step emits SSE events (`stage`, `log`) via the caller-provided
 * `send` function, so both routes can multiplex the output into the
 * client's single EventSource stream.
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

import { TAKES_ROOT, VIDEO_PROJECT_ROOT } from './paths';
import { run, killOnAbort } from './ffmpeg';
import { writeStatus } from './status';
import { diarizeWithDeepgram } from './diarization';
import { detectClipProposals, type ClipsProposalFile } from './clipProposal';
import { applyAction, createPlan, type Clip, type EditPlan } from './editPlan';
import { writePlan, readPlan } from './planStore';
import { chunkCaptions } from './captionChunker';
import type { Word, Silence } from './autoCut';

export type SendFn = (event: string, data: unknown) => void;

export type AnalysisJson = {
  duration: number;
  words: Word[];
  silences: Silence[];
  videoPath?: string;
};

/**
 * Full long-form pipeline: transcribe (via Whisper) → diarize (Deepgram)
 * → propose clips (Claude). Writes analysis.json, diarization.json, and
 * clips-proposal.json into the project folder.
 */
export async function runLongFormPipeline(input: {
  slug: string;
  sourceAbsPath: string;
  send: SendFn;
  skipTranscribe?: boolean;
  signal?: AbortSignal;
}): Promise<void> {
  const { slug, sourceAbsPath, send, skipTranscribe, signal } = input;
  const log = (msg: string) => send('log', { msg });
  const stage = (name: string) => send('stage', { name });
  const slugDir = path.join(TAKES_ROOT, slug);
  const analysisPath = path.join(slugDir, 'analysis.json');

  // ── Phase: transcribing ─────────────────────────────────────────────
  if (skipTranscribe && fs.existsSync(analysisPath)) {
    log('Reusing existing analysis.json (skipTranscribe).');
  } else {
    stage('transcribing');
    await runIngest({
      slug,
      sourceRel: path.relative(VIDEO_PROJECT_ROOT, sourceAbsPath),
      onLog: log,
      signal,
    });
  }
  if (!fs.existsSync(analysisPath)) {
    throw new Error('transcribe finished but analysis.json is missing');
  }
  const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf-8')) as AnalysisJson;

  // ── Phase: diarizing ────────────────────────────────────────────────
  stage('diarizing');
  await runDiarization({ slug, sourceAbsPath, onLog: log, signal });

  // ── Phase: propose-clips (over-clip mode) ───────────────────────────
  stage('propose-clips');
  const proposalFile = await runClipProposalStage({
    slug,
    analysis,
    exhaustive: true,
    onLog: log,
  });

  // ── Phase: build editor plan ────────────────────────────────────────
  // Long-form does NOT go to the long-form review tab. The proposals
  // become ordinary clips[] on a regular edit plan, so Lars reviews them
  // with the normal editor: delete the misses, slide edges to fix
  // boundaries. Clip ids = proposal ids, so extraction can map back.
  stage('building-plan');
  buildPlanFromProposals({ slug, analysis, proposalFile, log });
}

/**
 * Convert clip proposals into a regular talking-head edit plan and flip the
 * project's category so the standard editor opens it. Chronological order
 * (not ranked) — this is a timeline, not a leaderboard.
 */
export function buildPlanFromProposals(input: {
  slug: string;
  analysis: AnalysisJson;
  proposalFile: ClipsProposalFile;
  log?: (msg: string) => void;
}): EditPlan {
  const { slug, analysis, proposalFile } = input;
  const log = input.log ?? (() => {});

  const clips: Clip[] = [...proposalFile.proposals]
    .sort((a, b) => a.startSec - b.startSec)
    .map((p) => ({
      id: p.id,
      sourceStart: Math.max(0, p.startSec),
      sourceEnd: Math.min(analysis.duration, p.endSec),
      reason: 'manual' as const,
    }))
    .filter((c) => c.sourceEnd - c.sourceStart >= 3);

  const existing = readPlan(slug);
  let plan: EditPlan =
    existing ??
    createPlan({
      slug,
      sourceVideo: path.relative(
        VIDEO_PROJECT_ROOT,
        path.join(TAKES_ROOT, slug, 'source.mp4'),
      ),
      sourceDuration: analysis.duration,
    });

  plan = applyAction(plan, {
    type: 'auto_cut',
    params: {
      clips,
      stats: { removedCount: 0, removedSeconds: Math.max(0, analysis.duration - clips.reduce((s, c) => s + (c.sourceEnd - c.sourceStart), 0)) },
    },
  });

  const captions = chunkCaptions(analysis.words ?? [], plan.clips, {
    customSpellings: plan.customSpellings ?? [],
  });
  plan = applyAction(plan, { type: 'generate_captions', params: { captions } });

  writePlan(plan);
  // Regular editor from here on out — the long-form tab never sees it.
  writeStatus(slug, { category: 'talking-head', error: null });
  log(
    `Plan built: ${clips.length} proposed clip(s) on the timeline` +
      (proposalFile.note ? ` · note: ${proposalFile.note}` : '') +
      ` — review in the regular editor (delete misses, slide edges).`,
  );
  return plan;
}

/**
 * Just the Claude proposal step. Used by the standalone /propose-clips
 * re-run endpoint, which assumes analysis.json already exists.
 */
export async function runClipProposalStage(input: {
  slug: string;
  analysis: AnalysisJson;
  exhaustive?: boolean;
  onLog?: (msg: string) => void;
}): Promise<ClipsProposalFile> {
  const log = input.onLog ?? (() => {});
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing from server env');

  // Pull the performance corpus as soft context. Dynamic import keeps the
  // editor pipeline decoupled from the analytics layer — if the store is
  // empty or R2 is unreachable, we still run the proposal.
  let performanceContext: string | undefined;
  try {
    const { getPerformanceCorpus, renderCorpusForPrompt } = await import(
      '../performanceCorpus'
    );
    const corpus = await getPerformanceCorpus();
    performanceContext = renderCorpusForPrompt(corpus) ?? undefined;
  } catch (e) {
    log(
      `WARN: performance corpus unavailable (${e instanceof Error ? e.message : String(e)}) — proposing without it.`,
    );
  }

  const result = await detectClipProposals({
    words: input.analysis.words ?? [],
    sourceDurationSec: input.analysis.duration,
    apiKey,
    performanceContext,
    exhaustive: input.exhaustive,
    onLog: log,
  });

  const outPath = path.join(TAKES_ROOT, input.slug, 'clips-proposal.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  log(`Wrote ${result.proposals.length} proposal(s) → ${path.relative(VIDEO_PROJECT_ROOT, outPath)}`);

  writeStatus(input.slug, { error: null });
  return result;
}

/**
 * Extract the audio track from the long-form source to 16kHz mono Opus
 * and send it to Deepgram with diarize=true. Writes diarization.json
 * alongside analysis.json. Skipped (with a warning) if DEEPGRAM_API_KEY
 * isn't set. Opus, not WAV: a 42-minute source produced an 82MB WAV that
 * could never clear Deepgram's upload window (408 SLOW_UPLOAD); Opus 32k
 * is ~8× smaller and ASR-transparent.
 */
async function runDiarization(input: {
  slug: string;
  sourceAbsPath: string;
  onLog: (msg: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    input.onLog('WARN: DEEPGRAM_API_KEY not set — skipping diarization.');
    return;
  }

  const slugDir = path.join(TAKES_ROOT, input.slug);
  const audioPath = path.join(slugDir, 'audio.ogg');
  input.onLog('Extracting audio for diarization…');
  const r = await run('ffmpeg', [
    '-y',
    '-i', input.sourceAbsPath,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip',
    audioPath,
  ], { signal: input.signal });
  if (r.code !== 0) {
    input.onLog(`WARN: ffmpeg audio extract failed — skipping diarization. ${r.stderr.slice(-300)}`);
    return;
  }

  input.onLog('Calling Deepgram Nova-3 with diarize=true…');
  try {
    const audio = fs.readFileSync(audioPath);
    const diar = await diarizeWithDeepgram(audio, apiKey, {
      contentType: 'audio/ogg',
      signal: input.signal,
      onLog: input.onLog,
    });
    const outPath = path.join(slugDir, 'diarization.json');
    fs.writeFileSync(outPath, JSON.stringify(diar, null, 2));
    input.onLog(`Diarization: ${diar.words.length} word(s), speakers [${diar.speakers.join(', ')}].`);
  } catch (e) {
    input.onLog(`WARN: Deepgram diarization failed — continuing. ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    // Don't keep the extracted audio around after the upload.
    try { fs.unlinkSync(audioPath); } catch {}
  }
}

/**
 * Spawn `scripts/ingest-takes.ts` inside the video-projects checkout to
 * produce analysis.json (word-level timestamps + silences). Same helper
 * the talking-head /process route uses — DRY'd here so long-form can
 * call it without duplicating.
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
