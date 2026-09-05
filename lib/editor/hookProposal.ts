/**
 * hookProposal.ts — propose the on-screen hook card for a talking-head reel.
 *
 * Why: the spoken opening of a reel winds up before the claim lands ("If
 * you're an athlete and you're receiving physical therapy or rehab for any
 * kind of injury, do not ice after your sessions"), and word-by-word
 * captions in the first 3s just reveal that wind-up. Kallaway's system puts
 * the TEXT hook first (85% watch on mute). This module has Claude compress
 * the opening into a ≤9-word claim, scores candidates with the viral hook
 * rubric (wiki: concept-viral-hook-rubric), lint-checks them against Voice
 * DNA, and applies the winner as `plan.header` with a 3s fade — unless the
 * user already wrote a header, which is never overwritten.
 *
 * Failure is never fatal: no key / API error / every candidate failing lint
 * → a warning and (in the unattended pipeline) a review flag.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Word } from './autoCut';
import { filterWordsByClips } from './autoCut';
import type { Clip, EditPlan, HeaderConfig } from './editPlan';
import { applyAction } from './editPlan';
import { BANNED_PHRASES, lintAndAutoFix } from '@/lib/voice/voiceDnaLint';

export type HookType = 'contrarian' | 'statistic' | 'stakes' | 'question' | 'story' | 'statement';

export type HookCandidate = {
  id: string;
  text: string;
  type: HookType;
  rubric: { hookStrength: number; payoffClarity: number; shareability: number };
  /** 2*hookStrength + payoffClarity + shareability, 0–12. */
  score: number;
  rationale: string;
  lint: { pass: boolean; autoFixed: boolean; violations: string[] };
};

export type HookProposal = {
  generatedAt: string;
  model: string;
  sourceWords: number;
  candidates: HookCandidate[];
  /** Best lint-passing candidate, or null. */
  chosenId: string | null;
  applied: boolean;
  skippedBecause?: string;
  /** Review flags this proposal raises for the unattended pipeline. */
  flags: ('hook-lint' | 'hook-low-score')[];
};

export const DEFAULT_HOOK_MODEL = process.env.EDITOR_HOOK_MODEL || 'claude-opus-5';
export const FALLBACK_HOOK_MODEL = process.env.EDITOR_HOOK_FALLBACK_MODEL || 'claude-sonnet-5';
export const HOOK_MAX_WORDS = 9;
export const HOOK_FADE_AFTER_SECONDS = 3;
/** Rubric hook-strength below which the auto path asks for a human look. */
export const HOOK_MIN_STRENGTH = 2;
/** How much of the (kept) opening the model sees, in seconds of speech. */
export const HOOK_OPENING_SECONDS = 40;

const HOOK_TYPES: HookType[] = ['contrarian', 'statistic', 'stakes', 'question', 'story', 'statement'];

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'type', 'hookStrength', 'payoffClarity', 'shareability', 'rationale'],
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: HOOK_TYPES },
          hookStrength: { type: 'integer', minimum: 0, maximum: 3 },
          payoffClarity: { type: 'integer', minimum: 0, maximum: 3 },
          shareability: { type: 'integer', minimum: 0, maximum: 3 },
          rationale: { type: 'string' },
        },
      },
    },
  },
} as const;

