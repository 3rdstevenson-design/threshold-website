/**
 * stutterDetection.ts
 *
 * Find "restart" stutters in a word-level transcript across three passes:
 *
 *   1. Multi-word repeat (default, ≥ 2-word phrases, up to 4s gap).
 *      "I want to — I want to talk" → cut the first "I want to".
 *
 *   2. Single-word repeat (optional, 1-word within a tight ≤ 1s gap).
 *      "the the car" → cut the first "the". Tight window so we don't
 *      cut legitimate emphasis like "very very cold".
 *
 *   3. Partial-word fragment (optional). A very short token (≤ 2 chars,
 *      not a common English short word) immediately followed by a longer
 *      word that starts with the same letters is treated as a broken
 *      word — speaker started a word, stopped, then said it fully.
 *      "I went to the st- the store" → cut the stray "st" token.
 *
 * Algorithm notes:
 *   - Prefer the LONGEST match at each position to avoid cutting tiny
 *     overlaps inside legitimate long repeats.
 *   - After emitting a remove range, skip past it so we don't double-cut.
 *
 * All input times are SECONDS; all output ranges are SECONDS.
 */

import { normalizeWord } from './autoCut';
import type { Word, Range } from './autoCut';

export type StutterDetectionOptions = {
  /** Maximum seconds between the first phrase's end and the restart's start. */
  maxGapSeconds?: number;
  /** Smallest phrase (in words) to consider a stutter. Default 2. */
  minPhraseLen?: number;
  /** Longest phrase (in words) to consider. Default 8. */
  maxPhraseLen?: number;
  /** Pad the cut on each side (seconds). Default 0.05. */
  paddingSeconds?: number;
  /**
   * Also look for back-to-back identical single words within a tight
   * `singleWordGapSeconds` window. Off by default (conservative) —
   * useEditor enables it for the one-click Analyze pipeline.
   */
  singleWordRepeats?: boolean;
  /** Gap cap for single-word repeats. Default 1.0s. */
  singleWordGapSeconds?: number;
  /**
   * Also look for partial-word fragments where the speaker began a word,
   * stopped, and then said it fully. Off by default.
   */
  partialWordFragments?: boolean;
  /** Gap cap between a fragment and the full restart. Default 1.5s. */
  partialWordGapSeconds?: number;
};

export type StutterResult = {
  /** Source-time ranges to remove (seconds). */
  removeRanges: Range[];
  /** Count of n-gram stutters (≥ 2-word) removed. */
  phrasesRemoved: number;
  /** Count of single-word repeats removed. */
  singleWordsRemoved: number;
  /** Count of partial-word fragments removed. */
  fragmentsRemoved: number;
};

/**
 * Short English words that are legitimate on their own and must not be
 * treated as partial-word fragments just because they're short. Matched
 * case-insensitively.
 */
const ALLOWED_SHORT_WORDS = new Set<string>([
  'i', 'a', 'an', 'to', 'of', 'on', 'in', 'at', 'is', 'it', 'we', 'he',
  'me', 'my', 'us', 'up', 'so', 'no', 'or', 'if', 'be', 'as', 'do', 'go',
  'by', 'am', 'ye', 'ok', 'oh', 'uh', 'um', 'eh', 'ah', 'ha', 'hi', 'ya',
]);

