import { describe, it, expect } from 'vitest';
import {
  applyAction,
  clipEditedMs,
  clipSpeed,
  createPlan,
  editedDurationMs,
  editedMsToSource,
  migratePlan,
  sourceMsToEditedMs,
  validatePlan,
  EDIT_PLAN_VERSION,
  type Clip,
  type EditPlan,
} from '../editPlan';
import { sourceSecToEditedMs } from '../captionChunker';
import { atempoChain } from '../ffmpeg';

function makePlan(clips: Clip[]): EditPlan {
  const base = createPlan({
    slug: 'speed-test',
    sourceVideo: 'source.mp4',
    sourceDuration: 30,
  });
  return { ...base, clips };
}

describe('clipSpeed / clipEditedMs', () => {
  it('defaults to 1 when speed is absent, zero, negative, or NaN', () => {
    expect(clipSpeed({ id: 'a', sourceStart: 0, sourceEnd: 10 })).toBe(1);
    expect(clipSpeed({ id: 'a', sourceStart: 0, sourceEnd: 10, speed: 0 })).toBe(1);
    expect(clipSpeed({ id: 'a', sourceStart: 0, sourceEnd: 10, speed: -2 })).toBe(1);
    expect(clipSpeed({ id: 'a', sourceStart: 0, sourceEnd: 10, speed: NaN })).toBe(1);
  });

  it('divides source duration by speed', () => {
    expect(clipEditedMs({ id: 'a', sourceStart: 0, sourceEnd: 10 })).toBe(10000);
    expect(clipEditedMs({ id: 'a', sourceStart: 0, sourceEnd: 10, speed: 2 })).toBe(5000);
    expect(clipEditedMs({ id: 'a', sourceStart: 0, sourceEnd: 3, speed: 0.5 })).toBe(6000);
  });
});

describe('time mapping with speed', () => {
  const plan = makePlan([
    { id: 'a', sourceStart: 0, sourceEnd: 10, speed: 2 },  // edited 0–5000
    { id: 'b', sourceStart: 10, sourceEnd: 20 },           // edited 5000–15000
  ]);

  it('editedDurationMs accounts for speed', () => {
    expect(editedDurationMs(plan)).toBe(15000);
  });

  it('sourceMsToEditedMs compresses inside a sped clip', () => {
    expect(sourceMsToEditedMs(plan, 5000)).toBe(2500);
    expect(sourceMsToEditedMs(plan, 15000)).toBe(10000);
  });

  it('editedMsToSource expands back to source time', () => {
    expect(editedMsToSource(plan, 2500)).toEqual({ clipIndex: 0, sourceMs: 5000 });
    expect(editedMsToSource(plan, 7500)).toEqual({ clipIndex: 1, sourceMs: 12500 });
  });

  it('round-trips source → edited → source', () => {
    for (const src of [0, 1234, 9999, 10001, 19999]) {
      const edited = sourceMsToEditedMs(plan, src)!;
      const back = editedMsToSource(plan, edited)!;
      expect(back.sourceMs).toBeCloseTo(src, 6);
    }
  });

  it('captionChunker sourceSecToEditedMs matches the plan mapping', () => {
    expect(sourceSecToEditedMs(plan.clips, 5)).toBe(2500);
    expect(sourceSecToEditedMs(plan.clips, 15)).toBe(10000);
  });
});

describe('applyAction: set_clip_speed', () => {
  const plan = makePlan([{ id: 'a', sourceStart: 0, sourceEnd: 10 }]);

  it('sets a preset speed', () => {
    const next = applyAction(plan, { type: 'set_clip_speed', params: { clipId: 'a', speed: 2 } });
    expect(next.clips[0].speed).toBe(2);
  });

  it('speed 1 strips the field entirely', () => {
    const sped = applyAction(plan, { type: 'set_clip_speed', params: { clipId: 'a', speed: 3 } });
    const back = applyAction(sped, { type: 'set_clip_speed', params: { clipId: 'a', speed: 1 } });
    expect('speed' in back.clips[0]).toBe(false);
  });

  it('rejects non-positive and non-finite speeds', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const next = applyAction(plan, { type: 'set_clip_speed', params: { clipId: 'a', speed: bad } });
      expect(next.clips[0].speed).toBeUndefined();
    }
  });

  it('no-ops on an unknown clip id', () => {
    const next = applyAction(plan, { type: 'set_clip_speed', params: { clipId: 'zzz', speed: 2 } });
    expect(next.clips).toEqual(plan.clips);
  });
});

