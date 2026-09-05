import { describe, it, expect } from 'vitest';
import {
  applyAction,
  createPlan,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_SPELLING_CORRECTIONS,
  resolveCaptionStyle,
  type EditPlan,
} from '../editPlan';

function makePlan(): EditPlan {
  const base = createPlan({
    slug: 'test',
    sourceVideo: 'source.mp4',
    sourceDuration: 30,
  });
  // Replace the single full-span clip with three equal clips so we can
  // test cascade deletes on a non-trivial timeline.
  return {
    ...base,
    clips: [
      { id: 'a', sourceStart: 0, sourceEnd: 10 },
      { id: 'b', sourceStart: 10, sourceEnd: 20 },
      { id: 'c', sourceStart: 20, sourceEnd: 30 },
    ],
  };
}

describe('applyAction: delete_clip cascade', () => {
  it('removes captions whose edited-time range is inside the deleted clip', () => {
    // Edited timeline with 3 clips of 10s each: 0-10k, 10k-20k, 20k-30k.
    const plan: EditPlan = {
      ...makePlan(),
      captions: [
        { id: 'cap-a', text: 'A', startMs: 1000, endMs: 2000 },  // in clip a
        { id: 'cap-b', text: 'B', startMs: 12000, endMs: 13000 }, // in clip b
        { id: 'cap-c', text: 'C', startMs: 22000, endMs: 23000 }, // in clip c
      ],
    };
    const next = applyAction(plan, { type: 'delete_clip', params: { clipId: 'b' } });
    expect(next.clips).toHaveLength(2);
    expect(next.captions.map((c) => c.id)).toEqual(['cap-a', 'cap-c']);
  });

  it('shifts captions after the deleted range left by the deleted duration', () => {
    const plan: EditPlan = {
      ...makePlan(),
      captions: [
        { id: 'cap-a', text: 'A', startMs: 1000, endMs: 2000 },
        { id: 'cap-c', text: 'C', startMs: 22000, endMs: 23000 },
      ],
    };
    // Deleting clip b (10s long, edited 10k-20k) should shift cap-c
    // from 22000→12000 because those 10 seconds are gone.
    const next = applyAction(plan, { type: 'delete_clip', params: { clipId: 'b' } });
    const capC = next.captions.find((c) => c.id === 'cap-c');
    expect(capC).toBeDefined();
    expect(capC!.startMs).toBe(12000);
    expect(capC!.endMs).toBe(13000);
    // cap-a unchanged (it was before the deleted range)
    const capA = next.captions.find((c) => c.id === 'cap-a');
    expect(capA!.startMs).toBe(1000);
  });

  it('trims (not drops) captions that straddle the deleted range boundary', () => {
    const plan: EditPlan = {
      ...makePlan(),
      captions: [
        // Starts in clip b (edited 10-20k), ends in clip c (edited 20-30k)
        { id: 'straddle', text: 'x', startMs: 19000, endMs: 21000 },
      ],
    };
    const next = applyAction(plan, { type: 'delete_clip', params: { clipId: 'b' } });
    // The part inside the deleted window collapses; the surviving tail
    // stays on the timeline, re-anchored at the cut.
    expect(next.captions).toHaveLength(1);
    expect(next.captions[0].startMs).toBe(10000);
    expect(next.captions[0].endMs).toBe(11000);
  });

  it('keeps a caption whose padded TAIL hangs into the deleted clip, trimmed at the cut', () => {
    // The "cut where I stop talking" case: caption speech ends at 9.4s but
    // its gap-filled tail runs to 11s, into deleted clip b (10-20k).
    const plan: EditPlan = {
      ...makePlan(),
      captions: [
        {
          id: 'tail', text: 'strong hips win', startMs: 8000, endMs: 11000,
          words: [
            { text: 'strong', startMs: 8000, endMs: 8400 },
            { text: 'hips', startMs: 8500, endMs: 8900 },
            { text: 'win', startMs: 9000, endMs: 9400 },
          ],
        },
      ],
    };
    const next = applyAction(plan, { type: 'delete_clip', params: { clipId: 'b' } });
    expect(next.captions).toHaveLength(1);
    const cap = next.captions[0];
    expect(cap.text).toBe('strong hips win'); // no spoken words were cut
    expect(cap.startMs).toBe(8000);
    expect(cap.endMs).toBe(10000); // tail clamped to the cut
    expect(cap.words).toHaveLength(3);
  });

  it('shrinks text to the surviving words when the cut removes spoken words', () => {
    const plan: EditPlan = {
      ...makePlan(),
      captions: [
        {
          id: 'partial', text: 'load the tissue daily', startMs: 9000, endMs: 12000,
          words: [
            { text: 'load', startMs: 9000, endMs: 9300 },
            { text: 'the', startMs: 9350, endMs: 9500 },
            { text: 'tissue', startMs: 10200, endMs: 10600 }, // inside deleted b
            { text: 'daily', startMs: 10700, endMs: 11100 },  // inside deleted b
          ],
        },
      ],
    };
    const next = applyAction(plan, { type: 'delete_clip', params: { clipId: 'b' } });
    expect(next.captions).toHaveLength(1);
    expect(next.captions[0].text).toBe('load the');
    expect(next.captions[0].endMs).toBe(10000);
  });

  it('drops a straddling caption when ALL its spoken words were in the deleted clip', () => {
    const plan: EditPlan = {
      ...makePlan(),
      captions: [
        {
          // Lead-in starts before the cut, but every word is inside clip b.
          id: 'onlypad', text: 'gone', startMs: 9900, endMs: 12000,
          words: [{ text: 'gone', startMs: 10100, endMs: 10500 }],
        },
      ],
    };
    const next = applyAction(plan, { type: 'delete_clip', params: { clipId: 'b' } });
    expect(next.captions).toHaveLength(0);
  });

  it('deleting the first clip shifts everything left', () => {
    const plan: EditPlan = {
      ...makePlan(),
      captions: [
        { id: 'cap-b', text: 'B', startMs: 12000, endMs: 13000 },
        { id: 'cap-c', text: 'C', startMs: 22000, endMs: 23000 },
      ],
    };
    const next = applyAction(plan, { type: 'delete_clip', params: { clipId: 'a' } });
    expect(next.captions.find((c) => c.id === 'cap-b')!.startMs).toBe(2000);
    expect(next.captions.find((c) => c.id === 'cap-c')!.startMs).toBe(12000);
  });
});

