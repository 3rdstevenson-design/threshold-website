import { describe, it, expect } from 'vitest';
import {
  autoCut,
  autoCutStaged,
  mergeRanges,
  invertRanges,
  normalizeWord,
  filterTinyClips,
  removeSilences,
  removeFillers,
  removeStutters,
} from '../autoCut';

describe('normalizeWord', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeWord('Um,')).toBe('um');
    expect(normalizeWord('"Like."')).toBe('like');
    expect(normalizeWord('  YOU  ')).toBe('you');
  });
});

describe('mergeRanges', () => {
  it('merges overlapping', () => {
    expect(mergeRanges([{ start: 0, end: 2 }, { start: 1, end: 3 }])).toEqual([
      { start: 0, end: 3 },
    ]);
  });
  it('keeps disjoint', () => {
    expect(mergeRanges([{ start: 0, end: 1 }, { start: 2, end: 3 }])).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ]);
  });
  it('sorts unordered input', () => {
    expect(mergeRanges([{ start: 2, end: 3 }, { start: 0, end: 1 }])).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ]);
  });
});

describe('invertRanges', () => {
  it('inverts a single middle cut', () => {
    expect(invertRanges([{ start: 2, end: 4 }], 10)).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 10 },
    ]);
  });
  it('returns whole video when no cuts', () => {
    expect(invertRanges([], 10)).toEqual([{ start: 0, end: 10 }]);
  });
  it('handles cut at start', () => {
    expect(invertRanges([{ start: 0, end: 1 }], 5)).toEqual([
      { start: 1, end: 5 },
    ]);
  });
  it('handles cut at end', () => {
    expect(invertRanges([{ start: 4, end: 5 }], 5)).toEqual([
      { start: 0, end: 4 },
    ]);
  });
});

describe('autoCut', () => {
  // Disable the min-clip filter in most tests so we can validate cut
  // logic independently. A dedicated block below tests the filter.
  const baseArgs = {
    duration: 30,
    words: [] as { start: number; end: number; text: string }[],
    silences: [] as { start: number; end: number }[],
    fillerWords: ['um', 'uh', 'you know'],
    options: { minClipSeconds: 0 },
  };

  it('returns single full-length clip when no cuts', () => {
    const r = autoCut({ ...baseArgs });
    expect(r.clips).toHaveLength(1);
    expect(r.clips[0].sourceStart).toBe(0);
    expect(r.clips[0].sourceEnd).toBe(30);
    expect(r.stats.removedCount).toBe(0);
  });

  it('cuts a silence above threshold with buffer', () => {
    const r = autoCut({
      ...baseArgs,
      silences: [{ start: 5, end: 7 }],
      options: { minSilenceSeconds: 0.5, silencePaddingSeconds: 0.15, minClipSeconds: 0 },
    });
    expect(r.clips).toHaveLength(2);
    expect(r.clips[0].sourceStart).toBe(0);
    expect(r.clips[0].sourceEnd).toBeCloseTo(5.15, 2);
    expect(r.clips[1].sourceStart).toBeCloseTo(6.85, 2);
    expect(r.clips[1].sourceEnd).toBe(30);
    expect(r.stats.silenceCuts).toBe(1);
  });

  it('ignores silences below threshold', () => {
    const r = autoCut({
      ...baseArgs,
      silences: [{ start: 5, end: 5.2 }],
    });
    expect(r.clips).toHaveLength(1);
    expect(r.stats.silenceCuts).toBe(0);
  });

  it('cuts a single-word filler', () => {
    const r = autoCut({
      ...baseArgs,
      words: [
        { start: 0, end: 0.5, text: 'Hi' },
        { start: 1, end: 1.5, text: 'um' },
        { start: 2, end: 2.5, text: 'welcome' },
      ],
    });
    expect(r.stats.fillerCuts).toBe(1);
    expect(r.clips).toHaveLength(2);
  });

  it('cuts a multi-word filler sequence', () => {
    const r = autoCut({
      ...baseArgs,
      words: [
        { start: 0, end: 0.5, text: 'Hi' },
        { start: 1.0, end: 1.3, text: 'you' },
        { start: 1.3, end: 1.7, text: 'know' },
        { start: 2.0, end: 2.5, text: 'welcome' },
      ],
    });
    expect(r.stats.fillerCuts).toBe(1);
    // Two clips survive: "Hi" region and "welcome" region
    expect(r.clips).toHaveLength(2);
  });

  it('merges overlapping silence + filler cuts', () => {
    const r = autoCut({
      ...baseArgs,
      silences: [{ start: 5, end: 6 }],
      words: [{ start: 5.5, end: 5.8, text: 'um' }], // inside the silence
    });
    // Should produce a single merged cut, so 2 clips
    expect(r.clips).toHaveLength(2);
    expect(r.stats.removedCount).toBe(1); // merged to one range
  });

  it('handles a cut right at the start of the video', () => {
    const r = autoCut({
      ...baseArgs,
      silences: [{ start: 0, end: 1 }],
    });
    // Silence at the video edge extends to the edge (no 150ms orphan clip)
    expect(r.clips).toHaveLength(1);
    expect(r.clips[0].sourceStart).toBeCloseTo(0.85, 2);
  });

  it('handles a cut right at the end of the video', () => {
    const r = autoCut({
      ...baseArgs,
      silences: [{ start: 29, end: 30 }],
    });
    expect(r.clips).toHaveLength(1);
    expect(r.clips[0].sourceEnd).toBeCloseTo(29.15, 2);
  });

  it('drops kept ranges shorter than minClipSeconds', () => {
    // A 1s silence at [5,6] with 0.15s pad → cut [5.15, 5.85]. Kept: [0,5.15] and [5.85,30].
    // Now add a 1s silence at [5.9, 6.9] → cut [6.05, 6.75]. Kept: [0,5.15], [5.85,6.05], [6.75,30].
    // The middle kept range [5.85, 6.05] is only 0.2s — should be dropped with default minClipSeconds.
    const r = autoCut({
      duration: 30,
      words: [],
      silences: [{ start: 5, end: 6 }, { start: 5.9, end: 6.9 }],
      fillerWords: [],
      // Use default minClipSeconds (1.0)
    });
    // Should have dropped the 0.2s sliver
    expect(r.stats.droppedTinyClips).toBeGreaterThanOrEqual(1);
    for (const c of r.clips) {
      expect(c.sourceEnd - c.sourceStart).toBeGreaterThanOrEqual(1.0);
    }
  });

  it('uses minClipSeconds of 1.0 by default', () => {
    // With no options override, a 0.9s clip at the start should disappear
    const r = autoCut({
      duration: 30,
      words: [{ start: 1.0, end: 1.5, text: 'um' }], // creates cut [0.95, 1.55]; kept [0,0.95] + [1.55,30]
      silences: [],
      fillerWords: ['um'],
    });
    expect(r.clips).toHaveLength(1); // the 0.95s head was dropped
    expect(r.clips[0].sourceStart).toBeCloseTo(1.55, 2);
    expect(r.stats.droppedTinyClips).toBe(1);
  });
});

