import { describe, it, expect } from 'vitest';
import { carryCaptionEdits } from '../polishPlan';
import { applyAction, createPlan, type Caption } from '../editPlan';

describe('carryCaptionEdits', () => {
  it('re-applies a user caption edit after polish shifts edited time', () => {
    // Base plan: one clip 0-10s, two captions.
    let base = createPlan({ slug: 's', sourceVideo: 'v', sourceDuration: 10 });
    const caps: Caption[] = [
      { id: 'c1', startMs: 850, endMs: 1500, text: 'hello world', words: [{ text: 'hello', startMs: 1000, endMs: 1200 }, { text: 'world', startMs: 1200, endMs: 1500 }] },
      { id: 'c2', startMs: 4850, endMs: 5500, text: 'coach cav', words: [{ text: 'coach', startMs: 5000, endMs: 5200 }, { text: 'cav', startMs: 5200, endMs: 5500 }] },
    ];
    base = applyAction(base, { type: 'generate_captions', params: { captions: caps } });
    base = applyAction(base, { type: 'update_caption', params: { captionId: 'c2', text: 'Coach Kav' } });

    // Polish cut 2-3s, so everything after shifts 1000ms earlier in edited time.
    const polishedClips = [{ id: 'a', sourceStart: 0, sourceEnd: 2 }, { id: 'b', sourceStart: 3, sourceEnd: 10 }];
    const fresh: Caption[] = [
      { id: 'n1', startMs: 850, endMs: 1500, text: 'hello world', words: [{ text: 'hello', startMs: 1000, endMs: 1200 }] },
      { id: 'n2', startMs: 3850, endMs: 4500, text: 'coach cav', words: [{ text: 'coach', startMs: 4000, endMs: 4200 }] },
    ];
    const out = carryCaptionEdits(base, polishedClips, fresh);
    expect(out[0].text).toBe('hello world');
    expect(out[1].text).toBe('Coach Kav');
    expect(out[1].startMs).toBe(3850); // timing from the fresh chunk
  });

  it('is a no-op without edits', () => {
    const base = createPlan({ slug: 's', sourceVideo: 'v', sourceDuration: 10 });
    const fresh: Caption[] = [{ id: 'n1', startMs: 0, endMs: 1, text: 'x' }];
    expect(carryCaptionEdits(base, base.clips, fresh)).toBe(fresh);
  });
});
