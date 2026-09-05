/**
 * captionChunker.ts
 *
 * Convert word-level whisper timestamps into ≤4-word caption chunks
 * timed to the EDITED timeline (after cuts applied by editPlan.clips).
 *
 * Rules:
 *   - Each chunk has at most 4 words.
 *   - A chunk breaks on punctuation-ending words (. ! ?).
 *   - A gap of ≥ 250ms between consecutive kept words forces a new chunk.
 *   - Words that land inside a cut (removed) region are skipped.
 */

import { Caption, Clip, clipEditedMs, clipSpeed, randomId } from './editPlan';
import type { Word } from './autoCut';

export type CaptionChunkOptions = {
  /** Max words in a single caption chunk. Default 3. */
  maxWords?: number;
  /** If a gap between two consecutive kept words is ≥ this, force a
   *  chunk break. Default 250ms. */
  pauseBreakMs?: number;
  /** Subtract this from each caption's startMs so it appears just
   *  before the speaker says the first word. Default 150ms. */
  leadInMs?: number;
  /** Extend each caption's endMs toward the next caption's startMs if the
   *  gap between them is under this threshold. Default 800ms. */
  gapFillMs?: number;
  /** Hard cap on how far past its last spoken word a caption may linger
   *  when gap-filling. Keeps chips tight to speech so a manual cut right
   *  after a sentence doesn't land inside a long padded tail. Default
   *  300ms. */
  maxTailMs?: number;
  /** Hard ceiling on the JOINED caption text length. If adding the next
   *  word would push past this, break the chunk. Prevents CSS ellipsis
   *  mid-word (user requirement: never cut a word in half). Default 18. */
  maxChars?: number;
  /** Automatically merge whisper SUB-TOKEN fragments (e.g. "nihil"+"ism"
   *  → "nihilism") into single words. ON by default with a very tight
   *  10ms gap threshold — genuine sub-token splits have ≈0ms gap, while
   *  even the fastest fluent speech has 30ms+ between real words. */
  autoMergeFragments?: boolean;
  /** Gap threshold for auto-merge. Default 0.001s (1ms). Real whisper
   *  sub-token splits have gap = 0 (same 10ms frame — identical
   *  timestamps). Real adjacent words always land in separate frames,
   *  which whisper renders as measurable gaps (typically ≥ 20ms, but
   *  even the tightest fluent-speech adjacency still registers ≥ 2ms).
   *  Empirically, 1ms is tight enough to reject all observed false
   *  positives in fast speech while still catching every genuine
   *  sub-token split. */
  fragmentGapSeconds?: number;
  /** Spelling corrections applied to each caption's text as a final
   *  post-processing pass. Matched case-insensitively with word
   *  boundaries, replacement preserves the original case style of the
   *  `to` field. Useful for phonetic mis-transcriptions ("Coach Cav" →
   *  "Coach Kav") and diacritics ("Soren" → "Søren"). */
  customSpellings?: { from: string; to: string }[];
};

/**
 * Remap a source-time second value onto the edited-timeline millisecond.
 * Returns null if the source time lands inside a cut region.
 */
export function sourceSecToEditedMs(
  clips: Clip[],
  sourceSec: number,
): number | null {
  let acc = 0;
  for (const clip of clips) {
    if (sourceSec >= clip.sourceStart && sourceSec <= clip.sourceEnd) {
      return Math.round(acc + ((sourceSec - clip.sourceStart) * 1000) / clipSpeed(clip));
    }
    acc += clipEditedMs(clip);
  }
  return null;
}

/**
 * Produce caption chunks timed to the edited timeline.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║ WORD-ATOMICITY RULE                                              ║
 * ║ Every output caption is composed of WHOLE whisper-word tokens    ║
 * ║ joined by spaces. No rule — not maxWords, maxChars, pauseBreak,  ║
 * ║ nor sentence-end — will ever split a single input word across    ║
 * ║ two captions, insert a break mid-letter, or emit a partial word. ║
 * ║ A single input word whose length exceeds maxChars still emits    ║
 * ║ whole (in its own chunk); it will NEVER be hyphenated or sliced. ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Preprocessing (runs before chunking):
 *   1. Strip whitespace from every token.
 *   2. Skip empty or punctuation-only tokens.
 *   3. Re-attach contraction fragments (".'t", "'s", "'re", "'ll", "'ve",
 *      "'d", "'m", "n't") to the previous word — whisper.cpp sometimes
 *      emits these as their own tokens, which would otherwise cause the
 *      chunker to break "can't" across two chunks.
 *   4. Drop a leading standalone punctuation chunk ("." at start).
 *
 * Output joining:
 *   - words joined with a single space
 *   - commas/periods are immediately tight to the previous word
 *     ("word, word" not "word , word")
 */
