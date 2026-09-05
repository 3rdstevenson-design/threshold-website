import { describe, it, expect } from 'vitest';
import { collectFlags } from '../reviewFlags';
import type { DisfluencyRange } from '../disfluency';

const range = (id: string, s: number, e: number, kind: DisfluencyRange['kind'], rejected?: DisfluencyRange['rejected']): DisfluencyRange => ({
  id, startSec: s, endSec: e, reason: kind, startIdx: 0, endIdx: 0, preview: id, kind, rejected,
});

describe('collectFlags', () => {
  it('is empty on a clean run', () => {
    expect(collectFlags({ retakeGroups: [{ id: 'g', alternatives: [], keptAlternativeId: 'a', flagged: false, reason: '' }], disfluencyProposed: [range('a', 0, 1, 'filler')], hook: null })).toEqual([]);
  });

  it('flags retake groups, long rejected cuts, and hook problems', () => {
    const flags = collectFlags({
      retakeGroups: [{ id: 'g', alternatives: [], keptAlternativeId: 'a', flagged: true, reason: 'short' }],
      disfluencyProposed: [
        range('kept', 0, 1, 'filler'),
        range('short-rej', 2, 2.5, 'filler', 'total-cap'),       // short filler: not flagged
        range('long-rej', 5, 8, 'repeat', 'total-cap'),          // ≥2s: flagged
        range('restart-rej', 10, 11, 'restart', 'too-long'),     // restart: flagged regardless
      ],
      hook: { generatedAt: '', model: '', sourceWords: 1, candidates: [], chosenId: null, applied: false, flags: ['hook-lint'] },
    });
    expect(flags.map((f) => f.code)).toEqual(['retake-flagged', 'disfluency-long-rejected', 'hook-lint']);
    expect(flags[1].count).toBe(2);
  });
});
