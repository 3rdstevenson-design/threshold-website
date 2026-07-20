/**
 * disfluency.ts
 *
 * Semantic disfluency detection via Claude. Used by the Polish route as
 * an additive layer on top of the rule-based auto-cut (silences, filler
 * words, repeat stutters). Claude catches what rules miss:
 *
 *   - Verbal restarts with DIFFERENT words
 *     ("I started — well, I mean, I began by…")
 *   - Semantic repeats (same idea rephrased adjacent without added value)
 *   - False starts and abandoned clauses
 *   - Micro-hesitations ("you know," "like I said") that slipped past
 *     the filler list because they're contextual
 *
 * Input: a word-level transcript (from analysis.json.words) scoped to
 * only the intervals the user has already kept (plan.clips).
 *
 * Output: source-time ranges to ADDITIONALLY remove. These merge with
 * the existing plan.clips via invertRanges/mergeRanges in the Polish
 * route — the result is a tighter polished plan.
 *
 * All times are SECONDS (matches analysis.json and plan.clips).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Word, Range } from './autoCut';
import type { Clip } from './editPlan';

/**
 * Per-range length cap. Anything longer than this is almost certainly
 * an abandoned multi-clause take, not a disfluency — we drop those.
 * (Disfluencies rarely span more than 2–3 seconds.)
 */
export const MAX_RANGE_SECONDS = 4.0;

/**
 * Upper bound on how much of the scoped content Polish will remove.
 * Expressed as a fraction of the already-kept duration (after rule-based
 * auto-cuts). If Claude flags more than this, we keep only the shortest
 * ranges (most likely real disfluencies) until we're back under the cap.
 *
 * Rationale: hand-edited reference cut ≈23% more from the pre-polish
 * manual edit; 25% gives us room to match human behavior without letting
 * a misfire wipe out entire takes.
 */
export const MAX_CUT_RATIO = 0.25;

export type DisfluencyRange = {
  /** Stable id so the UI can reference approve/reject per range. */
  id: string;
  startSec: number;
  endSec: number;
  reason: string;
  /** First and last word indices (in the scoped word array) — for logging. */
  startIdx: number;
  endIdx: number;
  /** Preview of the actual words this range would cut, for UI display. */
  preview: string;
  /** True if the cap logic dropped this range (kept here for transparency). */
  rejected?: 'too-long' | 'total-cap';
};

export type DisfluencyResult = {
  ranges: DisfluencyRange[];
  /** Every range Claude proposed, including ones dropped by the caps. */
  proposed: DisfluencyRange[];
  /** Raw Claude output for debugging (persisted alongside). */
  raw: string;
  /** Word count submitted. If < 30, the pass is skipped and returns empty. */
  wordCount: number;
  /** Scoped seconds (sum of kept source windows) — denominator for the ratio cap. */
  scopedSeconds: number;
};

const SYSTEM_PROMPT = `You are an expert video editor reviewing a word-level transcript from a short-form video (Instagram Reels / TikTok). The speaker has already had silences and common filler words (um, uh, like, basically) cut out by rule-based tools. Your job is the SEMANTIC layer that rules can't catch.

Flag ranges of words that should be cut because they are disfluencies. A disfluency is any span that reduces clarity without adding meaning. Prioritize these patterns, in order:

1. VERBAL RESTARTS with DIFFERENT words. The speaker begins a sentence, abandons it, and restarts with new phrasing. Cut the abandoned fragment, keep the successful take.
   "I started — well, I mean, I began by…" → cut "I started well I mean"
   "So the thing is — the real point is…" → cut "So the thing is"

2. SEMANTIC REPEATS. The same idea expressed twice back-to-back without added information. Cut the first instance (unless it's clearly the more polished one).

3. ABANDONED CLAUSES. A phrase that trails off into a restart, with no semantic closure.
   "And when you — you know what I mean, let's move on" → cut "And when you you know what I mean"

4. CONTEXTUAL FILLERS that slipped past the filler list because they're only fillers in context.
   "you know" when it's not literally checking the listener knows something
   "like I said" when nothing was said
   "I guess" when not actually expressing uncertainty

DO NOT cut:
- Legitimate emphasis ("very very cold")
- Intentional parallel structure
- Intended pauses for dramatic effect (usually already kept by the silence tool)
- Content that changes meaning if removed
- Punctuation-only tokens (just ignore them)

HARD CONSTRAINTS — these are ceilings, not targets:
- Keep each range SHORT and LOCAL. A real disfluency rarely spans more than 2–3 seconds or ~8 words. If you are about to mark a range of a dozen+ words, you are almost certainly cutting content (an abandoned alternate take) rather than a disfluency — reconsider. Ranges over ~4 seconds will be dropped by a post-filter.
- Do NOT flag more than ~25% of the total words. If you find yourself wanting to, you have crossed from disfluency-editing into rewriting — stop and return fewer cuts. A post-filter will keep only the shortest ranges until the total is back under 25%.
- Prefer MANY SHORT cuts over FEW LONG cuts. Three 1-second cuts > one 5-second cut.

Be CONSERVATIVE. If in doubt, do NOT cut. Removing a legitimate word is worse than leaving a disfluency.

OUTPUT FORMAT: Return a JSON object ONLY, no prose. Shape:
{"cuts": [{"startIdx": 5, "endIdx": 8, "reason": "verbal restart"}, …]}

The indices refer to the numbered word list in the user message (1-indexed). startIdx and endIdx are INCLUSIVE. reason is a ≤ 40-char label.

If there are no disfluencies, return {"cuts": []}.`;

