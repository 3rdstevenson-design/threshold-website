/**
 * extractClip.ts
 *
 * Given a parent long-form project and an approved clip proposal,
 * materialize a standalone talking-head project for it:
 *
 *   1. Mint a child slug `{parent}-clip-{shortid}`
 *   2. ffmpeg sub-range cut (re-encode for frame-accurate boundaries)
 *   3. Write analysis.json subset (Whisper words filtered + time-shifted)
 *   4. Write diarization.json subset (if parent has one)
 *   5. Seed an edit plan covering the whole child clip
 *   6. Write status.json with category='talking-head', sourceSlug,
 *      sourceClipId so the sidebar attributes the clip to its source
 *
 * Reframing (9:16 vertical crop targeting the speaker) runs next via
 * reframe.ts; the caller wires that step. The standard /process
 * pipeline then consumes the child project exactly like a phone upload.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

import { TAKES_ROOT, VIDEO_PROJECT_ROOT } from './paths';
import { run, probeDurationSec, extractThumb } from './ffmpeg';
import { writeStatus } from './status';
import { createPlan } from './editPlan';
import { writePlan } from './planStore';
import type { Word, Silence } from './autoCut';
import type { ClipProposal } from './clipProposal';
import { subsetDiarization, type DiarizationFile } from './diarization';

export type ExtractClipInput = {
  parentSlug: string;
  parentSource: string;     // absolute path to parent source.mp4
  proposal: ClipProposal;
  onLog?: (msg: string) => void;
};

export type ExtractClipResult = {
  childSlug: string;
  childDir: string;
  childSource: string;      // absolute path to child source.mp4
  durationSec: number;
};

type AnalysisJson = {
  duration: number;
  words: Word[];
  silences: Silence[];
  videoPath?: string;
};

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

export async function extractClip(input: ExtractClipInput): Promise<ExtractClipResult> {
  const log = input.onLog ?? (() => {});
  const { parentSlug, parentSource, proposal } = input;

  const childSlug = `${parentSlug}-clip-${shortId()}`;
  const childDir = path.join(TAKES_ROOT, childSlug);
  fs.mkdirSync(childDir, { recursive: true });
  const childSource = path.join(childDir, 'source.mp4');

  const dur = proposal.endSec - proposal.startSec;
  log(`Cutting ${proposal.startSec.toFixed(2)}s → ${proposal.endSec.toFixed(2)}s (${dur.toFixed(2)}s) → ${childSlug}`);

  // Re-encode so downstream editing is frame-accurate — `-c copy` will
  // snap the start to the nearest keyframe, which can be off by seconds
  // on long-form GOPs. Fast preset + tight GOP keeps the re-encode quick.
  const r = await run('ffmpeg', [
    '-y',
    '-ss', String(proposal.startSec),
    '-i', parentSource,
    '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k',
    '-g', '30', '-keyint_min', '30',
    '-pix_fmt', 'yuv420p',
    childSource,
  ]);
  if (r.code !== 0) {
    throw new Error(`ffmpeg cut failed: ${r.stderr.slice(-500)}`);
  }

  // Read + subset parent analysis.json (Whisper words + silences).
  const parentAnalysisPath = path.join(TAKES_ROOT, parentSlug, 'analysis.json');
  if (!fs.existsSync(parentAnalysisPath)) {
    throw new Error(`parent analysis.json missing at ${parentAnalysisPath}`);
  }
  const parentAnalysis = JSON.parse(
    fs.readFileSync(parentAnalysisPath, 'utf-8'),
  ) as AnalysisJson;
  const childAnalysis = subsetAnalysis(
    parentAnalysis,
    proposal.startSec,
    proposal.endSec,
    path.relative(VIDEO_PROJECT_ROOT, childSource),
  );
  fs.writeFileSync(
    path.join(childDir, 'analysis.json'),
    JSON.stringify(childAnalysis, null, 2),
  );
  log(`Analysis subset: ${childAnalysis.words.length} word(s), ${childAnalysis.silences.length} silence(s).`);

  // Subset diarization.json if present. Harmless if missing — reframe.py
  // falls back to "center on detected faces" when the file is absent.
  const parentDiarPath = path.join(TAKES_ROOT, parentSlug, 'diarization.json');
  if (fs.existsSync(parentDiarPath)) {
    try {
      const parentDiar = JSON.parse(
        fs.readFileSync(parentDiarPath, 'utf-8'),
      ) as DiarizationFile;
      const childDiar = subsetDiarization(
        parentDiar,
        proposal.startSec,
        proposal.endSec,
      );
      fs.writeFileSync(
        path.join(childDir, 'diarization.json'),
        JSON.stringify(childDiar, null, 2),
      );
      log(`Diarization subset: ${childDiar.words.length} word(s), speakers [${childDiar.speakers.join(', ')}].`);
    } catch (e) {
      log(`WARN: failed to subset diarization: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Probe the actual child duration (ffmpeg's -t is a target, not a
  // guarantee). Use the probed value for the seeded edit plan.
  let probedDur = dur;
  try {
    probedDur = await probeDurationSec(childSource);
  } catch {
    // Fallback to requested dur if ffprobe fails.
  }

  const plan = createPlan({
    slug: childSlug,
    sourceVideo: path.relative(VIDEO_PROJECT_ROOT, childSource),
    sourceDuration: probedDur,
  });
  writePlan(plan);

  // Thumbnail for the sidebar (best-effort, non-blocking).
  extractThumb(childSource, path.join(childDir, 'thumb.jpg'), Math.min(1, probedDur / 3)).catch(() => {});

  writeStatus(childSlug, {
    sourcePath: path.relative(VIDEO_PROJECT_ROOT, childSource),
    durationSec: probedDur,
    category: 'talking-head',
    sourceSlug: parentSlug,
    sourceClipId: proposal.id,
    error: null,
  });

  return {
    childSlug,
    childDir,
    childSource,
    durationSec: probedDur,
  };
}

export function subsetAnalysis(
  parent: AnalysisJson,
  startSec: number,
  endSec: number,
  childVideoRel: string,
): AnalysisJson {
  const words: Word[] = [];
  for (const w of parent.words ?? []) {
    if (w.end < startSec || w.start > endSec) continue;
    const s = Math.max(0, w.start - startSec);
    const e = Math.min(endSec - startSec, w.end - startSec);
    if (e <= s) continue;
    words.push({ text: w.text, start: s, end: e });
  }

  // Derive silences from the SUBSETTED words rather than copying from
  // the parent. Long-form analysis.json in the existing pipeline tends
  // to mark large "no-speech-detected" spans as silences, even if they
  // contain 200+ words inside — wrong at the whole-file level, and
  // catastrophically wrong for extracted clips (we'd see the clip's
  // entire body flagged as silence and removeSilences() would delete
  // all of it). Deriving from word gaps is the safe, self-consistent
  // thing to do.
  const clipDur = Math.max(0, endSec - startSec);
  const silences = deriveSilencesFromWords(words, clipDur);

  return {
    duration: clipDur,
    words,
    silences,
    videoPath: childVideoRel,
  };
}

/**
 * Compute silence ranges as the gaps between words, plus any lead-in
 * before the first word and tail after the last. Threshold defaults to
 * 0.5s so it matches `removeSilences()`'s minSilenceSeconds default —
 * anything shorter wouldn't be trimmed anyway.
 */
export function deriveSilencesFromWords(
  words: Word[],
  totalDurSec: number,
  minSilenceSec = 0.5,
): Silence[] {
  const out: Silence[] = [];
  if (words.length === 0) {
    if (totalDurSec >= minSilenceSec) out.push({ start: 0, end: totalDurSec });
    return out;
  }
  const sorted = [...words].sort((a, b) => a.start - b.start);
  if (sorted[0].start >= minSilenceSec) {
    out.push({ start: 0, end: sorted[0].start });
  }
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].end;
    const nextStart = sorted[i].start;
    if (nextStart - prevEnd >= minSilenceSec) {
      out.push({ start: prevEnd, end: nextStart });
    }
  }
  const lastEnd = sorted[sorted.length - 1].end;
  if (totalDurSec - lastEnd >= minSilenceSec) {
    out.push({ start: lastEnd, end: totalDurSec });
  }
  return out;
}
