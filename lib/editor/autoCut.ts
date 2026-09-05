/**
 * autoCut.ts
 *
 * Pure algorithm: given whisper word-level timestamps and silence ranges,
 * produce a new clips[] array that skips silences ≥ threshold and all
 * filler words.
 *
 * All inputs are in SECONDS (matching analysis.json). Clips output is in
 * source-time seconds (matching Clip.sourceStart/sourceEnd).
 *
 * The pipeline is STAGED so each stage operates on the output of the
 * previous one:
 *   A. removeSilences — detect + remove silence ranges ≥ threshold
 *   B. removeFillers  — detect + remove filler words from what survives A
 *   C. removeStutters — detect + remove stutter/repeat ranges from what
 *                       survives A+B (keep LAST occurrence of repeats)
 *
 * autoCutStaged() runs all three in order and returns combined clips + per-stage stats.
 * autoCut() is a backward-compat wrapper that returns the same shape as before.
 */

import { Clip, randomId } from './editPlan';

export type Word = {
  start: number; // seconds
  end: number;
  text: string;
  /**
   * ASR word confidence (0–1), when the transcriber provides it (Deepgram
   * does; older analysis.json files won't have it). `undefined` means
   * "no signal", never an error.
   */
  confidence?: number;
};

export type Silence = {
  start: number; // seconds
  end: number;
};

export type Range = { start: number; end: number };

export type AutoCutOptions = {
  /** Silences this long or longer get cut. Default 0.5s. */
  minSilenceSeconds?: number;
  /** Leave this much headroom before/after silence boundaries. Default 0.15s. */
  silencePaddingSeconds?: number;
  /** Pad each side of a filler word to avoid cutting mid-phoneme. Default 0.05s. */
  fillerPaddingSeconds?: number;
  /**
   * Drop any surviving clip shorter than this. Prevents the auto-cut from
   * leaving micro-fragments (single syllables between silences) that cause
   * visible stutters during playback. Default 1.0s.
   */
  minClipSeconds?: number;
  /**
   * Additional ranges (in source seconds) to remove alongside silences
   * and filler words. Used to pass in stutter/repeat-phrase detections
   * from `stutterDetection.ts`.
   */
  extraRemoveRanges?: Range[];
};

/**
 * Tuning preset for Lars's talking-head reels. More forgiving "keeps" than
 * the neutral library defaults: wider padding so word edges aren't clipped
 * at silence/filler boundaries, and a lower min-clip so good short lines
 * survive. The pipeline, the manual "Analyze audio" action, and the batch
 * regeneration script all pass this so they cut identically.
 */
export const TALKING_HEAD_CUT_OPTIONS: AutoCutOptions = {
  silencePaddingSeconds: 0.25,
  fillerPaddingSeconds: 0.10,
  minClipSeconds: 0.6,
};

export type AutoCutResult = {
  clips: Clip[];
  stats: {
    removedCount: number;     // number of cuts applied
    removedSeconds: number;   // total source time removed
    silenceCuts: number;
    fillerCuts: number;
    droppedTinyClips: number; // kept ranges dropped for being < minClipSeconds
  };
};

// ── Staged pipeline types ───────────────────────────────────────────

export type StageStats = {
  /** Number of discrete cuts this stage applied. */
  cutCount: number;
  /** Total source seconds removed in this stage alone. */
  secondsRemoved: number;
};

export type SilenceStageResult = {
  clips: Clip[];
  stats: StageStats;
};

export type FillerStageResult = {
  clips: Clip[];
  stats: StageStats;
};

export type StutterStageResult = {
  clips: Clip[];
  stats: StageStats & {
    phrasesRemoved: number;
    singleWordsRemoved: number;
    fragmentsRemoved: number;
  };
};

// ── Stage A: Silences ───────────────────────────────────────────────

/**
 * Detect silences ≥ minSilenceSeconds in the source duration and remove
 * them from a single full-duration clip. This is always the FIRST stage
 * so it operates on the raw timeline.
 */