describe('filterTinyClips', () => {
  it('drops clips shorter than threshold', () => {
    const { clips, dropped } = filterTinyClips([
      { id: 'a', sourceStart: 0, sourceEnd: 0.5 },
      { id: 'b', sourceStart: 1, sourceEnd: 3 },
      { id: 'c', sourceStart: 5, sourceEnd: 5.2 },
    ], 1.0);
    expect(clips).toHaveLength(1);
    expect(clips[0].id).toBe('b');
    expect(dropped).toBe(2);
  });

  it('keeps everything when threshold is 0', () => {
    const { clips, dropped } = filterTinyClips([
      { id: 'a', sourceStart: 0, sourceEnd: 0.1 },
    ], 0);
    expect(clips).toHaveLength(1);
    expect(dropped).toBe(0);
  });
});

describe('autoCut — case insensitivity', () => {
  it('case-insensitive filler matching', () => {
    const r = autoCut({
      duration: 30,
      words: [
        { start: 0, end: 0.5, text: 'Hi' },
        { start: 1, end: 1.3, text: 'Um,' }, // capitalized with comma
        { start: 2, end: 2.5, text: 'welcome' },
      ],
      silences: [],
      fillerWords: ['um'],
      options: { minClipSeconds: 0 },
    });
    expect(r.stats.fillerCuts).toBe(1);
  });
});

