import { describe, it, expect } from 'vitest';
import { detectRepeatStutters } from '../stutterDetection';

function word(start: number, end: number, text: string) {
  return { start, end, text };
}

describe('detectRepeatStutters', () => {
  it('returns no cuts on fluent speech', () => {
    const words = [
      word(0, 0.3, 'the'),
      word(0.4, 0.7, 'quick'),
      word(0.8, 1.1, 'brown'),
      word(1.2, 1.5, 'fox'),
    ];
    const r = detectRepeatStutters(words);
    expect(r.removeRanges).toEqual([]);
  });

  it('removes a single restart phrase', () => {
    // "I want to" ... "I want to talk about it"
    const words = [
      word(0, 0.2, 'I'),
      word(0.2, 0.4, 'want'),
      word(0.4, 0.6, 'to'),
      // 0.5s pause — within maxGap
      word(1.1, 1.3, 'I'),
      word(1.3, 1.5, 'want'),
      word(1.5, 1.7, 'to'),
      word(1.7, 2.0, 'talk'),
      word(2.1, 2.4, 'about'),
      word(2.4, 2.6, 'it'),
    ];
    const r = detectRepeatStutters(words);
    expect(r.removeRanges).toHaveLength(1);
    const [range] = r.removeRanges;
    expect(range.start).toBeLessThan(0.1); // starts near the first "I"
    expect(range.end).toBeCloseTo(1.1 - 0.05, 1); // ends just before the second "I" (with padding)
  });

  it('prefers longest matching phrase', () => {
    // Short overlap AND longer overlap present — should pick the long one.
    // "the one that I" ... "the one that I saw"
    const words = [
      word(0.0, 0.2, 'the'),
      word(0.2, 0.4, 'one'),
      word(0.4, 0.6, 'that'),
      word(0.6, 0.8, 'I'),
      word(1.0, 1.2, 'the'),
      word(1.2, 1.4, 'one'),
      word(1.4, 1.6, 'that'),
      word(1.6, 1.8, 'I'),
      word(1.8, 2.0, 'saw'),
    ];
    const r = detectRepeatStutters(words);
    expect(r.removeRanges).toHaveLength(1);
    // The cut should encompass the entire first four-word phrase
    expect(r.removeRanges[0].start).toBeLessThan(0.1);
  });

  it('ignores repeats that are too far apart', () => {
    // "I said" at 0s, again at 10s — not a stutter
    const words = [
      word(0, 0.3, 'I'),
      word(0.3, 0.6, 'said'),
      word(10.0, 10.3, 'I'),
      word(10.3, 10.6, 'said'),
    ];
    const r = detectRepeatStutters(words, { maxGapSeconds: 4.0 });
    expect(r.removeRanges).toEqual([]);
  });

  it('case-insensitive and punctuation-insensitive matching', () => {
    const words = [
      word(0, 0.3, 'Hello,'),
      word(0.3, 0.6, 'World.'),
      word(1.0, 1.3, 'hello'),
      word(1.3, 1.6, 'world'),
      word(1.6, 1.9, 'again'),
    ];
    const r = detectRepeatStutters(words);
    expect(r.removeRanges).toHaveLength(1);
  });

  it('skips past matched regions (no overlapping cuts)', () => {
    // "a b a b a b c d" — three overlapping 2-grams, but we should cut
    // each stutter exactly once.
    const words = [
      word(0, 0.2, 'a'),
      word(0.2, 0.4, 'b'),
      word(0.4, 0.6, 'a'),
      word(0.6, 0.8, 'b'),
      word(0.8, 1.0, 'c'),
      word(1.0, 1.2, 'd'),
    ];
    const r = detectRepeatStutters(words);
    expect(r.removeRanges).toHaveLength(1);
    // The cut should go from near 0 up to ~0.4 (before the second "a b")
    expect(r.removeRanges[0].end).toBeLessThanOrEqual(0.5);
  });

  it('respects minPhraseLen', () => {
    // Single-word repeat "the the" — should be IGNORED with minPhraseLen=2
    const words = [
      word(0, 0.2, 'the'),
      word(0.2, 0.4, 'the'),
      word(0.4, 0.6, 'cat'),
    ];
    const r = detectRepeatStutters(words, { minPhraseLen: 2 });
    expect(r.removeRanges).toEqual([]);
  });
});

