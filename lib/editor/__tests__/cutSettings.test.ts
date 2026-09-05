import { describe, expect, it } from 'vitest';
import { detectRetakesFromWords } from '../retakeDetection';
import { runCutStages } from '../cutPipeline';
import {
  applyAction,
  createPlan,
  resolveCutSettings,
  DEFAULT_CUT_SETTINGS,
  editedDurationMs,
  type EditPlan,
} from '../editPlan';
import type { Word } from '../autoCut';

/** Build words spaced 0.3s apart starting at `at`, one word per token. */
function line(text: string, at: number, confidence?: number): Word[] {
  return text.split(' ').map((tok, i) => ({
    text: tok,
    start: at + i * 0.3,
    end: at + i * 0.3 + 0.25,
    ...(confidence !== undefined ? { confidence } : {}),
  }));
}

describe('retake keeperPreference', () => {
  const twoTakes = [
    ...line('strong hips drive the serve forward', 0),
    ...line('strong hips drive the serve forward always', 4),
  ];

  it("defaults to 'last' (existing behavior)", () => {
    const { groups } = detectRetakesFromWords(twoTakes);
    expect(groups).toHaveLength(1);
    expect(groups[0].keptIndex).toBe(1);
    expect(groups[0].flagged).toBe(false);
  });

  it("'first' keeps the first take", () => {
    const { groups, removeRanges } = detectRetakesFromWords(twoTakes, {
      keeperPreference: 'first',
    });
    expect(groups[0].keptIndex).toBe(0);
    // The non-keeper (the later take) is what gets removed.
    expect(removeRanges).toHaveLength(1);
    expect(removeRanges[0].start).toBeGreaterThanOrEqual(4);
  });

  it("'longest' keeps the take with the most words", () => {
    const words = [
      ...line('strong hips drive the serve forward every single time', 0),
      ...line('strong hips drive the serve forward', 5),
    ];
    const { groups } = detectRetakesFromWords(words, { keeperPreference: 'longest' });
    expect(groups[0].keptIndex).toBe(0);
  });

  it("'ask' cuts like 'last' but flags every group", () => {
    const { groups } = detectRetakesFromWords(twoTakes, { keeperPreference: 'ask' });
    expect(groups[0].keptIndex).toBe(1);
    expect(groups[0].flagged).toBe(true);
  });

  it("'first' falls back to a complete take when the first looks low-confidence", () => {
    const words = [
      ...line('strong hips drive the serve forward', 0, 0.5), // mumbled first attempt
      ...line('strong hips drive the serve forward', 4, 0.95),
    ];
    const { groups } = detectRetakesFromWords(words, { keeperPreference: 'first' });
    // First take has anomalously low ASR confidence vs the redo — fall
    // forward to the complete take and flag for review.
    expect(groups[0].keptIndex).toBeGreaterThan(0);
    expect(groups[0].flagged).toBe(true);
  });
});

describe('cut settings on the plan', () => {
  it('resolveCutSettings applies defaults and per-plan overrides', () => {
    expect(resolveCutSettings({ cutSettings: undefined })).toEqual(DEFAULT_CUT_SETTINGS);
    const resolved = resolveCutSettings({ cutSettings: { minSilenceSeconds: 1.0 } });
    expect(resolved.minSilenceSeconds).toBe(1.0);
    expect(resolved.retakePreference).toBe('last');
  });

  it('set_cut_settings patches without clobbering other fields', () => {
    let plan = createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 60 });
    plan = applyAction(plan, { type: 'set_cut_settings', params: { minSilenceSeconds: 0.9 } });
    plan = applyAction(plan, { type: 'set_cut_settings', params: { retakePreference: 'ask' } });
    expect(plan.cutSettings).toEqual({ minSilenceSeconds: 0.9, retakePreference: 'ask' });
  });
});