export function chunkCaptions(
  words: Word[],
  clips: Clip[],
  options: CaptionChunkOptions = {},
): Caption[] {
  const maxWords = options.maxWords ?? 3;
  const pauseBreakMs = options.pauseBreakMs ?? 250;
  // Whisper's word-level timestamps typically lag real speech onset by
  // ~100-200ms (especially on stop consonants). 150ms lead-in keeps the
  // caption on screen just before the speaker says the first word.
  const leadInMs = options.leadInMs ?? 150;
  const gapFillMs = options.gapFillMs ?? 800;
  const maxTailMs = options.maxTailMs ?? 300;
  const maxChars = options.maxChars ?? 18;
  const autoMergeFragments = options.autoMergeFragments ?? true;
  const fragmentGap = options.fragmentGapSeconds ?? 0.001;
  const customSpellings = options.customSpellings ?? [];

  // Auto-merge whisper sub-token fragments. Tight 10ms threshold
  // reliably distinguishes genuine sub-token splits (≈0ms gap, e.g.
  // "nihil" + "ism" = "nihilism") from fluent fast speech (≥ 30ms
  // between real words).
  const mergedWords = autoMergeFragments
    ? mergeFragments(words, fragmentGap)
    : words;

  // First, filter to words that survive the cut and remap their timing.
  // A word is KEPT if its *midpoint* lies inside any clip. If the word
  // straddles a cut boundary, its start/end are CLAMPED to the clip edge
  // rather than the whole word being dropped — whisper's word timestamps
  // have ~100ms of slop, so a small overlap with a cut shouldn't silence
  // the word on screen.
  type Remapped = {
    text: string;
    editedStartMs: number;
    editedEndMs: number;
    endsSentence: boolean;
  };
  const raw: Remapped[] = [];
  for (const w of mergedWords) {
    const text = w.text.trim();
    if (!text) continue;
    const midSec = (w.start + w.end) / 2;
    // Find the clip that owns this word (by midpoint).
    const owning = clips.find(
      (c) => midSec >= c.sourceStart && midSec <= c.sourceEnd,
    );
    if (!owning) continue;
    // Clamp raw source start/end to the owning clip's boundaries so a
    // word whose whisper timestamps spill into an adjacent cut still
    // maps cleanly to an edited-timeline range.
    const clampedStart = Math.max(w.start, owning.sourceStart);
    const clampedEnd = Math.min(w.end, owning.sourceEnd);
    const startMs = sourceSecToEditedMs(clips, clampedStart);
    const endMs = sourceSecToEditedMs(clips, clampedEnd);
    if (startMs === null || endMs === null) continue;
    if (endMs <= startMs) continue;
    raw.push({
      text,
      editedStartMs: startMs,
      editedEndMs: endMs,
      endsSentence: /[.!?]"?$/.test(text),
    });
  }

  // Merge pass: attach contraction fragments + pure-punctuation tokens
  // onto the previous word's text, without creating a new word-unit.
  const contractionFragment = /^(?:n?'[a-zA-Z]{1,3}|'[a-zA-Z]{1,3})$/; // 't, 's, 'll, 're, 've, 'd, 'm, n't
  const isLeadingPunct = (s: string) => /^[.,!?;:]+$/.test(s);
  const kept: Remapped[] = [];
  for (const w of raw) {
    const prev = kept[kept.length - 1];
    if (prev) {
      // Contraction: "can" + "'t" → "can't"
      if (contractionFragment.test(w.text)) {
        prev.text = `${prev.text}${w.text}`;
        prev.editedEndMs = w.editedEndMs;
        prev.endsSentence = /[.!?]"?$/.test(prev.text);
        continue;
      }
      // Stand-alone punctuation: "word" + "." → "word."
      if (isLeadingPunct(w.text)) {
        prev.text = `${prev.text}${w.text}`;
        prev.editedEndMs = w.editedEndMs;
        prev.endsSentence = /[.!?]"?$/.test(prev.text);
        continue;
      }
    }
    kept.push({ ...w });
  }

  // Drop any leading word that is ONLY punctuation (so captions never
  // start with "." or ",").
  while (kept.length > 0 && /^[.,!?;:]+$/.test(kept[0].text)) {
    kept.shift();
  }

  // Build chunks.
  const captions: Caption[] = [];
  let buf: Remapped[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    const text = joinCaptionText(buf.map((r) => r.text));
    if (text) {
      captions.push({
        id: randomId('cap'),
        text,
        startMs: buf[0].editedStartMs,
        endMs: buf[buf.length - 1].editedEndMs,
        // Word-level timing is required for the karaoke renderer and
        // cheap to carry — emit it on every caption. Chunks renderer
        // ignores it.
        words: buf.map((r) => ({
          text: r.text,
          startMs: r.editedStartMs,
          endMs: r.editedEndMs,
        })),
      });
    }
    buf = [];
  };

  for (let i = 0; i < kept.length; i++) {
    const w = kept[i];
    if (buf.length === 0) {
      buf.push(w);
      continue;
    }

    const prev = buf[buf.length - 1];
    const gap = w.editedStartMs - prev.editedEndMs;
    const wouldExceed = buf.length >= maxWords;
    const pauseBreak = gap >= pauseBreakMs;
    // Character-count break — WORD-ATOMICITY preserved: we always break
    // BEFORE `w` (pushing `w` into the NEXT chunk as a whole unit), never
    // partway through it. If `w` alone exceeds maxChars it still emits
    // whole in its own chunk — the render layer's auto-shrink + wrap
    // handles display; the chunker never slices a letter off a word.
    const tentative = joinCaptionText([...buf.map((r) => r.text), w.text]);
    const charBreak = buf.length > 0 && tentative.length > maxChars;

    if (wouldExceed || pauseBreak || charBreak) {
      flush();
      buf.push(w); // `w` stays whole — atomicity invariant
      continue;
    }

    buf.push(w);
    if (w.endsSentence && buf.length >= 2) {
      flush();
    }
  }
  flush();

  // Apply lead-in + gap-fill so captions feel tight to speech.
  for (let i = 0; i < captions.length; i++) {
    captions[i].startMs = Math.max(0, captions[i].startMs - leadInMs);
  }
  for (let i = 0; i < captions.length - 1; i++) {
    const gap = captions[i + 1].startMs - captions[i].endMs;
    if (gap > 0 && gap <= gapFillMs) {
      // Bridge toward the next caption, but never linger more than
      // maxTailMs past the last spoken word — long padded tails made
      // manual cuts land inside a caption and delete it.
      captions[i].endMs = Math.min(captions[i + 1].startMs, captions[i].endMs + maxTailMs);
    }
  }

  // Apply custom spelling corrections as a final text-only pass. Works
  // regardless of how tokens were originally split because it runs on
  // the joined caption text. Preserves timing untouched.
  if (customSpellings.length > 0) {
    for (const cap of captions) {
      cap.text = applySpellingCorrections(cap.text, customSpellings);
    }
  }

  return captions;
}

