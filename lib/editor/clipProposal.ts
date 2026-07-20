/**
 * clipProposal.ts
 *
 * Claude-based viral-moment detection for long-form video sources.
 * Given the Whisper word-level transcript of a 30-60 min recording,
 * ask Claude to identify 5-15 self-contained clippable moments in the
 * 15-90 second range (Instagram Reels / TikTok sweet spot).
 *
 * Each proposal is reviewed by the user in the LongFormView and, on
 * approval, fed to extractClip.ts → reframe → the standard talking-head
 * pipeline. The extracted clip is a full-fledged project — it has its
 * own folder, source.mp4, analysis.json subset, and edit plan.
 *
 * Times are in SOURCE seconds (relative to the long-form recording).
 */
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import type { Word } from './autoCut';

export const MIN_CLIP_SEC = 15;
export const MAX_CLIP_SEC = 90;
export const MIN_PROPOSALS = 5;
export const MAX_PROPOSALS = 15;
/** Ceiling in over-clip (exhaustive) mode — inbox long-form → editor review. */
export const EXHAUSTIVE_MAX_PROPOSALS = 40;
/**
 * Below this word count there isn't enough speech to find a real clip, so we
 * skip the LLM pass and surface evenly-spaced review windows instead. Kept
 * low (not 200) on purpose: faint treatment sessions often transcribe to only
 * ~50–150 words after loudness-normalization, and Lars still wants the best
 * *content-based* moments from those, not generic windows.
 */
export const MIN_WORDS_FOR_PASS = 40;
/** When Claude surfaces fewer than this, backfill from the transcript. */
const FALLBACK_BELOW = 3;
/** How many densest-speech windows to backfill. */
const FALLBACK_COUNT = 6;

export type HookType =
  | 'contrarian'
  | 'question'
  | 'statistic'
  | 'story'
  | 'stakes'
  | 'statement';

export type ClipDimensions = {
  /** First 2 seconds — curiosity, specificity, stakes, contrarian framing. 0-3. */
  hook_strength: number;
  /** Does the hook's promise land within the clip? 0-3. */
  payoff_clarity: number;
  /** Would sharing make the viewer look informed? 0-3. */
  shareability: number;
  /** Reference-worthy takeaway viewers return to? 0-3. */
  savability: number;
  /** Does momentum build through the clip? 0-3. */
  tension: number;
};

export type VoiceFlag = {
  /** The banned phrase, verbatim. */
  phrase: string;
  /**
   * Which voice-DNA category this fell under.
   * dead_ai_language | engagement_bait | generic_insider_claims | pronoun_violation
   */
  category: string;
};

export type ClipProposal = {
  id: string;
  startSec: number;
  endSec: number;
  title: string;
  hook: string;
  reason: string;
  /** 0-100 overall confidence. Kept for existing UI/sorting. */
  score: number;
  /** Rubric breakdown, new in v2. Absent on proposals generated before v2. */
  dimensions?: ClipDimensions;
  /** `contrarian|question|statistic|story|stakes|statement`. Optional for backcompat. */
  hookType?: HookType;
  /** Banned-phrase flags. Informational — never reduces score. Empty array if clean. */
  voiceFlags?: VoiceFlag[];
};

export type ClipsProposalFile = {
  generatedAt: string;
  model: string;
  sourceDurationSec: number;
  proposals: ClipProposal[];
  /** Total Whisper word count of the source — drives the sparse-transcript UI note. */
  wordCount?: number;
  /** Set only when there's essentially nothing to clip (very sparse speech). */
  note?: string;
};