/**
 * Run the Claude disfluency pass. Skips and returns empty when the
 * transcript is tiny (< 30 words) — not enough signal to risk cutting.
 *
 * Caller is responsible for merging `ranges` into the edit plan's
 * skip-range set via mergeRanges/invertRanges.
 */
export async function detectDisfluencies(input: {
  words: Word[];
  clips: Clip[];
  apiKey: string;
  model?: string;
  /**
   * Optional prompt-level context block from lib/performanceCorpus. When
   * provided, it's injected into the user message as soft guidance — the
   * hard constraints in SYSTEM_PROMPT still cap cut-ratio and range length.
   */
  performanceContext?: string;
  onLog?: (msg: string) => void;
}): Promise<DisfluencyResult> {
  const log = input.onLog ?? (() => {});
  const scopedWords = scopeWordsToClips(input.words, input.clips);
  const scopedSeconds = scopedSecondsOf(scopedWords);
  if (scopedWords.length < 30) {
    log(`Skipping Claude disfluency pass (only ${scopedWords.length} words, min 30).`);
    return { ranges: [], proposed: [], raw: '', wordCount: scopedWords.length, scopedSeconds };
  }

  log(`Running Claude disfluency pass on ${scopedWords.length} words…`);
  if (input.performanceContext) {
    log('  (injecting performance corpus as soft context)');
  }

  const numbered = scopedWords
    .map((w, i) => `${i + 1}. ${w.text}`)
    .join('\n');

  const anthropic = new Anthropic({ apiKey: input.apiKey });
  const model = input.model ?? 'claude-sonnet-4-6';

  const userMessage = input.performanceContext
    ? `${input.performanceContext}\n\n---\n\nHere is the word-level transcript (1-indexed). Identify disfluency ranges to cut.\n\n${numbered}`
    : `Here is the word-level transcript (1-indexed). Identify disfluency ranges to cut.\n\n${numbered}`;

  const res = await anthropic.messages.create({
    model,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
  });

  const raw = res.content[0]?.type === 'text' ? res.content[0].text.trim() : '';
  if (!raw) {
    log('Claude returned empty response — skipping disfluency cuts.');
    return { ranges: [], proposed: [], raw, wordCount: scopedWords.length, scopedSeconds };
  }

  const cuts = parseClaudeResponse(raw);
  const proposed: DisfluencyRange[] = [];
  for (const cut of cuts) {
    const startIdx = cut.startIdx - 1;
    const endIdx = cut.endIdx - 1;
    if (startIdx < 0 || endIdx >= scopedWords.length || endIdx < startIdx) {
      log(`  ✗ skipping invalid range [${cut.startIdx}..${cut.endIdx}]`);
      continue;
    }
    const startSec = scopedWords[startIdx].start;
    const endSec = scopedWords[endIdx].end;
    const previewWords = scopedWords
      .slice(startIdx, endIdx + 1)
      .map((w) => w.text)
      .join(' ');
    const preview = previewWords.length > 80
      ? previewWords.slice(0, 77) + '…'
      : previewWords;
    proposed.push({
      id: `df_${cut.startIdx}_${cut.endIdx}`,
      startSec,
      endSec,
      reason: cut.reason.slice(0, 40),
      startIdx: cut.startIdx,
      endIdx: cut.endIdx,
      preview,
    });
  }

  // Apply caps: length + total-ratio. Annotates rejections on `proposed`
  // so the UI (and debug log) can explain why a cut didn't apply.
  const kept = applyAggressivenessCaps(proposed, scopedSeconds, log);

  for (const r of kept) {
    log(
      `  ↳ ${r.preview}` +
        ` (${r.startSec.toFixed(2)}s–${r.endSec.toFixed(2)}s) — ${r.reason}`,
    );
  }
  log(`Claude flagged ${proposed.length}, kept ${kept.length} after caps.`);

  return { ranges: kept, proposed, raw, wordCount: scopedWords.length, scopedSeconds };
}