/**
 * Apply a list of spelling corrections to a caption text string.
 * Each correction matches case-insensitively on word boundaries; the
 * replacement is inserted verbatim (preserving its intended casing/
 * diacritics — e.g. "Søren" or "Coach Kav"). Supports multi-word
 * matches ("coach cav" → "Coach Kav").
 */
export function applySpellingCorrections(
  text: string,
  corrections: { from: string; to: string }[],
): string {
  let out = text;
  for (const { from, to } of corrections) {
    if (!from || !to) continue;
    const escaped = escapeRegex(from.trim());
    if (!escaped) continue;
    // \b works for ASCII; for our use cases (English + diacritics in
    // `to` only, not in `from`) this is sufficient.
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    out = out.replace(re, to);
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Common short English words that a whisper sub-token split would NEVER
 * produce, but that DO appear legitimately on either side of a merge
 * candidate. Blocking these on BOTH tokens prevents glue-ups like:
 *   - "choice" + "is"       → "choiceis"     (common on the RIGHT)
 *   - "that"   + "nothing"  → "thatnothing"  (common on the LEFT)
 *   - "has"    + "inherent" → "hasinherent"  (common on the LEFT)
 *   - "me"     + "because"  → "mebecause"    (common on the LEFT)
 * Fragment tokens ("nihil", "pred", "S", "Kie", "rke", "gaard", "icated")
 * are non-common — they pass the check and merge as intended.
 */
const COMMON_ENGLISH_WORDS = new Set<string>([
  // function words
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
  'if', 'as', 'at', 'by', 'in', 'of', 'on', 'to', 'up', 'is', 'it',
  'be', 'am', 'do', 'no', 'not', 'we', 'he', 'me', 'my', 'us',
  // pronouns + common shorts
  'i', 'you', 'your', 'his', 'her', 'hers', 'its', 'our', 'ours',
  'they', 'them', 'their', 'theirs', 'this', 'that', 'these', 'those',
  // auxiliary/common verbs
  'are', 'was', 'were', 'been', 'has', 'had', 'have', 'does', 'did',
  'can', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
  // quantifiers / other
  'all', 'any', 'some', 'one', 'two', 'too', 'very', 'just', 'also',
  'only', 'even', 'still', 'such', 'which', 'what', 'when', 'where',
  'who', 'why', 'how', 'now', 'then', 'than', 'there', 'here',
  // content-word shorts that fluent speech can drop the gap on,
  // causing false positives in the fragment-merge heuristic
  'own', 'new', 'old', 'big', 'yes', 'get', 'got', 'put', 'let',
  'say', 'see', 'way', 'day', 'out', 'off',
]);

/**
 * Bound morphological suffixes produced by whisper sub-token splits. A
 * SECOND token matching one of these is almost certainly a continuation of
 * the previous word, not a standalone word:
 *   "nihil" + "ism"   → "nihilism"
 *   "talk"  + "ing"   → "talking"
 *   "happ"  + "ily"   → "happily"
 *   "pred"  + "icated"→ "predicated"
 *
 * IMPORTANT: this list contains ONLY morphemes that are never standalone
 * English words. Real words that happen to look like suffixes — able, less,
 * age, ant, ent, ship, ward, wise, hood, al, ic — were REMOVED because
 * whisper reports gap≈0 between ordinary adjacent words too, so this path
 * was gluing real pairs ("being"+"able" → "beingable", "lot"+"less" →
 * "lotless"). Those now stay split.
 */
const WHISPER_SUFFIX_FRAGMENT =
  /^(ism|ist|ity|ing|ed|ly|er|est|ous|ful|ness|ment|tion|sion|ible|ical|ize|ify|ance|ence|ary|ory|ive|icated|icating)$/;

/**
 * Merge adjacent whisper tokens that are almost certainly fragments of
 * the same spoken word.
 *
 * Three merge paths, any of which suffices:
 *
 *   Path A — SUFFIX MATCH (gap-agnostic):
 *     Second token matches WHISPER_SUFFIX_FRAGMENT (ism/ing/ed/ly/…).
 *     Merges nihil+ism, talk+ing, pred+icated. These suffixes are never
 *     standalone English words, so the merge is always safe.
 *
 *   Path B — PROPER-NOUN FRAGMENT (tight gap):
 *     prev starts with a capital letter, curr.length ≤ 5 lowercase,
 *     gap < 10ms, neither token is a common English word. Catches
 *     S+oren, Kie+rke+gaard, Soc+rat+ic.
 *
 *   Path C — TIGHT-GAP SHORT FRAGMENT:
 *     gap < 10ms AND at least one token ≤ 4 chars AND neither token is
 *     a common English word. Symmetric common-words guard prevents
 *     "that"+"nothing", "me"+"because", "has"+"inherent" — observed
 *     live caption garblings where the LEFT token was the common word.
 *
 *   All paths require base filters: pure-alphabetic both sides, curr
 *   lowercase first letter, no contraction fragment, no sentence-ending
 *   punctuation on prev.
 *
 * Contraction fragments ('t, 's, 'll, etc) are handled by a separate
 * pass in the main chunker; we explicitly skip them here.
 *
 * `_fragmentGap` is retained in the signature for backwards compatibility
 * but ignored — the internal 10ms threshold is what gates Paths B and C.
 */
const MERGE_TIGHT_GAP_SEC = 0.010;

export function mergeFragments(
  words: Word[],
  _fragmentGap = 0.001,
  commonWords: Set<string> = COMMON_ENGLISH_WORDS,
): Word[] {
  if (words.length === 0) return words;
  const contractionFragment = /^(?:n?'[a-zA-Z]{1,3}|'[a-zA-Z]{1,3})$/;
  const isPureAlpha = (s: string) => /^[a-zA-Z]+$/.test(s);
  const out: Word[] = [{ ...words[0] }];
  for (let i = 1; i < words.length; i++) {
    const prev = out[out.length - 1];
    const curr = words[i];
    const prevText = prev.text.trim();
    const currText = curr.text.trim();

    const baseOk =
      isPureAlpha(prevText) &&
      isPureAlpha(currText) &&
      !contractionFragment.test(currText) &&
      currText[0] === currText[0].toLowerCase() &&
      !/[.!?]"?$/.test(prevText);

    if (!baseOk) {
      out.push({ ...curr });
      continue;
    }

    const prevLower = prevText.toLowerCase();
    const currLower = currText.toLowerCase();
    const gapSec = curr.start - prev.end;
    const tightGap = gapSec >= 0 && gapSec < MERGE_TIGHT_GAP_SEC;
    const neitherCommon =
      !commonWords.has(prevLower) && !commonWords.has(currLower);

    // Path A: known morphological suffix on the second token (ism/ing/ed/…).
    // Requires the SAME tight-gap + non-common guards as Paths B and C.
    // It used to be gap-agnostic with no common-word check, which glued
    // real words whenever the "suffix" was also a standalone word:
    // "the"+"ship" → "theship", "be"+"able" → "beable", "old"+"age" →
    // "oldage", "do"+"less" → "doless". Genuine sub-token splits
    // ("nihil"+"ism", "compl"+"icated") have ≈0ms gaps and non-common
    // tokens, so they still merge.
    const suffixFragment =
      WHISPER_SUFFIX_FRAGMENT.test(currText) && tightGap && neitherCommon;

    // Path B: a SHORT capitalized fragment + a short lowercase continuation
    // (e.g. "S"+"oren", "Soc"+"rates"). The prev must be ≤3 chars — a real
    // sub-token fragment is tiny, whereas a capitalized SENTENCE-START word
    // ("Nothing"+"beats", "People"+"think") is longer and must NOT be glued.
    const properNounFragment =
      /^[A-Z]/.test(prevText) &&
      prevText.length <= 3 &&
      currText.length <= 5 &&
      tightGap &&
      neitherCommon;

    // Path C: a genuine SHORT broken-off fragment merging onto its neighbour.
    // Whisper assigns 0ms gaps even between ordinary adjacent words (e.g.
    // "step"|"process" both report gap=0), so the gap is NOT a reliable
    // fragment signal — the length cap carries the weight. Only a ≤2-char
    // token (a real stray fragment) qualifies; a 3-4 char token is almost
    // always a whole word, so this stops glue-ups like "step"+"process" →
    // "stepprocess" and "first"+"step" → "firststep".
    const oneVeryShort = prevText.length <= 2 || currText.length <= 2;
    const tightGapShort = tightGap && oneVeryShort && neitherCommon;

    if (suffixFragment || properNounFragment || tightGapShort) {
      prev.text = prevText + currText;
      prev.end = curr.end;
    } else {
      out.push({ ...curr });
    }
  }
  return out;
}

/**
 * Joins a list of word tokens into caption display text.
 * - single space between adjacent words
 * - no space BEFORE comma / period / etc (". , ? !")
 * - collapses runs of whitespace
 * - trims leading/trailing whitespace
 * - strips a leading lone punctuation ("." "," etc) if somehow present
 */
export function joinCaptionText(tokens: string[]): string {
  let out = '';
  for (const tok of tokens) {
    const t = tok.trim();
    if (!t) continue;
    if (!out) { out = t; continue; }
    if (/^[.,!?;:]/.test(t)) {
      out += t;
    } else {
      out += ' ' + t;
    }
  }
  out = out.replace(/\s+/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim();
  out = out.replace(/^[.,!?;:]+\s*/, '');
  return out;
}