const SYSTEM_PROMPT = `You review long-form video transcripts (podcasts, interviews, long talks) and pick self-contained, viral-quality clips for Instagram Reels and TikTok. The speaker is Dr. Lars Stevenson, a physical therapist (PT, DPT) building the Threshold Health & Performance brand.

HARD CONSTRAINTS (any violation = reject the clip):

1. Length: ${MIN_CLIP_SEC}-${MAX_CLIP_SEC} seconds. Shorter = punchier, longer = storytelling. Use the full range.
2. Hook: first 3 seconds must grab a scrolling viewer.
3. Complete thought: starts cleanly, ends on a landing — a punchline, conclusion, or natural beat. Never mid-sentence.
4. Spread clips across the whole recording — don't cluster them in the first 10 minutes.
5. Return ${MIN_PROPOSALS}-${MAX_PROPOSALS} clips, ranked best-first. Only return fewer if the recording is very short or nearly silent — otherwise fill the list with your best available moments, even imperfect ones. Lars makes the final call on what to post, so never withhold a candidate just because it isn't obviously viral.

SCORING RUBRIC — score each clip on five dimensions, 0-3 each:

1. hook_strength (first 2 seconds ONLY)
   - 3: Contrarian claim against common belief, OR specific number + unexpected frame, OR named stakes ("If you're over 40 and sitting 6+ hours…").
   - 2: Clear curiosity gap (question with direction), OR story opener with immediate tension.
   - 1: Generic topic announcement without tension.
   - 0: Filler preamble ("So, um, today I want to talk about…").

2. payoff_clarity — does the hook's promise land within the clip?
   - 3: Concrete, specific payoff — a number, framework step, named protocol.
   - 2: Clear but abstract (principle, mindset shift).
   - 1: Implied, requires inference.
   - 0: No payoff — clip ends still teasing.

3. shareability — would sharing this make the viewer look informed?
   - 3: Reframes something viewer's friends believe wrongly (e.g. "stretching doesn't fix tight hamstrings — here's what actually does").
   - 2: Validates a belief viewer already held — signal-sharing.
   - 1: Useful but savable rather than shareable.
   - 0: Inside-baseball — only shareable to other practitioners.

4. savability — reference-worthy takeaway?
   - 3: Named framework, numbered protocol, specific exercise/cue.
   - 2: Clear decision heuristic or rule of thumb.
   - 1: Concept worth remembering but not immediately actionable.
   - 0: Entertainment or opinion with no takeaway.

5. tension — does momentum build through the clip?
   - 3: Hook → setup → twist/reveal → payoff.
   - 2: Hook → payoff with one supporting beat.
   - 1: Hook → immediate payoff (works for <20s clips).
   - 0: Rambling, plateau, multiple topics.

Total possible 0-15. Score every clip honestly — but do NOT use the score as a filter. Lars reviews every proposal himself and decides what to post; your job is to surface the most clippable moments, never to gatekeep them. Also return an overall 0-100 score (your holistic confidence this performs as a Reel) so weaker clips are clearly flagged as low rather than hidden.

HOOK TYPE — classify each clip as exactly one of: contrarian, question, statistic, story, stakes, statement.

VOICE FLAGS — scan the clip's transcript for Lars's banned phrases. List every match. Voice flags are INFORMATIONAL — they surface in the UI as warnings but DO NOT reduce the score. Surface the clip anyway if the hook is strong.

Banned phrases (non-exhaustive):
  • Dead AI language: "root cause", "holistic", "cookie-cutter", "whole person", "evidence-based"
  • Engagement bait: "Let that sink in", "Read that again", "Full stop", "This changes everything", "Are you paying attention?", "You're not ready for this"
  • Generic insider claims: "nobody talks about", "what nobody tells you", "most people don't realize", any "nobody/no one" sweeping claim
  • Pronoun violations: "we" when speaking about Lars's own practice (Lars speaks first-person singular — "I", not "we")

Categorize each flag as one of: dead_ai_language, engagement_bait, generic_insider_claims, pronoun_violation.

OUTPUT FORMAT — return a JSON object ONLY, no prose. Shape:

{"clips": [
  {
    "startIdx": 12,
    "endIdx": 78,
    "title": "Why lifting heavy helps",
    "hookType": "contrarian",
    "dimensions": {"hook_strength": 3, "payoff_clarity": 3, "shareability": 3, "savability": 2, "tension": 2},
    "voiceFlags": [{"phrase": "nobody talks about", "category": "generic_insider_claims"}],
    "reason": "Contrarian reframe with specific payoff; voice flag amber.",
    "score": 85
  }
]}

Even for a low-energy recording (a quiet treatment session, a rambling stretch), return the ${MIN_PROPOSALS}-${MAX_PROPOSALS} most self-contained, watchable moments you can find — scored honestly, low scores included. An empty list is only acceptable when there is essentially no continuous speech to clip. Always include dimensions and voiceFlags on every clip — use [] for voiceFlags when clean.`;