describe('restore_gap', () => {
  function planWithGap(): EditPlan {
    const plan = createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 30 });
    // Simulate an auto-cut that removed 10–14s.
    return applyAction(plan, {
      type: 'auto_cut',
      params: {
        clips: [
          { id: 'a', sourceStart: 0, sourceEnd: 10 },
          { id: 'b', sourceStart: 14, sourceEnd: 30 },
        ],
        stats: { removedCount: 1, removedSeconds: 4 },
      },
    });
  }

  it('re-inserts the removed range as a clip at its chronological spot', () => {
    const restored = applyAction(planWithGap(), {
      type: 'restore_gap',
      params: { ranges: [{ start: 10, end: 14 }] },
    });
    expect(restored.clips).toHaveLength(3);
    expect(restored.clips[1].sourceStart).toBe(10);
    expect(restored.clips[1].sourceEnd).toBe(14);
    expect(restored.clips[1].reason).toBe('manual');
    expect(editedDurationMs(restored)).toBe(30_000);
  });

  it('clamps against existing clips so source time is never double-covered', () => {
    const restored = applyAction(planWithGap(), {
      type: 'restore_gap',
      params: { ranges: [{ start: 8, end: 16 }] },
    });
    expect(restored.clips).toHaveLength(3);
    expect(restored.clips[1].sourceStart).toBe(10);
    expect(restored.clips[1].sourceEnd).toBe(14);
  });

  it('shifts captions at/after the insertion point right', () => {
    let plan = planWithGap();
    plan = applyAction(plan, {
      type: 'generate_captions',
      params: {
        captions: [
          { id: 'c1', text: 'before', startMs: 2000, endMs: 4000 },
          { id: 'c2', text: 'after', startMs: 12_000, endMs: 14_000 },
        ],
      },
    });
    const restored = applyAction(plan, {
      type: 'restore_gap',
      params: { ranges: [{ start: 10, end: 14 }] },
    });
    expect(restored.captions[0].startMs).toBe(2000);
    expect(restored.captions[1].startMs).toBe(16_000);
    expect(restored.captions[1].endMs).toBe(18_000);
  });

  it('is a no-op for a fully covered range', () => {
    const plan = planWithGap();
    const restored = applyAction(plan, {
      type: 'restore_gap',
      params: { ranges: [{ start: 2, end: 6 }] },
    });
    expect(restored.clips).toEqual(plan.clips);
  });
});

describe('runCutStages', () => {
  it('honours minSilenceSeconds and writes a tagged cutLog', () => {
    const words = [...line('one two three', 0), ...line('four five six', 2)];
    const duration = 4;
    // Silence 0.95..1.95 (1.0s) between the lines.
    const silences = [{ start: 0.95, end: 1.95 }];

    const loose = runCutStages({
      duration, words, silences,
      fillerWords: [],
      settings: { minSilenceSeconds: 1.5 },
    });
    expect(loose.stages.silences.cutCount).toBe(0);

    const tight = runCutStages({
      duration, words, silences,
      fillerWords: [],
      settings: { minSilenceSeconds: 0.6 },
    });
    expect(tight.stages.silences.cutCount).toBe(1);
    expect(tight.cutLog.some((e) => e.reason === 'silence')).toBe(true);
  });

  it('tags filler removals in the cutLog', () => {
    const words = [
      ...line('the plan is solid', 0),
      { text: 'um', start: 1.4, end: 1.6 },
      ...line('and it works', 1.8),
    ];
    const result = runCutStages({
      duration: 3,
      words,
      silences: [],
      fillerWords: ['um'],
      settings: { minSilenceSeconds: 0.6 },
    });
    expect(result.stages.fillers.cutCount).toBe(1);
    expect(result.cutLog.some((e) => e.reason === 'filler')).toBe(true);
  });

  it('threads retakePreference through to the retake stage', () => {
    // Second take starts > 4s after the first ends so the (earlier)
    // stutter stage's restart window doesn't consume the repeat first.
    const words = [
      ...line('strong hips drive the serve forward', 0),
      ...line('strong hips drive the serve forward always', 6.5),
    ];
    const result = runCutStages({
      duration: 12,
      words,
      silences: [],
      fillerWords: [],
      settings: { retakePreference: 'ask' },
    });
    expect(result.retakeGroups).toHaveLength(1);
    expect(result.retakeGroups[0].flagged).toBe(true);
  });
});
