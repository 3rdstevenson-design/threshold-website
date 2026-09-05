/**
 * retakeDetection.ts
 *
 * Dashboard-side micro-retake detection. Catches "say a line, flub it,
 * say it again" repeats WITHIN a selected take — gaps too short (400–600ms)
 * for the video pipeline's take splitter (scripts/lib/take-detection.ts in
 * my-video-projects, which needs ≥2.0s silences or claps) to have split on.
 * The two passes are complementary, not duplicates: take-detection runs
 * before take selection, this runs on the chosen take inside the editor.
 *
 * Algorithm (validated against Descript "Remove Retakes" / TimeBolt
 * last-take-wins): a local adjacent-duplicate collapse —
 *   1. segment words into utterances at inter-word gaps ≥ gapSeconds
 *   2. fuzzy-match each utterance against the prior 1–3 (token_sort_ratio)
 *   3. matches form a retake group; keep the LAST utterance
 *   4. if the keeper looks truncated (short vs group median, or anomalously
 *      low mean word confidence), keep the last COMPLETE one instead and
 *      flag the group for review — never guess silently
 *
 * Isomorphic: no Node-only imports (same constraint as editPlan.ts).
 */

import * as fuzz from 'fuzzball';
import type { Range, Word } from './autoCut';
import type { RetakePreference } from './editPlan';

export type Utterance = {
  words: Word[];
  text: string;
  start: number; // seconds, source time
  end: number;   // seconds, source time
};

export type RetakeAlternativeDetection = {
  start: number;
  end: number;
  transcript: string;
  meanConfidence?: number;
};

export type RetakeGroupDetection = {
  /** Chronological alternatives, including the keeper. */
  alternatives: RetakeAlternativeDetection[];
  /** Index into alternatives[] of the take to keep. */
  keptIndex: number;
  /** True when the auto-choice is uncertain and needs Lars's review. */
  flagged: boolean;
  reason: string;
};

export type RetakeDetectionResult = {
  groups: RetakeGroupDetection[];
  /** Source ranges of the NON-kept takes (what the cutter removes). */
  removeRanges: Range[];
};

export type RetakeDetectionOptions = {
  /** Utterance boundary: inter-word gap this long or longer. Default 0.5s. */
  gapSeconds?: number;
  /** token_sort_ratio (0–100) at or above which utterances match. Default 80. */
  similarityThreshold?: number;
  /** How many prior utterances to compare against. Default 3. */
  lookback?: number;
  /** Ignore utterances shorter than this many words (greetings, "okay"). Default 3. */
  minUtteranceWords?: number;
  /** Padding kept around cut boundaries, seconds. Default 0.2 (auto-editor's margin). */
  paddingSeconds?: number;
  /**
   * Which take of a group wins. Default 'last' (the redo is the intended
   * one). 'ask' cuts like 'last' but flags EVERY group for review. All
   * preferences fall back to a complete-looking take (and flag) when the
   * preferred one looks truncated or anomalously low-confidence.
   */
  keeperPreference?: RetakePreference;
};

export function segmentUtterances(words: Word[], gapSeconds = 0.5): Utterance[] {
  const utterances: Utterance[] = [];
  let current: Word[] = [];
  for (const w of words) {
    if (current.length > 0 && w.start - current[current.length - 1].end >= gapSeconds) {
      utterances.push(toUtterance(current));
      current = [];
    }
    current.push(w);
  }
  if (current.length > 0) utterances.push(toUtterance(current));
  return utterances;
}

function toUtterance(words: Word[]): Utterance {
  return {
    words,
    text: words.map((w) => w.text).join(' '),
    start: words[0].start,
    end: words[words.length - 1].end,
  };
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'`’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function meanConfidence(u: Utterance): number | undefined {
  const withConf = u.words.filter((w) => typeof w.confidence === 'number');
  if (withConf.length === 0) return undefined;
  return withConf.reduce((s, w) => s + (w.confidence as number), 0) / withConf.length;
}