/**
 * Enforce the two hard ceilings on Claude's proposal:
 *  1. Drop any single range longer than MAX_RANGE_SECONDS
 *  2. If the remaining total cut exceeds MAX_CUT_RATIO of the scoped
 *     seconds, keep only the shortest ranges (disfluencies tend to be
 *     short) until the total is back under the cap.
 *
 * Mutates `proposed` (tagging dropped entries with `.rejected`) and
 * returns the kept list in chronological order.
 */
function applyAggressivenessCaps(
  proposed: DisfluencyRange[],
  scopedSeconds: number,
  log: (m: string) => void,
): DisfluencyRange[] {
  const withinLength: DisfluencyRange[] = [];
  for (const r of proposed) {
    const dur = r.endSec - r.startSec;
    if (dur > MAX_RANGE_SECONDS) {
      r.rejected = 'too-long';
      log(`  ✗ dropped ${dur.toFixed(1)}s range (> ${MAX_RANGE_SECONDS}s cap) — ${r.reason}`);
      continue;
    }
    withinLength.push(r);
  }

  const maxCutSeconds = scopedSeconds * MAX_CUT_RATIO;
  // Shortest-first for the greedy fill — real disfluencies skew short,
  // so we prefer them when the cap forces us to choose.
  const byLength = [...withinLength].sort(
    (a, b) => (a.endSec - a.startSec) - (b.endSec - b.startSec),
  );
  const keptIds = new Set<string>();
  let cumulative = 0;
  for (const r of byLength) {
    const d = r.endSec - r.startSec;
    if (cumulative + d > maxCutSeconds) {
      r.rejected = 'total-cap';
      log(
        `  ✗ dropped ${d.toFixed(1)}s range — total-cap ` +
          `(${maxCutSeconds.toFixed(1)}s of ${scopedSeconds.toFixed(1)}s scoped)`,
      );
      continue;
    }
    keptIds.add(r.id);
    cumulative += d;
  }
  // Chronological order for downstream use.
  return withinLength.filter((r) => keptIds.has(r.id));
}

function scopedSecondsOf(words: Word[]): number {
  if (words.length === 0) return 0;
  // Sum of word durations is a fair proxy for kept speech-time; falls back
  // to total span if words are sparse.
  let sum = 0;
  for (const w of words) sum += Math.max(0, w.end - w.start);
  const span = words[words.length - 1].end - words[0].start;
  return Math.max(sum, span);
}

/**
 * Convert disfluency ranges into the `Range[]` shape autoCut expects,
 * so the caller can feed them into invertRanges/mergeRanges alongside
 * the existing plan cuts.
 */
export function disfluencyToRemoveRanges(
  ranges: DisfluencyRange[],
  paddingSeconds = 0.05,
): Range[] {
  return ranges.map((r) => ({
    start: Math.max(0, r.startSec - paddingSeconds),
    end: r.endSec + paddingSeconds,
  }));
}

// ── Helpers ──────────────────────────────────────────────────────────

function scopeWordsToClips(words: Word[], clips: Clip[]): Word[] {
  if (clips.length === 0) return words;
  const sortedClips = [...clips].sort((a, b) => a.sourceStart - b.sourceStart);
  return words.filter((w) => {
    for (const c of sortedClips) {
      if (w.start >= c.sourceStart && w.end <= c.sourceEnd) return true;
    }
    return false;
  });
}

type ParsedCut = { startIdx: number; endIdx: number; reason: string };

function parseClaudeResponse(text: string): ParsedCut[] {
  // Strip code fences and any leading/trailing prose.
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const firstBrace = t.indexOf('{');
  const lastBrace = t.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < firstBrace) return [];
  const json = t.slice(firstBrace, lastBrace + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { cuts?: unknown }).cuts)
  ) {
    return [];
  }
  const raw = (parsed as { cuts: unknown[] }).cuts;
  const out: ParsedCut[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as ParsedCut).startIdx === 'number' &&
      typeof (item as ParsedCut).endIdx === 'number'
    ) {
      const rec = item as ParsedCut;
      out.push({
        startIdx: Math.floor(rec.startIdx),
        endIdx: Math.floor(rec.endIdx),
        reason: typeof rec.reason === 'string' ? rec.reason : '',
      });
    }
  }
  return out;
}