export async function detectClipProposals(input: {
  words: Word[];
  sourceDurationSec: number;
  apiKey: string;
  model?: string;
  /**
   * Optional prompt-level context from lib/performanceCorpus — hook-style
   * completion rates, drop cliffs, top/bottom performers. Used to bias
   * which transcript segments Claude flags as viral-quality.
   */
  performanceContext?: string;
  /**
   * Over-clip mode (inbox long-form → regular editor): find as MANY
   * candidate moments as possible — coaching cues, explanations, client
   * interactions, jokes, goofing around — and when unsure whether
   * something is a clip, INCLUDE it. Lars deletes the misses on the
   * timeline; a missed moment is worse than a weak proposal.
   */
  exhaustive?: boolean;
  onLog?: (msg: string) => void;
}): Promise<ClipsProposalFile> {
  const log = input.onLog ?? (() => {});
  const words = input.words;
  if (words.length < MIN_WORDS_FOR_PASS) {
    const windows = buildEvenlySpacedProposals(input.sourceDurationSec, FALLBACK_COUNT);
    log(`Sparse transcript (${words.length} words) — surfacing ${windows.length} evenly-spaced review window(s) for manual judgment.`);
    return {
      generatedAt: new Date().toISOString(),
      model: input.model ?? 'claude-sonnet-4-6',
      sourceDurationSec: input.sourceDurationSec,
      proposals: windows,
      wordCount: words.length,
      note: `Only ${words.length} words were transcribed — this recording is very faint or mostly quiet. I've placed ${windows.length} evenly-spaced review windows so you can scrub and decide; if the audio is just quiet, re-running (transcription is now loudness-normalized) should recover real speech.`,
    };
  }

  const numbered = words
    .map((w, i) => `${i + 1}. ${w.text}`)
    .join('\n');

  log(`Asking Claude to propose clips across ${words.length} words (${input.sourceDurationSec.toFixed(0)}s source)…`);
  if (input.performanceContext) {
    log('  (injecting performance corpus as soft context)');
  }

  const anthropic = new Anthropic({ apiKey: input.apiKey });
  const model = input.model ?? 'claude-sonnet-4-6';

  const askCount = input.exhaustive
    ? `as many candidate clips as the material supports (up to ${EXHAUSTIVE_MAX_PROPOSALS})`
    : `${MIN_PROPOSALS}-${MAX_PROPOSALS} viral-quality clips`;
  const exhaustiveNote = input.exhaustive
    ? `\n\nOVER-CLIP MODE: this is a coaching/treatment session being pre-cut for review on a timeline. Surface EVERY plausible moment — coaching cues, concept explanations, client interactions, demonstrations, jokes and goofing around, honest asides. If you are UNSURE whether something is a clip, INCLUDE it: Lars deletes the misses in seconds, but a missed moment is gone. Do not cluster; sweep the entire recording. Rough boundaries are fine — Lars adjusts edges on the timeline afterward.`
    : '';
  const userText = input.performanceContext
    ? `${input.performanceContext}\n\n---\n\nWord-level transcript (1-indexed). Identify ${askCount} between ${MIN_CLIP_SEC}s and ${MAX_CLIP_SEC}s. Favor hooks resembling the top-performer styles above; avoid patterns that matched the bottom performers.${exhaustiveNote}\n\n${numbered}`
    : `Word-level transcript (1-indexed). Identify ${askCount} between ${MIN_CLIP_SEC}s and ${MAX_CLIP_SEC}s.${exhaustiveNote}\n\n${numbered}`;

  const res = await anthropic.messages.create({
    model,
    // Exhaustive mode can return up to 40 proposals — needs headroom or the
    // JSON truncates mid-array and the whole response is discarded.
    max_tokens: input.exhaustive ? 12000 : 4000,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: userText,
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
    ],
  });

  const raw = res.content[0]?.type === 'text' ? res.content[0].text.trim() : '';
  if (!raw) log('Claude returned an empty response — will backfill from the transcript.');
  const parsed = raw ? parseClaudeClipResponse(raw) : [];
  const proposals: ClipProposal[] = [];
  for (const c of parsed) {
    const startIdx = c.startIdx - 1;
    const endIdx = c.endIdx - 1;
    if (startIdx < 0 || endIdx >= words.length || endIdx < startIdx) {
      log(`  ✗ skipping invalid range [${c.startIdx}..${c.endIdx}]`);
      continue;
    }
    const startSec = words[startIdx].start;
    const endSec = words[endIdx].end;
    const durSec = endSec - startSec;
    if (durSec < MIN_CLIP_SEC || durSec > MAX_CLIP_SEC) {
      log(`  ✗ skipping ${durSec.toFixed(1)}s clip (out of ${MIN_CLIP_SEC}-${MAX_CLIP_SEC}s range)`);
      continue;
    }
    const hookWords = words.slice(startIdx, Math.min(endIdx + 1, startIdx + 20));
    const hook = hookWords.map((w) => w.text).join(' ');
    proposals.push({
      id: `cp_${randomUUID().slice(0, 8)}`,
      startSec,
      endSec,
      title: c.title.slice(0, 80),
      hook: hook.length > 200 ? hook.slice(0, 197) + '…' : hook,
      reason: c.reason.slice(0, 160),
      score: Math.max(0, Math.min(100, Math.round(c.score))),
      dimensions: c.dimensions,
      hookType: c.hookType,
      voiceFlags: c.voiceFlags,
    });
  }

  proposals.sort((a, b) => a.startSec - b.startSec);
  log(`Claude proposed ${parsed.length} raw, kept ${proposals.length} after validation.`);

  // Guarantee something to review. Low-energy recordings (treatment
  // sessions, rambling stretches) often score below Claude's bar — but Lars
  // wants to make that call himself, not get an empty panel. When too few
  // clips survive and there's real speech, backfill with the densest-speech
  // windows as honest low-score candidates.
  if (proposals.length < FALLBACK_BELOW && words.length >= MIN_WORDS_FOR_PASS) {
    const exclude = proposals.map((p) => [p.startSec, p.endSec] as const);
    const fallback = buildFallbackProposals(words, FALLBACK_COUNT, exclude);
    if (fallback.length) {
      log(`Backfilling ${fallback.length} densest-speech clip(s) so the panel is never empty (Claude surfaced ${proposals.length}).`);
      proposals.push(...fallback);
      proposals.sort((a, b) => a.startSec - b.startSec);
    }
  }

  // Absolute last resort: if nothing survived at all (Claude empty AND the
  // density fallback found no windows), still hand the editor evenly-spaced
  // scrub points so the panel is never empty.
  let note: string | undefined;
  if (proposals.length === 0) {
    const windows = buildEvenlySpacedProposals(input.sourceDurationSec, FALLBACK_COUNT);
    if (windows.length) {
      log(`No scoreable or dense clips — surfacing ${windows.length} evenly-spaced review window(s).`);
      proposals.push(...windows);
      note = `This recording transcribed to only ${words.length} words — too sparse to pull real clips. I've placed ${windows.length} evenly-spaced review windows so you can scrub and decide if there's anything worth keeping.`;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    model,
    sourceDurationSec: input.sourceDurationSec,
    proposals,
    wordCount: words.length,
    note,
  };
}