// The unified /process pipeline runs each stage explicitly so the Toolbar
// can show per-stage counts. These tests ensure each stage's stats reflect
// ONLY what that stage cut — not a merged total.
describe('staged autoCut — stage isolation', () => {
  it('removeSilences reports only silence cuts', () => {
    const a = removeSilences({
      duration: 30,
      silences: [
        { start: 5, end: 7 },
        { start: 10, end: 10.2 }, // below threshold, ignored
      ],
    });
    expect(a.stats.cutCount).toBe(1);
    expect(a.clips).toHaveLength(2);
    expect(a.stats.secondsRemoved).toBeGreaterThan(0);
  });

  it('removeFillers operates on post-silence timeline', () => {
    const a = removeSilences({
      duration: 30,
      silences: [{ start: 5, end: 7 }],
    });
    const b = removeFillers({
      clips: a.clips,
      words: [
        { start: 0, end: 0.5, text: 'Hi' },
        { start: 1, end: 1.5, text: 'um' },
        { start: 8, end: 8.5, text: 'welcome' },
        { start: 9, end: 9.3, text: 'um' },
      ],
      fillerWords: ['um'],
      duration: 30,
    });
    // Both "um" words are outside the silence cut → both get filtered
    expect(b.stats.cutCount).toBe(2);
    expect(b.stats.secondsRemoved).toBeGreaterThan(0);
    expect(b.stats.secondsRemoved).toBeLessThan(1.5); // ~1s of "um" words + padding
  });

  it('removeStutters uses injected detector and runs on post-filler words', () => {
    const a = removeSilences({ duration: 30, silences: [] });
    const b = removeFillers({
      clips: a.clips,
      words: [
        { start: 0, end: 0.5, text: 'Hello' },
        { start: 1, end: 1.5, text: 'um' },
        { start: 2, end: 2.5, text: 'world' },
      ],
      fillerWords: ['um'],
      duration: 30,
    });
    const detectorCalls: Array<{ count: number; hasUm: boolean }> = [];
    const c = removeStutters({
      clips: b.clips,
      words: [
        { start: 0, end: 0.5, text: 'Hello' },
        { start: 1, end: 1.5, text: 'um' },
        { start: 2, end: 2.5, text: 'world' },
      ],
      duration: 30,
      detector: (survivingWords) => {
        detectorCalls.push({
          count: survivingWords.length,
          hasUm: survivingWords.some((w) => w.text.toLowerCase() === 'um'),
        });
        return {
          removeRanges: [],
          phrasesRemoved: 0,
          singleWordsRemoved: 0,
          fragmentsRemoved: 0,
        };
      },
      options: { minClipSeconds: 0 },
    });
    expect(detectorCalls).toHaveLength(1);
    // Detector received only words OUTSIDE the filler cut — no "um"
    expect(detectorCalls[0].hasUm).toBe(false);
    expect(detectorCalls[0].count).toBe(2);
    expect(c.stats.phrasesRemoved).toBe(0);
  });

  it('removeStutters preserves last-occurrence keep behavior via detector', () => {
    const allClips = [{ id: 'clip1', sourceStart: 0, sourceEnd: 10 }];
    const words = [
      { start: 0, end: 0.3, text: 'the' }, // earlier — should be cut
      { start: 1, end: 1.3, text: 'the' }, // last — kept
      { start: 2, end: 2.5, text: 'cat' },
    ];
    const c = removeStutters({
      clips: allClips,
      words,
      duration: 10,
      detector: () => ({
        // Simulate: cut the EARLIER "the" at [0, 0.3]
        removeRanges: [{ start: 0, end: 0.4 }],
        phrasesRemoved: 0,
        singleWordsRemoved: 1,
        fragmentsRemoved: 0,
      }),
      options: { minClipSeconds: 0 },
    });
    expect(c.stats.singleWordsRemoved).toBe(1);
    // The later "the" at 1.0 must still be inside a kept clip
    const survives = c.clips.some(
      (clip) => 1.0 >= clip.sourceStart && 1.3 <= clip.sourceEnd,
    );
    expect(survives).toBe(true);
  });

  it('autoCutStaged composes all three stages in order', () => {
    const r = autoCutStaged({
      duration: 30,
      words: [
        { start: 0, end: 0.5, text: 'Hi' },
        { start: 1, end: 1.5, text: 'um' },
        { start: 8, end: 8.5, text: 'welcome' },
      ],
      silences: [{ start: 3, end: 5 }],
      fillerWords: ['um'],
      stutterDetector: () => ({
        removeRanges: [],
        phrasesRemoved: 0,
        singleWordsRemoved: 0,
        fragmentsRemoved: 0,
      }),
      options: { minClipSeconds: 0 },
    });
    expect(r.stages.silences.cutCount).toBeGreaterThan(0);
    expect(r.stages.fillers.cutCount).toBe(1);
    expect(r.stages.stutters.phrasesRemoved).toBe(0);
  });
});
