/**
 * Voice-DNA linter — the single deterministic gate every caption passes before
 * it can be queued or published, regardless of source (LLM-generated, sidecar,
 * manual, auto-draft from the video pipeline).
 *
 * Canonical rule source: `Claude Second Brain/wiki/concept-voice-dna.md`.
 * If the rules change there, change them here in the same commit — the two
 * must not drift.
 *
 * Isomorphic: no Node-only imports (same constraint as lib/editor/editPlan.ts).
 */

export type VoiceViolationCategory =
  | 'dead_ai_language'
  | 'dead_transitions'
  | 'engagement_bait'
  | 'ai_cringe'
  | 'clinical_banned'
  | 'borrowed_language'
  | 'fatal_negation_pattern'
  | 'em_dash'
  | 'exclamation'
  | 'we_pronoun'
  | 'meta_reply'
  | 'fragment_staccato';

export type VoiceViolation = {
  category: VoiceViolationCategory;
  /** The offending text as matched. */
  match: string;
  /** Character offset of the match in the input. */
  index: number;
  /** Hard violations fail the lint; soft ones are informational. */
  hard: boolean;
  /** True when autoFixVoiceDna can mechanically repair this violation. */
  autoFixable: boolean;
  suggestion?: string;
};

export type VoiceLintResult = {
  /** True when no hard violations remain. */
  pass: boolean;
  violations: VoiceViolation[];
  autoFixable: VoiceViolation[];
};

/* ------------------------------------------------------------------ */
/* Banned phrase lists (concept-voice-dna.md, verbatim categories)     */
/* ------------------------------------------------------------------ */

const DEAD_AI_LANGUAGE = [
  "in today's",
  "it's important to note",
  "it's worth noting",
  'delve',
  'dive into',
  'unpack',
  'harness',
  'leverage',
  'utilize',
  'landscape',
  'realm',
  'robust',
  'game-changer',
  'cutting-edge',
  'straightforward',
  "i'd be happy to help",
  'in order to',
];

const DEAD_TRANSITIONS = [
  'furthermore',
  'additionally',
  'moreover',
  'moving forward',
  'at the end of the day',
  'to put this in perspective',
  'what makes this particularly interesting',
  'the implications here are',
  'in other words',
  'it goes without saying',
];

const ENGAGEMENT_BAIT = [
  'let that sink in',
  'read that again',
  'full stop',
  'this changes everything',
  'are you paying attention',
  "you're not ready for this",
  "nobody's talking about",
  'what nobody tells you',
  "most people don't realize",
];

const AI_CRINGE = [
  'supercharge',
  'unlock',
  'future-proof',
  '10x your productivity',
  'the ai revolution',
  'in the age of ai',
];

/** Threshold-specific clinical/positioning bans. */
const CLINICAL_BANNED = [
  'root cause',
  'holistic',
  'cookie-cutter',
  'whole person',
  'evidence-based',
];

/**
 * Borrowed language — terminology coined by another coach, method, or the
 * fitness-influencer lexicon. It is not Lars's voice, so it must never enter
 * his copy AS his own words. The gate is quote-exempt: a borrowed term is fine
 * inside a direct quote or right after an attribution cue (he's naming the
 * source, not adopting the phrase). Keep this list conservative — standard
 * training vocabulary he actually uses (deload, posterior chain, double
 * progression, minimum effective dose) must never appear here. The list grows
 * as borrowed terms are caught; add the offender, not the category.
 */
const BORROWED_LANGUAGE = [
  'movement snack',
  'movement snacks',
  'exercise snack',
  'exercise snacks',
  'grease the groove',
  'greasing the groove',
];

/** Flat banned-phrase list for embedding in LLM prompts (single source of truth). */
export const BANNED_PHRASES: string[] = [
  ...DEAD_AI_LANGUAGE,
  ...DEAD_TRANSITIONS,
  ...ENGAGEMENT_BAIT,
  ...AI_CRINGE,
  ...CLINICAL_BANNED,
  ...BORROWED_LANGUAGE,
];

/**
 * Attribution cues that make a borrowed term acceptable — Lars is naming or
 * quoting the source, not writing in the term. Tested against the text
 * immediately preceding the match (anchored to its end).
 */
const ATTRIBUTION_CUE =
  /(?:so[- ]?called|the term|coined|dubbed|known as|referred to as|call(?:s|ed)? (?:it|this|them)|as [\w.’' ]{1,20}(?:calls?|puts? it|says)|what [\w.’' ]{1,20}calls?)[\sa-z:,'"“‘]{0,12}$/i;

/** Spans wrapped in double or curly quotes; a borrowed term inside one is a quote. */
function quotedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const patterns = [/"[^"]{0,240}"/g, /“[^”]{0,240}”/g, /‘[^’]{0,240}’/g];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function indexInRanges(ranges: Array<[number, number]>, i: number): boolean {
  return ranges.some(([s, e]) => i >= s && i < e);
}