describe('caption style', () => {
  it('createPlan seeds the default caption style', () => {
    const p = createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 10 });
    expect(p.captionStyle).toEqual(DEFAULT_CAPTION_STYLE);
  });

  it('set_caption_style merges a partial patch onto the global style', () => {
    const p = createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 10 });
    const next = applyAction(p, {
      type: 'set_caption_style',
      params: { color: '#FFFFFF', fontFamily: 'montserrat' },
    });
    expect(next.captionStyle?.color).toBe('#FFFFFF');
    expect(next.captionStyle?.fontFamily).toBe('montserrat');
    // Untouched fields retain their defaults
    expect(next.captionStyle?.position).toBe(DEFAULT_CAPTION_STYLE.position);
  });

  it('set_caption_style_override applies per-caption partial style', () => {
    const p: EditPlan = {
      ...createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 10 }),
      captions: [{ id: 'c1', text: 'hello', startMs: 0, endMs: 1000 }],
    };
    const next = applyAction(p, {
      type: 'set_caption_style_override',
      params: { captionId: 'c1', style: { color: '#C9A84C' } },
    });
    expect(next.captions[0].style).toEqual({ color: '#C9A84C' });
  });

  it('set_caption_style_override with style=null clears the override', () => {
    const p: EditPlan = {
      ...createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 10 }),
      captions: [{
        id: 'c1', text: 'hello', startMs: 0, endMs: 1000,
        style: { color: '#C9A84C', fontSizeMultiplier: 1.4 },
      }],
    };
    const next = applyAction(p, {
      type: 'set_caption_style_override',
      params: { captionId: 'c1', style: null },
    });
    expect(next.captions[0].style).toBeUndefined();
  });

  it('resolveCaptionStyle layers global → override correctly', () => {
    const resolved = resolveCaptionStyle(
      { ...DEFAULT_CAPTION_STYLE, color: '#FFFFFF' },
      { color: '#C9A84C', position: 'top' },
    );
    expect(resolved.color).toBe('#C9A84C'); // override wins
    expect(resolved.position).toBe('top');  // override wins
    expect(resolved.fontFamily).toBe(DEFAULT_CAPTION_STYLE.fontFamily);
  });

  it('animation field round-trips via set_caption_style', () => {
    const p = createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 10 });
    expect(p.captionStyle?.animation).toBe('instant');
    const next = applyAction(p, {
      type: 'set_caption_style',
      params: { animation: 'pop' },
    });
    expect(next.captionStyle?.animation).toBe('pop');
  });

  it('animation field round-trips via set_caption_style_override', () => {
    const p: EditPlan = {
      ...createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 10 }),
      captions: [{ id: 'c1', text: 'hello', startMs: 0, endMs: 1000 }],
    };
    const next = applyAction(p, {
      type: 'set_caption_style_override',
      params: { captionId: 'c1', style: { animation: 'fade' } },
    });
    expect(next.captions[0].style?.animation).toBe('fade');
  });
});