/**
 * Deterministic backfill for when Claude returns few/no clips. Walks the
 * transcript in consecutive ~40s windows (snapped to word boundaries),
 * scores each by word density (words/sec), and returns the densest
 * non-overlapping ones as low-score 'statement' proposals — so the editor
 * always has candidates to review. Windows overlapping clips Claude already
 * surfaced are skipped, so backfill never duplicates a real proposal.
 */
function buildFallbackProposals(
  words: Word[],
  count: number,
  exclude: ReadonlyArray<readonly [number, number]>,
): ClipProposal[] {
  const TARGET_SEC = 40;
  type Win = {
    startIdx: number;
    endIdx: number;
    startSec: number;
    endSec: number;
    density: number;
  };
  const windows: Win[] = [];
  let i = 0;
  while (i < words.length) {
    const start = words[i];
    let j = i;
    while (j < words.length - 1 && words[j].end - start.start < TARGET_SEC) j++;
    const end = words[j];
    const dur = end.end - start.start;
    if (dur >= MIN_CLIP_SEC && dur <= MAX_CLIP_SEC) {
      windows.push({
        startIdx: i,
        endIdx: j,
        startSec: start.start,
        endSec: end.end,
        density: (j - i + 1) / dur,
      });
    }
    i = j + 1;
  }
  const overlaps = (a: number, b: number) =>
    exclude.some(([s, e]) => a < e && b > s);
  const ranked = windows
    .filter((w) => !overlaps(w.startSec, w.endSec))
    .sort((a, b) => b.density - a.density)
    .slice(0, count)
    .sort((a, b) => a.startSec - b.startSec);
  return ranked.map((w) => {
    const hookWords = words.slice(w.startIdx, Math.min(w.endIdx + 1, w.startIdx + 20));
    const hook = hookWords.map((x) => x.text).join(' ');
    return {
      id: `cp_${randomUUID().slice(0, 8)}`,
      startSec: w.startSec,
      endSec: w.endSec,
      title: 'Densest-speech segment',
      hook: hook.length > 200 ? hook.slice(0, 197) + '…' : hook,
      reason:
        'Fallback: most continuous speech in this stretch — no strong viral hook detected. Review manually.',
      score: 30,
      hookType: 'statement' as HookType,
      voiceFlags: [],
    };
  });
}