const PHRASE_CATEGORIES: Array<{ category: VoiceViolationCategory; phrases: string[] }> = [
  { category: 'dead_ai_language', phrases: DEAD_AI_LANGUAGE },
  { category: 'dead_transitions', phrases: DEAD_TRANSITIONS },
  { category: 'engagement_bait', phrases: ENGAGEMENT_BAIT },
  { category: 'ai_cringe', phrases: AI_CRINGE },
  { category: 'clinical_banned', phrases: CLINICAL_BANNED },
];

function phraseRegex(phrase: string): RegExp {
  // Word-boundary match; apostrophes and hyphens inside phrases matched
  // literally, straight or curly apostrophes both accepted.
  const escaped = phrase
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/'/g, "['’]");
  return new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'gi');
}

/* ------------------------------------------------------------------ */
/* FATAL negation pattern ("This isn't X. This is Y." family)          */
/* ------------------------------------------------------------------ */

const FATAL_PATTERNS: RegExp[] = [
  // "This isn't X. This/It/That is Y." (also with , or ; between)
  /\bthis (?:isn['’]?t|is not)\b[^.!?\n]{1,80}[.,;!?]\s*(?:this|it|that)(?:['’]s| is)\b/gi,
  // "It's not X. It's Y." / "It isn't X, it's Y."
  /\bit(?:['’]s| is)? ?(?:not|isn['’]?t)\b[^.!?\n]{1,80}[.,;!?]\s*it['’]?s?\b/gi,
  // "Not X. Y." as a sentence opener followed by a corrective assertion
  /(?:^|[.!?]\s+)not\s+[^.!?\n]{1,60}[.;]\s+(?:it['’]?s|this is|that['’]?s)\b/gi,
  // "Forget X. This is Y." / "Forget X, this is Y."
  /\bforget\s+[^.!?\n]{1,60}[.,;]\s*(?:this is|it['’]?s|that['’]?s)\b/gi,
  // "Less X, more Y."
  /\bless\s+\w[^.!?\n]{0,40},\s*more\s+\w/gi,
  // "[It/the barrier] was never X. It was Y." / "...never X, it was Y."
  /\b(?:was|were|is|are)\s+never\b[^.!?\n]{1,80}[.,;]\s*(?:it|this|that)(?:['’]s| is| was| were)\b/gi,
];

/* ------------------------------------------------------------------ */
/* Meta-reply detection (moved here from lib/caption.ts — canonical)   */
/* ------------------------------------------------------------------ */

/**
 * Detects when a model replied conversationally instead of returning a caption
 * (happens when the transcript is empty or garbled, e.g. a silent reel). Such
 * a reply must never be stored as a caption.
 */
export function looksLikeMetaReply(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 15) return true;
  return /\b(i'?m ready to|please (paste|provide|share)|paste the (draft|caption|transcript)|provide (the |a )?(draft|transcript|caption)|i don'?t see (a|any)|no (transcript|caption)(?: was)? (provided|given)|there(?:'s| is) no (transcript|caption)|as an ai|i can help you|happy to help|could you (please )?(paste|provide|share))\b/.test(t);
}

/* ------------------------------------------------------------------ */
/* We-pronoun handling                                                 */
/* ------------------------------------------------------------------ */

/** Unambiguous mechanical first-person-plural → first-person fixes. */
const WE_FIXES: Array<[RegExp, string]> = [
  [/\bwe['’]re\b/gi, "I'm"],
  [/\bwe['’]ve\b/gi, "I've"],
  [/\bwe['’]ll\b/gi, "I'll"],
  [/\bwe['’]d\b/gi, "I'd"],
  [/\bwe\b/gi, 'I'],
  [/\bour\b/gi, 'my'],
  [/\bours\b/gi, 'mine'],
  [/\bourselves\b/gi, 'myself'],
];

const WE_PRONOUN_RE = /\b(we['’](?:re|ve|ll|d)|we|our|ours|ourselves|us)\b/gi;

/* ------------------------------------------------------------------ */
/* Lint                                                                */
/* ------------------------------------------------------------------ */

export function lintVoiceDna(text: string): VoiceLintResult {
  const violations: VoiceViolation[] = [];

  // Meta-reply: the whole text is invalid, nothing autofixable.
  if (looksLikeMetaReply(text)) {
    violations.push({
      category: 'meta_reply',
      match: text.trim().slice(0, 80),
      index: 0,
      hard: true,
      autoFixable: false,
      suggestion: 'Regenerate the caption from a real transcript or sidecar.',
    });
  }

  // Banned phrases.
  for (const { category, phrases } of PHRASE_CATEGORIES) {
    for (const phrase of phrases) {
      const re = phraseRegex(phrase);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        violations.push({
          category,
          match: m[0],
          index: m.index,
          hard: true,
          autoFixable: false,
          suggestion: `Remove or rephrase "${m[0]}".`,
        });
      }
    }
  }

  // Borrowed language — hard, but exempt inside a direct quote or right after
  // an attribution cue (Lars naming the source rather than adopting the term).
  {
    const ranges = quotedRanges(text);
    for (const phrase of BORROWED_LANGUAGE) {
      const re = phraseRegex(phrase);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const before = text.slice(Math.max(0, m.index - 60), m.index);
        if (indexInRanges(ranges, m.index) || ATTRIBUTION_CUE.test(before)) continue;
        violations.push({
          category: 'borrowed_language',
          match: m[0],
          index: m.index,
          hard: true,
          autoFixable: false,
          suggestion: `"${m[0]}" is borrowed terminology. Say it plainly in Lars's own words, or quote/attribute the source.`,
        });
      }
    }
  }

  // FATAL negation pattern.
  for (const re of FATAL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      violations.push({
        category: 'fatal_negation_pattern',
        match: m[0].trim(),
        index: m.index,
        hard: true,
        autoFixable: false,
        suggestion: 'Delete the negation; state only the positive claim.',
      });
    }
  }

  // Em dashes — always autofixable.
  {
    const re = /—/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      violations.push({
        category: 'em_dash',
        match: '—',
        index: m.index,
        hard: true,
        autoFixable: true,
        suggestion: 'Replace with a comma.',
      });
    }
  }

  // Exclamation points — autofixable (convert to period).
  {
    const re = /!/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      violations.push({
        category: 'exclamation',
        match: '!',
        index: m.index,
        hard: true,
        autoFixable: true,
        suggestion: 'Replace with a period.',
      });
    }
  }

  // First-person plural ("we") — hard; contractions and we/our are autofixable,
  // "us" is context-dependent so flagged but not autofixed.
  {
    WE_PRONOUN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WE_PRONOUN_RE.exec(text)) !== null) {
      const raw = m[0].toLowerCase();
      violations.push({
        category: 'we_pronoun',
        match: m[0],
        index: m.index,
        hard: true,
        autoFixable: raw !== 'us',
        suggestion: 'Voice DNA is first person "I", never "we".',
      });
    }
  }

  // Fragment-staccato heuristic — soft/informational only: runs of 3+
  // consecutive sentences under 5 words each.
  {
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    let runStart = -1;
    let runLen = 0;
    for (let i = 0; i <= sentences.length; i++) {
      const isShort =
        i < sentences.length && sentences[i].split(/\s+/).filter(Boolean).length < 5;
      if (isShort) {
        if (runLen === 0) runStart = i;
        runLen++;
      } else {
        if (runLen >= 3) {
          const fragment = sentences.slice(runStart, runStart + runLen).join(' ');
          violations.push({
            category: 'fragment_staccato',
            match: fragment.slice(0, 120),
            index: text.indexOf(sentences[runStart]),
            hard: false,
            autoFixable: false,
            suggestion:
              'Fragment-staccato run: merge some of these into complete sentences.',
          });
        }
        runLen = 0;
      }
    }
  }

  violations.sort((a, b) => a.index - b.index);
  const hard = violations.filter((v) => v.hard);
  return {
    pass: hard.length === 0,
    violations,
    autoFixable: violations.filter((v) => v.autoFixable),
  };
}

/* ------------------------------------------------------------------ */
/* Auto-fix (mechanical repairs only)                                  */
/* ------------------------------------------------------------------ */

/**
 * Applies only the mechanical fixes: em dash → comma, `!` → `.`,
 * unambiguous we/our contractions → first person. Everything else
 * (banned phrases, fatal pattern) needs a rewrite, not a patch.
 */
export function autoFixVoiceDna(text: string): string {
  let out = text;

  // Em dash → comma. Collapse surrounding spaces to a natural ", ".
  out = out.replace(/\s*—\s*/g, ', ');

  // Exclamation → period (dedupe runs like "!!" first).
  out = out.replace(/!+/g, '.');

  // Unambiguous first-person-plural fixes, preserving initial capitalization.
  for (const [re, replacement] of WE_FIXES) {
    out = out.replace(re, (match) => {
      const isCapitalized = /^[A-Z]/.test(match);
      if (replacement.startsWith('I')) return replacement; // "I" is always capital
      return isCapitalized
        ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
        : replacement;
    });
  }

  return out;
}

/**
 * Convenience: lint, auto-fix what's mechanical, lint again.
 * Callers gate on `result.pass` of the second lint.
 */
export function lintAndAutoFix(text: string): { text: string; result: VoiceLintResult } {
  const first = lintVoiceDna(text);
  if (first.pass) return { text, result: first };
  const fixed = autoFixVoiceDna(text);
  return { text: fixed, result: lintVoiceDna(fixed) };
}