describe('customSpellings', () => {
  it('createPlan seeds default spelling corrections', () => {
    const p = createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 10 });
    expect(p.customSpellings).toBeDefined();
    expect(p.customSpellings).toEqual(DEFAULT_SPELLING_CORRECTIONS);
    // Sanity: the Coach Kav correction is present
    expect(p.customSpellings?.some((s) => s.from === 'coach cav' && s.to === 'Coach Kav')).toBe(true);
  });

  it('set_custom_spellings replaces the list wholesale', () => {
    const p = createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 10 });
    const next = applyAction(p, {
      type: 'set_custom_spellings',
      params: { spellings: [{ from: 'foo', to: 'Bar' }] },
    });
    expect(next.customSpellings).toHaveLength(1);
    expect(next.customSpellings![0]).toEqual({ from: 'foo', to: 'Bar' });
  });

  it('set_custom_spellings drops empty rows and trims whitespace', () => {
    const p = createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 10 });
    const next = applyAction(p, {
      type: 'set_custom_spellings',
      params: {
        spellings: [
          { from: '  foo  ', to: '  Bar  ' },
          { from: '', to: 'X' },        // dropped
          { from: 'Y', to: '' },        // dropped
          { from: 'valid', to: 'Valid' },
        ],
      },
    });
    expect(next.customSpellings).toEqual([
      { from: 'foo', to: 'Bar' },
      { from: 'valid', to: 'Valid' },
    ]);
  });
});

describe('applyAction: merge_caption_with_next', () => {
  const basePlan: EditPlan = {
    ...createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 30 }),
    captions: [
      { id: 'c1', text: 'S',     startMs: 100,  endMs: 400  },
      { id: 'c2', text: 'OREN',  startMs: 450,  endMs: 900  },
      { id: 'c3', text: 'said',  startMs: 1100, endMs: 1600 },
    ],
  };

  it('joins text and extends the end time', () => {
    const next = applyAction(basePlan, {
      type: 'merge_caption_with_next',
      params: { captionId: 'c1' },
    });
    expect(next.captions).toHaveLength(2);
    expect(next.captions[0].text).toBe('S OREN');
    expect(next.captions[0].startMs).toBe(100);
    expect(next.captions[0].endMs).toBe(900);
    // c3 survives unchanged
    expect(next.captions[1].id).toBe('c3');
  });

  it('is a no-op on the last caption', () => {
    const next = applyAction(basePlan, {
      type: 'merge_caption_with_next',
      params: { captionId: 'c3' },
    });
    expect(next.captions).toHaveLength(3);
    expect(next.captions[2].text).toBe('said');
  });

  it('is a no-op when captionId is not found', () => {
    const next = applyAction(basePlan, {
      type: 'merge_caption_with_next',
      params: { captionId: 'does-not-exist' },
    });
    expect(next.captions).toHaveLength(3);
  });
});