export function detectRepeatStutters(
  words: Word[],
  options: StutterDetectionOptions = {},
): StutterResult {
  const maxGap = options.maxGapSeconds ?? 4.0;
  const minLen = options.minPhraseLen ?? 2;
  const maxLen = options.maxPhraseLen ?? 8;
  const pad = options.paddingSeconds ?? 0.05;
  const singleWordRepeats = options.singleWordRepeats ?? false;
  const singleWordGap = options.singleWordGapSeconds ?? 1.0;
  const partialWordFragments = options.partialWordFragments ?? false;
  const partialWordGap = options.partialWordGapSeconds ?? 1.5;

  // Precompute normalized tokens once. Cached for all passes.
  const norm = words.map((w) => normalizeWord(w.text));

  const removeRanges: Range[] = [];
  let phrasesRemoved = 0;
  let singleWordsRemoved = 0;
  let fragmentsRemoved = 0;

  // Per-index consumed flag so later passes skip already-cut regions.
  const consumed = new Array<boolean>(words.length).fill(false);
  const markConsumed = (from: number, toExclusive: number) => {
    for (let k = from; k < toExclusive; k++) consumed[k] = true;
  };

  // ── Pass 1: multi-word n-gram repeat (existing behavior) ─────────
  {
    let i = 0;
    while (i < words.length) {
      if (consumed[i]) { i++; continue; }
      let matched = false;
      const maxN = Math.min(maxLen, words.length - i);
      for (let n = maxN; n >= minLen; n--) {
        const phrase = norm.slice(i, i + n);
        if (phrase.every((p) => !p)) continue;

        const phraseEndSec = words[i + n - 1].end;

        for (let j = i + n; j + n <= words.length; j++) {
          const gap = words[j].start - phraseEndSec;
          if (gap < 0) continue;
          if (gap > maxGap) break;

          let same = true;
          for (let k = 0; k < n; k++) {
            if (phrase[k] !== norm[j + k]) { same = false; break; }
          }
          if (!same) continue;

          const start = Math.max(0, words[i].start - pad);
          const end = Math.max(start, words[j].start - pad);
          if (end > start) {
            removeRanges.push({ start, end });
            phrasesRemoved++;
          }
          markConsumed(i, j);
          i = j;
          matched = true;
          break;
        }
        if (matched) break;
      }
      if (!matched) i++;
    }
  }

  // ── Pass 2: single-word repeat ("the the", "I I") ───────────────
  if (singleWordRepeats) {
    for (let i = 0; i + 1 < words.length; i++) {
      if (consumed[i] || consumed[i + 1]) continue;
      if (!norm[i] || norm[i] !== norm[i + 1]) continue;
      const gap = words[i + 1].start - words[i].end;
      if (gap < 0 || gap > singleWordGap) continue;
      const start = Math.max(0, words[i].start - pad);
      const end = Math.max(start, words[i + 1].start - pad);
      if (end <= start) continue;
      removeRanges.push({ start, end });
      singleWordsRemoved++;
      markConsumed(i, i + 1);
    }
  }

  // ── Pass 3: partial-word fragments ("the st- the store") ───────
  // The fragment's "real" word may not be the immediate next token — the
  // speaker often repeats a filler word ("the") before the full word.
  // Scan ahead up to FRAGMENT_LOOKAHEAD tokens (within partialWordGap
  // seconds) for any word ≥ 3 chars that starts with the fragment.
  const FRAGMENT_LOOKAHEAD = 4;
  if (partialWordFragments) {
    for (let i = 0; i + 1 < words.length; i++) {
      if (consumed[i]) continue;
      const fragment = norm[i];
      if (!fragment || fragment.length === 0 || fragment.length > 2) continue;
      if (ALLOWED_SHORT_WORDS.has(fragment)) continue;

      let matchIdx = -1;
      const maxJ = Math.min(words.length, i + 1 + FRAGMENT_LOOKAHEAD);
      for (let j = i + 1; j < maxJ; j++) {
        if (consumed[j]) break;
        const candidate = norm[j];
        if (candidate.length < 3) continue;
        if (!candidate.startsWith(fragment)) continue;
        const gap = words[j].start - words[i].end;
        if (gap < 0 || gap > partialWordGap) break;
        matchIdx = j;
        break;
      }
      if (matchIdx === -1) continue;

      // Cut the fragment token itself (pad on both sides) so the
      // transcript reads naturally once cut. We only remove `[i..i+1]`
      // — the restart words are kept.
      const start = Math.max(0, words[i].start - pad);
      const end = Math.max(start, words[i].end + pad);
      if (end <= start) continue;
      removeRanges.push({ start, end });
      fragmentsRemoved++;
      markConsumed(i, i + 1);
    }
  }

  return {
    removeRanges,
    phrasesRemoved,
    singleWordsRemoved,
    fragmentsRemoved,
  };
}
