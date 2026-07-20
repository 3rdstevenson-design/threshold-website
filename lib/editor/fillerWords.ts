/**
 * Default filler words to auto-detect and cut. Matched case-insensitively
 * against the whisper word tokens. v2 will let this be edited in-UI.
 *
 * Note on 'so' and 'well' — these are common sentence starters that Lars
 * uses intentionally. Including them here means the first-pass auto-cut
 * will be aggressive; the "Review cuts" panel lets the user uncheck any
 * range before committing. (Today we cut all at once; the review panel
 * is a v2 refinement.)
 */
export const DEFAULT_FILLER_WORDS: string[] = [
  'um',
  'uh',
  'uhm',
  'erm',
  // Note: 'like', 'basically', 'literally', 'honestly' were removed — they're
  // normal words in coaching/educational speech, and auto-cutting them ate
  // real content. Add them back per-project if a given video overuses them.
  // Compound fillers — matched as whole-word sequences by autoCut.ts
  'you know',
  'i mean',
  'kind of',
  'sort of',
];
