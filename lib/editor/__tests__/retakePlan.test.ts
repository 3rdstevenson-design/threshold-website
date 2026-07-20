import { describe, expect, it } from 'vitest';
import {
  EDIT_PLAN_VERSION,
  applyAction,
  createPlan,
  editedDurationMs,
  migratePlan,
  validatePlan,
  type EditPlan,
  type RetakeGroup,
} from '../editPlan';
import { removeRetakes, type Word } from '../autoCut';

function planWithRetakeGroup(): EditPlan {
  const base = createPlan({ slug: 'test', sourceVideo: 'x.mp4', sourceDuration: 30 });
  const group: RetakeGroup = {
    id: 'rtg_1',
    alternatives: [
      { id: 'alt_a', sourceStart: 2, sourceEnd: 5, transcript: 'take one of the line' },
      { id: 'alt_b', sourceStart: 6, sourceEnd: 9, transcript: 'take two of the line' },
    ],
    keptAlternativeId: 'alt_b',
    flagged: false,
    reason: 'kept last take',
  };
  // Timeline after auto-cut: the first take (2–5s) was cut out.
  return {
    ...base,
    clips: [
      { id: 'clip_1', sourceStart: 0, sourceEnd: 2 },
      { id: 'clip_2', sourceStart: 6, sourceEnd: 12 },
      { id: 'clip_3', sourceStart: 14, sourceEnd: 30 },
    ],
    retakeGroups: [group],
  };
}

describe('plan versioning', () => {
  it('accepts version-1 plans (pre-retake) via validatePlan', () => {
    const v1 = { ...createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 10 }), version: 1 };
    expect(validatePlan(v1)).toBe(true);
  });

  it('rejects future versions', () => {
    const future = { ...createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 10 }), version: 99 };
    expect(validatePlan(future)).toBe(false);
  });

  it('migratePlan stamps the current version without touching content', () => {
    const v1 = { ...createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 10 }), version: 1 as const };
    const migrated = migratePlan(v1);
    expect(migrated.version).toBe(EDIT_PLAN_VERSION);
    expect(migrated.clips).toEqual(v1.clips);
    expect(migrated.captions).toEqual(v1.captions);
  });
});

describe('flip_retake_choice', () => {
  it('swaps the kept take: old keeper cut out, new take spliced in chronologically', () => {
    const plan = planWithRetakeGroup();
    const next = applyAction(plan, {
      type: 'flip_retake_choice',
      params: { groupId: 'rtg_1', alternativeId: 'alt_a' },
    });

    // Group now keeps alt_a.
    expect(next.retakeGroups?.[0].keptAlternativeId).toBe('alt_a');

    // alt_a's range (2–5) is on the timeline as its own clip…
    const inserted = next.clips.find((c) => c.group === 'rtg_1');
    expect(inserted).toBeDefined();
    expect(inserted!.sourceStart).toBe(2);
    expect(inserted!.sourceEnd).toBe(5);
    expect(inserted!.reason).toBe('retake');

    // …and alt_b's range (6–9) is no longer covered by any clip.
    const coversOldKeeper = next.clips.some(
      (c) => c.sourceStart < 9 && c.sourceEnd > 6,
    );
    expect(coversOldKeeper).toBe(false);

    // clip_2 (6–12) got trimmed to its remnant (9–12).
    const remnant = next.clips.find((c) => c.sourceStart === 9 && c.sourceEnd === 12);
    expect(remnant).toBeDefined();

    // Chronological ordering holds.
    const starts = next.clips.map((c) => c.sourceStart);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('is a no-op for unknown group or already-kept alternative', () => {
    const plan = planWithRetakeGroup();
    const same1 = applyAction(plan, {
      type: 'flip_retake_choice',
      params: { groupId: 'nope', alternativeId: 'alt_a' },
    });
    expect(same1.clips).toEqual(plan.clips);
    const same2 = applyAction(plan, {
      type: 'flip_retake_choice',
      params: { groupId: 'rtg_1', alternativeId: 'alt_b' },
    });
    expect(same2.clips).toEqual(plan.clips);
  });

  it('flipping back restores the original keeper on the timeline', () => {
    const plan = planWithRetakeGroup();
    const flipped = applyAction(plan, {
      type: 'flip_retake_choice',
      params: { groupId: 'rtg_1', alternativeId: 'alt_a' },
    });
    const back = applyAction(flipped, {
      type: 'flip_retake_choice',
      params: { groupId: 'rtg_1', alternativeId: 'alt_b' },
    });
    expect(back.retakeGroups?.[0].keptAlternativeId).toBe('alt_b');
    const keeper = back.clips.find((c) => c.group === 'rtg_1');
    expect(keeper?.sourceStart).toBe(6);
    expect(keeper?.sourceEnd).toBe(9);
    // Total edited duration returns to the original.
    expect(editedDurationMs(back)).toBeCloseTo(editedDurationMs(plan), -2);
  });
});

describe('removeRetakes stage', () => {
  it('cuts non-keeper ranges and reports groups', () => {
    const words: Word[] = [];
    const clips = [{ id: 'c1', sourceStart: 0, sourceEnd: 20 }];
    const result = removeRetakes({
      clips,
      words,
      duration: 20,
      detector: () => ({
        removeRanges: [{ start: 2, end: 5 }],
        groups: [
          {
            alternatives: [
              { start: 2, end: 5, transcript: 'take one' },
              { start: 6, end: 9, transcript: 'take two' },
            ],
            keptIndex: 1,
            flagged: false,
            reason: 'kept last take',
          },
        ],
      }),
    });
    expect(result.stats.groupsFound).toBe(1);
    expect(result.stats.cutCount).toBe(1);
    // 2–5s removed → clips are 0–2 and 5–20.
    expect(result.clips).toHaveLength(2);
    expect(result.clips[0].sourceEnd).toBeCloseTo(2, 5);
    expect(result.clips[1].sourceStart).toBeCloseTo(5, 5);
  });
});