export function removeSilences(input: {
  duration: number;
  silences: Silence[];
  options?: Pick<AutoCutOptions, 'minSilenceSeconds' | 'silencePaddingSeconds'>;
}): SilenceStageResult {
  const minSilence = input.options?.minSilenceSeconds ?? 0.5;
  const silencePad = input.options?.silencePaddingSeconds ?? 0.15;

  const removeRanges: Range[] = [];
  let cutCount = 0;
  for (const s of input.silences) {
    const dur = s.end - s.start;
    if (dur < minSilence) continue;
    const from = s.start < silencePad ? 0 : s.start + silencePad;
    const to = input.duration - s.end < silencePad ? input.duration : s.end - silencePad;
    if (to > from) {
      removeRanges.push({ start: from, end: to });
      cutCount++;
    }
  }
  const merged = mergeRanges(removeRanges);
  const keep = invertRanges(merged, input.duration);
  const clips: Clip[] = keep.map((r) => ({
    id: randomId('clip'),
    sourceStart: r.start,
    sourceEnd: r.end,
  }));
  const secondsRemoved = merged.reduce((s, r) => s + (r.end - r.start), 0);
  return { clips, stats: { cutCount, secondsRemoved } };
}

// ── Stage B: Filler words ───────────────────────────────────────────

/**
 * Remove filler words from words that survive a prior stage. Only
 * considers words whose midpoint lies inside the incoming clips[].
 */
export function removeFillers(input: {
  clips: Clip[];
  words: Word[];
  fillerWords: string[];
  duration: number;
  options?: Pick<AutoCutOptions, 'fillerPaddingSeconds'>;
}): FillerStageResult {
  const fillerPad = input.options?.fillerPaddingSeconds ?? 0.05;

  const fillerSet = new Set<string>();
  const multiFillers: string[][] = [];
  for (const raw of input.fillerWords) {
    const n = normalizeWord(raw);
    if (!n) continue;
    const parts = n.split(/\s+/);
    if (parts.length === 1) fillerSet.add(parts[0]);
    else multiFillers.push(parts);
  }

  const survivingWords = filterWordsByClips(input.words, input.clips);
  const normWords = survivingWords.map((w) => ({ ...w, norm: normalizeWord(w.text) }));
  const removeRanges: Range[] = [];
  let cutCount = 0;
  for (let i = 0; i < normWords.length; i++) {
    const w = normWords[i];
    if (fillerSet.has(w.norm)) {
      removeRanges.push({
        start: Math.max(0, w.start - fillerPad),
        end: w.end + fillerPad,
      });
      cutCount++;
      continue;
    }
    for (const seq of multiFillers) {
      if (matchesSequence(normWords, i, seq)) {
        const first = normWords[i];
        const last = normWords[i + seq.length - 1];
        removeRanges.push({
          start: Math.max(0, first.start - fillerPad),
          end: last.end + fillerPad,
        });
        cutCount++;
        i += seq.length - 1;
        break;
      }
    }
  }

  // Merge the incoming clips' cut-ranges (i.e. what's NOT in input.clips)
  // with the new filler ranges, then invert over the full duration.
  const existingCuts = clipsToCutRanges(input.clips, input.duration);
  const allCuts = mergeRanges([...existingCuts, ...removeRanges]);
  const keep = invertRanges(allCuts, input.duration);
  const clips: Clip[] = keep.map((r) => ({
    id: randomId('clip'),
    sourceStart: r.start,
    sourceEnd: r.end,
  }));
  const existingSeconds = existingCuts.reduce((s, r) => s + (r.end - r.start), 0);
  const totalSeconds = allCuts.reduce((s, r) => s + (r.end - r.start), 0);
  return {
    clips,
    stats: { cutCount, secondsRemoved: Math.max(0, totalSeconds - existingSeconds) },
  };
}

// ── Stage C: Stutters/repeats ───────────────────────────────────────

/**
 * Run stutter/repeat detection on words that survive stages A+B. Keeps
 * the LAST occurrence of a repeated phrase and removes earlier ones
 * (this matches the user's mental model: the last take is the correct take).
 *
 * The detection function lives in `stutterDetection.ts` — we inject it
 * here to avoid a circular dependency with the pure autoCut module.
 */
export function removeStutters(input: {
  clips: Clip[];
  words: Word[];
  duration: number;
  detector: (survivingWords: Word[]) => {
    removeRanges: Range[];
    phrasesRemoved: number;
    singleWordsRemoved: number;
    fragmentsRemoved: number;
  };
  options?: Pick<AutoCutOptions, 'minClipSeconds'>;
}): StutterStageResult {
  const minClip = input.options?.minClipSeconds ?? 1.0;
  const survivingWords = filterWordsByClips(input.words, input.clips);
  const stutter = input.detector(survivingWords);

  const existingCuts = clipsToCutRanges(input.clips, input.duration);
  const allCuts = mergeRanges([...existingCuts, ...stutter.removeRanges]);
  const keep = invertRanges(allCuts, input.duration);
  const clips: Clip[] = keep
    .filter((r) => r.end - r.start >= minClip)
    .map((r) => ({
      id: randomId('clip'),
      sourceStart: r.start,
      sourceEnd: r.end,
    }));
  const existingSeconds = existingCuts.reduce((s, r) => s + (r.end - r.start), 0);
  const totalSeconds = allCuts.reduce((s, r) => s + (r.end - r.start), 0);
  return {
    clips,
    stats: {
      cutCount: stutter.removeRanges.length,
      secondsRemoved: Math.max(0, totalSeconds - existingSeconds),
      phrasesRemoved: stutter.phrasesRemoved,
      singleWordsRemoved: stutter.singleWordsRemoved,
      fragmentsRemoved: stutter.fragmentsRemoved,
    },
  };
}

