import { describe, it, expect } from 'vitest';
import { snapValue } from '../snap';

describe('snapValue', () => {
  const targets = [0, 5, 10, 20];

  it('snaps to the nearest target within tolerance', () => {
    expect(snapValue(5.3, targets, 0.5)).toEqual({ value: 5, snapped: true, target: 5 });
    expect(snapValue(9.6, targets, 0.5)).toEqual({ value: 10, snapped: true, target: 10 });
  });

  it('returns the candidate untouched outside tolerance', () => {
    expect(snapValue(7.5, targets, 0.5)).toEqual({ value: 7.5, snapped: false });
  });

  it('prefers the closest target when several are in range', () => {
    expect(snapValue(6, [5, 6.4], 1).target).toBe(6.4);
  });

  it('ignores excluded targets (own edge)', () => {
    const r = snapValue(5.1, targets, 0.5, [5]);
    expect(r.snapped).toBe(false);
    expect(r.value).toBe(5.1);
  });

  it('zero or negative tolerance never snaps', () => {
    expect(snapValue(5, targets, 0).snapped).toBe(false);
  });
});