export function buildHookSystemPrompt(): string {
  return `You write the on-screen hook card for a Threshold Health & Performance reel (Dr. Lars Stevenson, physical therapist and strength coach in Reston, VA; audience = athletes and active adults who want to train through and past injury).

The card appears over the first ${HOOK_FADE_AFTER_SECONDS} seconds while the speaker is still winding up, so it must state the CLAIM the video makes, compressed. It is not a teaser and not a title.

Produce exactly 3 candidates. Each:
- At most ${HOOK_MAX_WORDS} words. A complete sentence, first person or direct address, present tense.
- TRUE to what is actually said in the transcript. Never invent a number or a claim.
- Tagged with a hook type from the viral hook rubric:
  contrarian (claims against a common belief), statistic (specific number + unexpected frame), stakes (names who this hurts and how), question (a curiosity gap with a clear payoff), story (a scene with immediate tension), statement (plain claim, use only when nothing sharper is true).
- Scored 0–3 on: hookStrength (3 = contrarian claim / specific number / named stakes; 2 = clear curiosity gap or story tension; 1 = announces the topic; 0 = preamble), payoffClarity (does the video deliver on it concretely), shareability (would a viewer send this to a friend who believes the opposite).
- Voice rules, non-negotiable: no em dashes or en dashes anywhere; no exclamation marks; no "Not X, it's Y" construction; no emoji; no hashtags; no colons-as-drama. None of these phrases: ${BANNED_PHRASES.slice(0, 60).join(', ')}.
- Different angles across the 3 (do not give three rewordings of one line).

Return only the JSON object.`;
}

function scoreOf(r: HookCandidate['rubric']): number {
  return 2 * r.hookStrength + r.payoffClarity + r.shareability;
}

/**
 * The opening the model sees: kept words in edited order up to
 * HOOK_OPENING_SECONDS of speech, plus a one-line tail summary so the
 * payoff score can be judged.
 */
export function openingTranscript(words: Word[], clips: Clip[]): { opening: string; rest: string; count: number } {
  const kept = filterWordsByClips(words, clips);
  if (kept.length === 0) return { opening: '', rest: '', count: 0 };
  const t0 = kept[0].start;
  const openingWords: string[] = [];
  const restWords: string[] = [];
  let spoken = 0;
  let last = t0;
  for (const w of kept) {
    // Count speech time plus at most half a second of each pause, so the
    // gaps the cut stages removed don't eat the opening budget.
    spoken += Math.max(0, w.end - w.start) + Math.max(0, Math.min(0.5, w.start - last));
    last = w.end;
    if (spoken <= HOOK_OPENING_SECONDS) openingWords.push(w.text);
    else restWords.push(w.text);
  }
  const rest = restWords.join(' ');
  return {
    opening: openingWords.join(' '),
    rest: rest.length > 600 ? `${rest.slice(0, 600)}…` : rest,
    count: kept.length,
  };
}

/** Pure: rank + lint raw model candidates. Exported for tests. */
export function rankCandidates(
  raw: { text: string; type: string; hookStrength: number; payoffClarity: number; shareability: number; rationale: string }[],
): { candidates: HookCandidate[]; chosenId: string | null; flags: HookProposal['flags'] } {
  const candidates: HookCandidate[] = raw.map((c, i) => {
    const fixed = lintAndAutoFix(c.text.trim());
    const text = fixed.text.replace(/\s+/g, ' ').trim();
    // Over-length candidates fail rather than get chopped mid-sentence.
    const tooLong = text.split(' ').length > HOOK_MAX_WORDS;
    const violations = fixed.result.violations.filter((v) => v.hard).map((v) => `${v.category}: ${v.match}`);
    if (tooLong) violations.push(`over ${HOOK_MAX_WORDS} words`);
    const type = (HOOK_TYPES as string[]).includes(c.type) ? (c.type as HookType) : 'statement';
    const rubric = {
      hookStrength: clamp03(c.hookStrength),
      payoffClarity: clamp03(c.payoffClarity),
      shareability: clamp03(c.shareability),
    };
    return {
      id: `hook_${i + 1}`,
      text,
      type,
      rubric,
      score: scoreOf(rubric),
      rationale: c.rationale?.slice(0, 200) ?? '',
      lint: { pass: fixed.result.pass && !tooLong, autoFixed: fixed.text !== c.text.trim(), violations },
    };
  });

  const passing = candidates.filter((c) => c.lint.pass && c.text.length > 0);
  passing.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
  const chosen = passing[0] ?? null;
  const flags: HookProposal['flags'] = [];
  if (!chosen) flags.push('hook-lint');
  else if (chosen.rubric.hookStrength < HOOK_MIN_STRENGTH) flags.push('hook-low-score');
  return { candidates, chosenId: chosen?.id ?? null, flags };
}