/**
 * Last-resort fallback: place up to `count` review windows evenly across the
 * timeline so the panel is never empty even when the transcript is too
 * sparse to score (very faint / near-silent sources). These are scrub points
 * for manual judgment, not scored clips — Lars decides if there's content.
 */
function buildEvenlySpacedProposals(durationSec: number, count: number): ClipProposal[] {
  if (!Number.isFinite(durationSec) || durationSec < MIN_CLIP_SEC) return [];
  const clipLen = Math.min(45, MAX_CLIP_SEC, durationSec);
  const n = Math.max(1, Math.min(count, Math.floor(durationSec / 120)));
  const out: ClipProposal[] = [];
  for (let i = 0; i < n; i++) {
    const center = (durationSec * (i + 1)) / (n + 1);
    let start = Math.max(0, center - clipLen / 2);
    const end = Math.min(durationSec, start + clipLen);
    start = Math.max(0, end - clipLen);
    out.push({
      id: `cp_${randomUUID().slice(0, 8)}`,
      startSec: start,
      endSec: end,
      title: `Review window ${i + 1}`,
      hook: '',
      reason:
        'Auto-placed review window — transcript too sparse to score. Scrub to check for usable content.',
      score: 15,
      hookType: 'statement',
      voiceFlags: [],
    });
  }
  return out;
}

type RawClipCut = {
  startIdx: number;
  endIdx: number;
  title: string;
  reason: string;
  score: number;
  dimensions?: ClipDimensions;
  hookType?: HookType;
  voiceFlags?: VoiceFlag[];
};

const HOOK_TYPES: readonly HookType[] = [
  'contrarian',
  'question',
  'statistic',
  'story',
  'stakes',
  'statement',
];

function parseDimensions(value: unknown): ClipDimensions | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const d = value as Record<string, unknown>;
  const clamp = (n: unknown): number => {
    const v = typeof n === 'number' ? n : NaN;
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(3, Math.round(v)));
  };
  return {
    hook_strength: clamp(d.hook_strength),
    payoff_clarity: clamp(d.payoff_clarity),
    shareability: clamp(d.shareability),
    savability: clamp(d.savability),
    tension: clamp(d.tension),
  };
}

function parseVoiceFlags(value: unknown): VoiceFlag[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: VoiceFlag[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const phrase = typeof o.phrase === 'string' ? o.phrase.trim() : '';
    const category = typeof o.category === 'string' ? o.category.trim() : '';
    if (!phrase) continue;
    out.push({ phrase: phrase.slice(0, 120), category: category.slice(0, 60) });
  }
  return out;
}

function parseHookType(value: unknown): HookType | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase() as HookType;
  return HOOK_TYPES.includes(v) ? v : undefined;
}

export function parseClaudeClipResponse(raw: string): RawClipCut[] {
  // Strip Markdown code fences if Claude added them despite instructions.
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const clips = (parsed as { clips?: unknown }).clips;
  if (!Array.isArray(clips)) return [];

  const out: RawClipCut[] = [];
  for (const c of clips) {
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    const startIdx = typeof o.startIdx === 'number' ? o.startIdx : NaN;
    const endIdx = typeof o.endIdx === 'number' ? o.endIdx : NaN;
    if (!Number.isFinite(startIdx) || !Number.isFinite(endIdx)) continue;
    out.push({
      startIdx: Math.round(startIdx),
      endIdx: Math.round(endIdx),
      title: typeof o.title === 'string' ? o.title : 'Untitled clip',
      reason: typeof o.reason === 'string' ? o.reason : '',
      score: typeof o.score === 'number' ? o.score : 50,
      dimensions: parseDimensions(o.dimensions),
      hookType: parseHookType(o.hookType),
      voiceFlags: parseVoiceFlags(o.voiceFlags),
    });
  }
  return out;
}