describe('speed survives clip surgery', () => {
  it('split_clip carries speed onto both halves', () => {
    const plan = makePlan([{ id: 'a', sourceStart: 0, sourceEnd: 10, speed: 2 }]);
    const next = applyAction(plan, { type: 'split_clip', params: { clipId: 'a', atSourceSeconds: 4 } });
    expect(next.clips).toHaveLength(2);
    expect(next.clips[0].speed).toBe(2);
    expect(next.clips[1].speed).toBe(2);
    expect(editedDurationMs(next)).toBe(5000);
  });

  it('delete_clip shifts captions by the SPED duration', () => {
    const plan: EditPlan = {
      ...makePlan([
        { id: 'a', sourceStart: 0, sourceEnd: 10, speed: 2 }, // edited 0–5000
        { id: 'b', sourceStart: 10, sourceEnd: 20 },          // edited 5000–15000
        { id: 'c', sourceStart: 20, sourceEnd: 30 },          // edited 15000–25000
      ]),
      captions: [
        { id: 'cap1', text: 'inside a', startMs: 1000, endMs: 2000 },
        { id: 'cap2', text: 'after a', startMs: 6000, endMs: 7000 },
      ],
    };
    const next = applyAction(plan, { type: 'delete_clip', params: { clipId: 'a' } });
    expect(next.captions.find((c) => c.id === 'cap1')).toBeUndefined();
    const cap2 = next.captions.find((c) => c.id === 'cap2')!;
    // Shift left by clip a's EDITED 5000ms, not its source 10000ms.
    expect(cap2.startMs).toBe(1000);
    expect(cap2.endMs).toBe(2000);
  });
});

describe('plan versioning (v3)', () => {
  it('accepts version 1, 2, and 3 plans; rejects future versions', () => {
    const base = makePlan([{ id: 'a', sourceStart: 0, sourceEnd: 10 }]);
    for (const v of [1, 2, 3]) {
      expect(validatePlan({ ...base, version: v })).toBe(true);
    }
    expect(validatePlan({ ...base, version: EDIT_PLAN_VERSION + 1 })).toBe(false);
  });

  it('migratePlan stamps older plans to the current version', () => {
    const v1 = { ...makePlan([{ id: 'a', sourceStart: 0, sourceEnd: 10 }]), version: 1 as const };
    expect(migratePlan(v1).version).toBe(EDIT_PLAN_VERSION);
  });

  it('createPlan writes the current version', () => {
    expect(createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 1 }).version).toBe(EDIT_PLAN_VERSION);
  });
});

describe('atempoChain', () => {
  it('passes through in-range factors', () => {
    expect(atempoChain(1)).toBe('atempo=1');
    expect(atempoChain(0.5)).toBe('atempo=0.5');
    expect(atempoChain(2)).toBe('atempo=2');
  });

  it('decomposes 0.3x into portable [0.5, 2] steps', () => {
    expect(atempoChain(0.3)).toBe('atempo=0.5,atempo=0.6');
  });

  it('decomposes 3x and 4x', () => {
    expect(atempoChain(3)).toBe('atempo=2,atempo=1.5');
    expect(atempoChain(4)).toBe('atempo=2,atempo=2');
  });

  it('every UI preset multiplies back to itself', () => {
    for (const preset of [0.3, 0.5, 1, 2, 3, 4]) {
      const product = atempoChain(preset)
        .split(',')
        .map((p) => parseFloat(p.replace('atempo=', '')))
        .reduce((a, b) => a * b, 1);
      expect(product).toBeCloseTo(preset, 6);
    }
  });
});