function clamp03(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.max(0, Math.min(3, v));
}

export async function proposeHook(input: {
  words: Word[];
  clips: Clip[];
  apiKey: string;
  model?: string;
  onLog?: (m: string) => void;
}): Promise<HookProposal> {
  const log = input.onLog ?? (() => {});
  const { opening, rest, count } = openingTranscript(input.words, input.clips);
  const base: Omit<HookProposal, 'candidates' | 'chosenId' | 'applied' | 'flags'> = {
    generatedAt: new Date().toISOString(),
    model: input.model ?? DEFAULT_HOOK_MODEL,
    sourceWords: count,
  };
  if (count < 12) {
    return { ...base, candidates: [], chosenId: null, applied: false, flags: [], skippedBecause: `only ${count} kept words` };
  }

  const user =
    `OPENING (first ~${HOOK_OPENING_SECONDS}s of kept speech):\n"""${opening}"""\n\n` +
    (rest ? `REST OF THE VIDEO (for judging payoff):\n"""${rest}"""\n\n` : '') +
    'Write the 3 hook-card candidates.';

  const anthropic = new Anthropic({ apiKey: input.apiKey });
  const models = [base.model, FALLBACK_HOOK_MODEL].filter((m, i, a) => a.indexOf(m) === i);
  let lastErr: unknown = null;
  for (const model of models) {
    try {
      log(`Proposing hook card with ${model}…`);
      const res = await anthropic.messages.create({
        model,
        max_tokens: 800,
        system: buildHookSystemPrompt(),
        messages: [{ role: 'user', content: user }],
        output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
      });
      const text = res.content[0]?.type === 'text' ? res.content[0].text : '';
      const parsed = JSON.parse(text) as { candidates: Parameters<typeof rankCandidates>[0] };
      const ranked = rankCandidates(parsed.candidates ?? []);
      for (const c of ranked.candidates) {
        log(`  ${c.id === ranked.chosenId ? '★' : ' '} [${c.type} ${c.score}/12${c.lint.pass ? '' : ' ✗lint'}] ${c.text}`);
      }
      return { ...base, model, ...ranked, applied: false };
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      log(`  hook model ${model} failed: ${msg.slice(0, 160)}`);
      // Only fall through to the cheaper model on capacity/server errors.
      if (!/429|5\d\d|overloaded|rate/i.test(msg)) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Apply the chosen candidate as the plan's header unless a user-authored
 * header exists. Returns the (possibly unchanged) plan and whether it applied.
 */
export function applyHookToPlan(plan: EditPlan, proposal: HookProposal, candidateId: string | null = proposal.chosenId): { plan: EditPlan; applied: boolean; skippedBecause?: string } {
  const cand = candidateId ? proposal.candidates.find((c) => c.id === candidateId) : null;
  if (!cand) return { plan, applied: false, skippedBecause: 'no lint-passing candidate' };
  const userOwned = !!plan.header && plan.hook?.source !== 'auto';
  if (userOwned) return { plan, applied: false, skippedBecause: 'header is user-authored' };
  const header: HeaderConfig & { __source: 'auto'; __proposalId: string } = {
    text: cand.text,
    position: plan.header?.position ?? 'top',
    durationMode: 'fadeAfter',
    fadeAfterSeconds: HOOK_FADE_AFTER_SECONDS,
    ...(plan.header?.positionOffsetX !== undefined ? { positionOffsetX: plan.header.positionOffsetX } : {}),
    ...(plan.header?.positionOffsetY !== undefined ? { positionOffsetY: plan.header.positionOffsetY } : {}),
    __source: 'auto',
    __proposalId: cand.id,
  };
  return { plan: applyAction(plan, { type: 'set_header', params: header }), applied: true };
}