export function detectRetakes(
  utterances: Utterance[],
  options?: RetakeDetectionOptions,
): RetakeDetectionResult {
  const threshold = options?.similarityThreshold ?? 80;
  const lookback = options?.lookback ?? 3;
  const minWords = options?.minUtteranceWords ?? 3;
  const padding = options?.paddingSeconds ?? 0.2;
  const preference = options?.keeperPreference ?? 'last';

  // Union-find-lite: assign each utterance to a group when it matches one
  // of the previous `lookback` utterances; groups extend forward for 3×+.
  const groupOf: (number | null)[] = utterances.map(() => null);
  const groups: number[][] = [];

  for (let i = 1; i < utterances.length; i++) {
    const cur = utterances[i];
    if (cur.words.length < minWords) continue;
    const curNorm = normalize(cur.text);
    for (let j = Math.max(0, i - lookback); j < i; j++) {
      const prev = utterances[j];
      if (prev.words.length < minWords) continue;
      const score = fuzz.token_sort_ratio(curNorm, normalize(prev.text));
      if (score >= threshold) {
        const g = groupOf[j];
        if (g !== null) {
          groups[g].push(i);
          groupOf[i] = g;
        } else {
          const idx = groups.length;
          groups.push([j, i]);
          groupOf[j] = idx;
          groupOf[i] = idx;
        }
        break;
      }
    }
  }

  const detections: RetakeGroupDetection[] = [];
  const removeRanges: Range[] = [];

  for (const members of groups) {
    const sorted = Array.from(new Set(members)).sort((a, b) => a - b);
    const alts = sorted.map((i) => utterances[i]);

    // Candidate order by keeper preference; index 0 is the preferred take.
    // 'ask' cuts like 'last' but flags every group below.
    const order: number[] = (() => {
      const idxs = alts.map((_, i) => i);
      switch (preference) {
        case 'first':
          return idxs;
        case 'longest':
          // Most words wins; ties go to the later take.
          return idxs.sort((a, b) =>
            alts[b].words.length - alts[a].words.length || b - a);
        case 'last':
        case 'ask':
        default:
          return idxs.reverse();
      }
    })();
    const prefLabel = preference === 'ask' ? 'last' : preference;

    let keptIndex = order[0];
    let flagged = false;
    let reason = `kept ${prefLabel} take`;

    const wordCounts = alts.map((u) => u.words.length);
    const median = [...wordCounts].sort((a, b) => a - b)[Math.floor(wordCounts.length / 2)];
    const otherConfs = alts
      .filter((_, i) => i !== keptIndex)
      .map(meanConfidence)
      .filter((c): c is number => typeof c === 'number');
    const bestOtherConf = otherConfs.length ? Math.max(...otherConfs) : undefined;
    const looksShort = (i: number) =>
      alts[i].words.length < Math.max(minWords, median * 0.6);
    const looksLowConf = (i: number) => {
      const conf = meanConfidence(alts[i]);
      return typeof conf === 'number' && typeof bestOtherConf === 'number'
        ? conf < bestOtherConf - 0.15
        : false;
    };

    const preferredShort = looksShort(keptIndex);
    if (preferredShort || looksLowConf(keptIndex)) {
      // Fall back to the next candidate that is NOT suspiciously short/low-conf.
      for (const k of order.slice(1)) {
        if (!looksShort(k) && !looksLowConf(k)) {
          keptIndex = k;
          break;
        }
      }
      flagged = true;
      reason = preferredShort
        ? `${prefLabel} take looked truncated; kept ${prefLabel === 'first' ? 'first' : 'last'} complete take — review`
        : `${prefLabel} take had anomalously low confidence; kept prior take — review`;
    }

    if (preference === 'ask') {
      flagged = true;
      if (!reason.includes('review')) reason = `${reason} — confirm (always ask)`;
    }

    detections.push({
      alternatives: alts.map((u) => ({
        start: u.start,
        end: u.end,
        transcript: u.text,
        meanConfidence: meanConfidence(u),
      })),
      keptIndex,
      flagged,
      reason,
    });

    for (let k = 0; k < alts.length; k++) {
      if (k === keptIndex) continue;
      // Pad only the trailing edge (eats the pause before the redo);
      // padding the leading edge could clip the previous keeper's tail.
      removeRanges.push({
        start: Math.max(0, alts[k].start),
        end: alts[k].end + padding,
      });
    }
  }

  return { groups: detections, removeRanges };
}

/**
 * Convenience: words → utterances → retake groups in one call.
 * This is the detector injected into autoCut's removeRetakes stage.
 */
export function detectRetakesFromWords(
  words: Word[],
  options?: RetakeDetectionOptions,
): RetakeDetectionResult {
  return detectRetakes(segmentUtterances(words, options?.gapSeconds ?? 0.5), options);
}