// ── Stage D: Retakes ────────────────────────────────────────────────

export type RetakeStageResult = {
  clips: Clip[];
  stats: StageStats & { groupsFound: number; flaggedGroups: number };
  /** Detected groups (for plan.retakeGroups / the Timeline UI). */
  groups: Array<{
    alternatives: Array<{ start: number; end: number; transcript: string; meanConfidence?: number }>;
    keptIndex: number;
    flagged: boolean;
    reason: string;
  }>;
};

/**
 * Remove non-keeper retakes from words that survive stages A+B+C. Retakes
 * are coarser than stutters (whole phrase redone across a short pause), so
 * this runs LAST on the survivors. The detector is injected (see
 * `retakeDetection.ts` → detectRetakesFromWords) to keep this module pure.
 */
export function removeRetakes(input: {
  clips: Clip[];
  words: Word[];
  duration: number;
  detector: (survivingWords: Word[]) => {
    removeRanges: Range[];
    groups: RetakeStageResult['groups'];
  };
  options?: Pick<AutoCutOptions, 'minClipSeconds'>;
}): RetakeStageResult {
  const minClip = input.options?.minClipSeconds ?? 1.0;
  const survivingWords = filterWordsByClips(input.words, input.clips);
  const detection = input.detector(survivingWords);

  const existingCuts = clipsToCutRanges(input.clips, input.duration);
  const allCuts = mergeRanges([...existingCuts, ...detection.removeRanges]);
  const keep = invertRanges(allCuts, input.duration);
  const clips: Clip[] = keep
    .filter((r) => r.end - r.start >= minClip)
    .map((r) => ({
      id: randomId('clip'),
      sourceStart: r.start,
      sourceEnd: r.end,
    }));
  const existingSeconds = existingCuts.reduce((s, r) => s + (r.end - r.start), 0);
  const totalSeconds = allCuts.reduce((s, r) => s + (r.end - r.start), 0);
  return {
    clips,
    stats: {
      cutCount: detection.removeRanges.length,
      secondsRemoved: Math.max(0, totalSeconds - existingSeconds),
      groupsFound: detection.groups.length,
      flaggedGroups: detection.groups.filter((g) => g.flagged).length,
    },
    groups: detection.groups,
  };
}

// ── Staged pipeline ─────────────────────────────────────────────────

export type StagedAutoCutResult = {
  clips: Clip[];
  stats: AutoCutResult['stats'] & {
    stutterCuts: number;
    singleWordCuts: number;
    fragmentCuts: number;
    retakeCuts: number;
    retakeGroups: number;
  };
  stages: {
    silences: StageStats;
    fillers: StageStats;
    stutters: StutterStageResult['stats'];
    retakes?: RetakeStageResult['stats'];
  };
  /** Present when a retakeDetector was supplied — feeds plan.retakeGroups. */
  retakeGroups?: RetakeStageResult['groups'];
};

/**
 * Run the explicit staged pipeline: silences → fillers → stutters → retakes.
 * Requires a stutter detector to be injected (see `stutterDetection.ts`).
 * The retake detector (see `retakeDetection.ts`) is optional — omit it and
 * behavior is identical to the pre-retake pipeline.
 */