describe('detectRepeatStutters — single-word pass', () => {
  it('cuts back-to-back identical words within the tight window', () => {
    const words = [
      word(0, 0.2, 'the'),
      word(0.25, 0.45, 'the'),
      word(0.5, 0.8, 'car'),
    ];
    const r = detectRepeatStutters(words, { singleWordRepeats: true });
    expect(r.singleWordsRemoved).toBe(1);
    expect(r.removeRanges).toHaveLength(1);
  });

  it('does NOT cut single-word repeats separated by a long pause', () => {
    const words = [
      word(0, 0.2, 'very'),
      // 3s pause — too far apart to be a stutter
      word(3.3, 3.5, 'very'),
      word(3.6, 3.8, 'cold'),
    ];
    const r = detectRepeatStutters(words, { singleWordRepeats: true, singleWordGapSeconds: 1.0 });
    expect(r.singleWordsRemoved).toBe(0);
  });

  it('is case-insensitive', () => {
    const words = [
      word(0, 0.2, 'The'),
      word(0.3, 0.5, 'the'),
      word(0.6, 0.8, 'cat'),
    ];
    const r = detectRepeatStutters(words, { singleWordRepeats: true });
    expect(r.singleWordsRemoved).toBe(1);
  });

  it('off by default (backward compat)', () => {
    const words = [
      word(0, 0.2, 'the'),
      word(0.25, 0.45, 'the'),
      word(0.5, 0.8, 'car'),
    ];
    const r = detectRepeatStutters(words);
    expect(r.singleWordsRemoved).toBe(0);
  });
});

describe('detectRepeatStutters — partial-word fragments', () => {
  it('cuts a short fragment followed by its full-word restart', () => {
    // "I went to the st- the store"
    const words = [
      word(0.0, 0.2, 'I'),
      word(0.2, 0.4, 'went'),
      word(0.4, 0.6, 'to'),
      word(0.6, 0.8, 'the'),
      word(0.8, 1.0, 'st'),    // fragment
      word(1.1, 1.3, 'the'),   // restart
      word(1.3, 1.8, 'store'), // real target starting with "st"
    ];
    const r = detectRepeatStutters(words, { partialWordFragments: true });
    expect(r.fragmentsRemoved).toBeGreaterThanOrEqual(1);
    // The fragment "st" should be cut (range starts around 0.8s).
    expect(r.removeRanges.some((rg) => rg.start < 0.85 && rg.end > 0.85)).toBe(true);
  });

  it('does NOT cut legitimate short words (I, a, to, of)', () => {
    const words = [
      word(0.0, 0.2, 'I'),
      word(0.3, 0.5, 'industrialize'),
      word(0.6, 0.8, 'a'),
      word(0.9, 1.1, 'apple'),
      word(1.2, 1.4, 'to'),
      word(1.5, 1.8, 'talk'),
      word(1.9, 2.1, 'of'),
      word(2.2, 2.5, 'offices'),
    ];
    const r = detectRepeatStutters(words, { partialWordFragments: true });
    expect(r.fragmentsRemoved).toBe(0);
  });

  it('does NOT cut when next word does not start with the fragment', () => {
    const words = [
      word(0, 0.2, 'st'),
      word(0.3, 0.6, 'dog'),   // "dog" doesn't start with "st"
    ];
    const r = detectRepeatStutters(words, { partialWordFragments: true });
    expect(r.fragmentsRemoved).toBe(0);
  });

  it('off by default', () => {
    const words = [
      word(0, 0.2, 'st'),
      word(0.3, 0.6, 'store'),
    ];
    const r = detectRepeatStutters(words);
    expect(r.fragmentsRemoved).toBe(0);
  });
});
