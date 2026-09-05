import { describe, it, expect } from 'vitest';
import { applyAggressivenessCaps, classifyReason, maxRangeSecondsFor, type DisfluencyRange } from '../disfluency';

const r = (id: string, start: number, end: number, reason: string): DisfluencyRange => ({
  id, startSec: start, endSec: end, reason, startIdx: 0, endIdx: 0, preview: id, kind: classifyReason(reason),
});

describe('classifyReason', () => {
  it('maps free-text reasons to kinds', () => {
    expect(classifyReason('restart: verbal restart')).toBe('restart');
    expect(classifyReason('false start')).toBe('restart');
    expect(classifyReason('abandoned clause')).toBe('abandoned');
    expect(classifyReason('semantic repeat')).toBe('repeat');
    expect(classifyReason('filler: you know')).toBe('filler');
    expect(classifyReason('??')).toBe('other');
  });
});

describe('applyAggressivenessCaps', () => {
  it('lets restarts run to 8s but repeats only to 4s', () => {
    expect(maxRangeSecondsFor('restart')).toBe(8);
    expect(maxRangeSecondsFor('repeat')).toBe(4);
    const proposed = [r('a', 0, 6, 'restart: said it twice'), r('b', 10, 16, 'repeat: same idea')];
    const kept = applyAggressivenessCaps(proposed, 100);
    expect(kept.map((k) => k.id)).toEqual(['a']);
    expect(proposed[1].rejected).toBe('too-long');
  });

  it('under the 25% cap keeps a long restart over several short fillers', () => {
    // 20s scoped → 5s budget. Old behaviour (shortest-first) kept the three
    // 0.4s fillers and the 1s repeat and dropped the 4.5s false start.
    const proposed = [
      r('f1', 1, 1.4, 'filler: you know'),
      r('f2', 3, 3.4, 'filler: I guess'),
      r('f3', 5, 5.4, 'filler: like I said'),
      r('rep', 7, 8, 'repeat'),
      r('restart', 10, 14.5, 'restart: abandoned first attempt'),
    ];
    const kept = applyAggressivenessCaps(proposed, 20).map((k) => k.id);
    expect(kept).toContain('restart');
    expect(kept).not.toContain('rep');
    expect(proposed.find((p) => p.id === 'rep')?.rejected).toBe('total-cap');
    // chronological order preserved
    expect(kept).toEqual([...kept].sort((a, b) => proposed.findIndex((p) => p.id === a) - proposed.findIndex((p) => p.id === b)));
  });
});