export function autoCutStaged(input: {
  duration: number;
  words: Word[];
  silences: Silence[];
  fillerWords: string[];
  stutterDetector: (words: Word[]) => {
    removeRanges: Range[];
    phrasesRemoved: number;
    singleWordsRemoved: number;
    fragmentsRemoved: number;
  };
  retakeDetector?: (words: Word[]) => {
    removeRanges: Range[];
    groups: RetakeStageResult['groups'];
  };
  options?: AutoCutOptions;
}): StagedAutoCutResult {
  const minClip = input.options?.minClipSeconds ?? 1.0;

  // Stage A: Silences
  const a = removeSilences({
    duration: input.duration,
    silences: input.silences,
    options: input.options,
  });

  // Stage B: Fillers (on post-silence words)
  const b = removeFillers({
    clips: a.clips,
    words: input.words,
    fillerWords: input.fillerWords,
    duration: input.duration,
    options: input.options,
  });

  // Stage C: Stutters (on post-silence+filler words)
  const c = removeStutters({
    clips: b.clips,
    words: input.words,
    duration: input.duration,
    detector: input.stutterDetector,
    options: input.options,
  });

  // Stage D: Retakes (on survivors of A+B+C; whole-phrase redos)
  const d = input.retakeDetector
    ? removeRetakes({
        clips: c.clips,
        words: input.words,
        duration: input.duration,
        detector: input.retakeDetector,
        options: input.options,
      })
    : null;

  // Drop tiny clips at the very end (safety valve).
  let droppedTinyClips = 0;
  const finalClips: Clip[] = [];
  for (const clip of (d ?? c).clips) {
    const dur = clip.sourceEnd - clip.sourceStart;
    if (dur < minClip) {
      droppedTinyClips++;
      continue;
    }
    finalClips.push(clip);
  }

  const keptSeconds = finalClips.reduce((s, c) => s + (c.sourceEnd - c.sourceStart), 0);
  const removedSeconds = input.duration - keptSeconds;

  return {
    clips: finalClips,
    stats: {
      removedCount:
        a.stats.cutCount + b.stats.cutCount + c.stats.cutCount +
        (d?.stats.cutCount ?? 0) + droppedTinyClips,
      removedSeconds,
      silenceCuts: a.stats.cutCount,
      fillerCuts: b.stats.cutCount,
      droppedTinyClips,
      stutterCuts: c.stats.phrasesRemoved,
      singleWordCuts: c.stats.singleWordsRemoved,
      fragmentCuts: c.stats.fragmentsRemoved,
      retakeCuts: d?.stats.cutCount ?? 0,
      retakeGroups: d?.stats.groupsFound ?? 0,
    },
    stages: {
      silences: a.stats,
      fillers: b.stats,
      stutters: c.stats,
      ...(d ? { retakes: d.stats } : {}),
    },
    ...(d ? { retakeGroups: d.groups } : {}),
  };
}

/**
 * Backward-compatible single-pass auto-cut. Now implemented as a
 * staged pipeline internally. Any callers that pass
 * `options.extraRemoveRanges` still have those ranges merged into the
 * silence-stage cuts (for back-compat with disfluency/polish callers).
 */
export function autoCut(input: {
  duration: number;
  words: Word[];
  silences: Silence[];
  fillerWords: string[];
  options?: AutoCutOptions;
}): AutoCutResult {
  const minSilence = input.options?.minSilenceSeconds ?? 0.5;
  const silencePad = input.options?.silencePaddingSeconds ?? 0.15;
  const fillerPad = input.options?.fillerPaddingSeconds ?? 0.05;
  const minClip = input.options?.minClipSeconds ?? 1.0;
  const extraRanges = input.options?.extraRemoveRanges ?? [];

  const removeRanges: Range[] = [...extraRanges];
  let silenceCuts = 0;
  for (const s of input.silences) {
    const dur = s.end - s.start;
    if (dur < minSilence) continue;
    const from = s.start < silencePad ? 0 : s.start + silencePad;
    const to = input.duration - s.end < silencePad ? input.duration : s.end - silencePad;
    if (to > from) {
      removeRanges.push({ start: from, end: to });
      silenceCuts++;
    }
  }

  const fillerSet = new Set<string>();
  const multiFillers: string[][] = [];
  for (const raw of input.fillerWords) {
    const n = normalizeWord(raw);
    if (!n) continue;
    const parts = n.split(/\s+/);
    if (parts.length === 1) fillerSet.add(parts[0]);
    else multiFillers.push(parts);
  }
  const normWords = input.words.map((w) => ({ ...w, norm: normalizeWord(w.text) }));
  let fillerCuts = 0;
  for (let i = 0; i < normWords.length; i++) {
    const w = normWords[i];
    if (fillerSet.has(w.norm)) {
      removeRanges.push({
        start: Math.max(0, w.start - fillerPad),
        end: w.end + fillerPad,
      });
      fillerCuts++;
      continue;
    }
    for (const seq of multiFillers) {
      if (matchesSequence(normWords, i, seq)) {
        const first = normWords[i];
        const last = normWords[i + seq.length - 1];
        removeRanges.push({
          start: Math.max(0, first.start - fillerPad),
          end: last.end + fillerPad,
        });
        fillerCuts++;
        i += seq.length - 1;
        break;
      }
    }
  }

  const merged = mergeRanges(removeRanges);
  const keep = invertRanges(merged, input.duration);
  let droppedTinyClips = 0;
  const clips: Clip[] = [];
  for (const r of keep) {
    const dur = r.end - r.start;
    if (dur < minClip) {
      droppedTinyClips++;
      continue;
    }
    clips.push({
      id: randomId('clip'),
      sourceStart: r.start,
      sourceEnd: r.end,
    });
  }
  const keptSeconds = clips.reduce((sum, c) => sum + (c.sourceEnd - c.sourceStart), 0);
  const removedSeconds = input.duration - keptSeconds;
  return {
    clips,
    stats: {
      removedCount: merged.length + droppedTinyClips,
      removedSeconds,
      silenceCuts,
      fillerCuts,
      droppedTinyClips,
    },
  };
}

/**
 * Apply just the min-clip filter to an existing clip list. Used as a
 * standalone "prune short clips" action in the toolbar.
 */
export function filterTinyClips(clips: Clip[], minSeconds = 1.0): {
  clips: Clip[];
  dropped: number;
} {
  const kept: Clip[] = [];
  let dropped = 0;
  for (const c of clips) {
    if (c.sourceEnd - c.sourceStart < minSeconds) {
      dropped++;
      continue;
    }
    kept.push(c);
  }
  return { clips: kept, dropped };
}

// ── Helpers ─────────────────────────────────────────────────────────

export function normalizeWord(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,!?;:"'`]/g, '')
    .trim();
}

function matchesSequence(
  words: { norm: string }[],
  startIdx: number,
  seq: string[],
): boolean {
  if (startIdx + seq.length > words.length) return false;
  for (let k = 0; k < seq.length; k++) {
    if (words[startIdx + k].norm !== seq[k]) return false;
  }
  return true;
}

export function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Range[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

export function invertRanges(removed: Range[], duration: number): Range[] {
  if (removed.length === 0) return [{ start: 0, end: duration }];
  const keep: Range[] = [];
  let cursor = 0;
  for (const r of removed) {
    if (r.start > cursor) keep.push({ start: cursor, end: Math.min(r.start, duration) });
    cursor = Math.max(cursor, r.end);
    if (cursor >= duration) break;
  }
  if (cursor < duration) keep.push({ start: cursor, end: duration });
  return keep;
}

/** Convert a clips[] list back into the cut-ranges that produced it. */
export function clipsToCutRanges(clips: Clip[], duration: number): Range[] {
  const sorted = [...clips].sort((a, b) => a.sourceStart - b.sourceStart);
  const cuts: Range[] = [];
  let cursor = 0;
  for (const c of sorted) {
    if (c.sourceStart > cursor) cuts.push({ start: cursor, end: c.sourceStart });
    cursor = Math.max(cursor, c.sourceEnd);
  }
  if (cursor < duration) cuts.push({ start: cursor, end: duration });
  return cuts;
}

/** Parts of `a` not covered by `b`. Both inputs must be sorted, non-overlapping. */
export function subtractRanges(a: Range[], b: Range[]): Range[] {
  const out: Range[] = [];
  for (const r of a) {
    let cursor = r.start;
    for (const cut of b) {
      if (cut.end <= cursor || cut.start >= r.end) continue;
      if (cut.start > cursor) out.push({ start: cursor, end: cut.start });
      cursor = Math.max(cursor, cut.end);
      if (cursor >= r.end) break;
    }
    if (cursor < r.end) out.push({ start: cursor, end: r.end });
  }
  return out;
}

/**
 * The source ranges newly removed by a stage: cut in `nextClips` but not
 * already cut in `prevClips`. Feeds the plan's cutLog annotations.
 */
export function newCutRanges(prevClips: Clip[], nextClips: Clip[], duration: number): Range[] {
  return subtractRanges(
    clipsToCutRanges(nextClips, duration),
    clipsToCutRanges(prevClips, duration),
  );
}

/** Keep only the words whose midpoint falls inside any of the given clips. */
export function filterWordsByClips(words: Word[], clips: Clip[]): Word[] {
  if (clips.length === 0) return [];
  const sorted = [...clips].sort((a, b) => a.sourceStart - b.sourceStart);
  const out: Word[] = [];
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    for (const c of sorted) {
      if (mid >= c.sourceStart && mid <= c.sourceEnd) {
        out.push(w);
        break;
      }
    }
  }
  return out;
}
