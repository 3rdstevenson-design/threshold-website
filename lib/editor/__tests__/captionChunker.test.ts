import { describe, it, expect } from 'vitest';
import { chunkCaptions, mergeFragments, sourceSecToEditedMs, joinCaptionText, applySpellingCorrections } from '../captionChunker';
import type { Clip } from '../editPlan';

describe('sourceSecToEditedMs', () => {
  it('identity mapping when one clip covers full duration', () => {
    const clips: Clip[] = [{ id: 'a', sourceStart: 0, sourceEnd: 10 }];
    expect(sourceSecToEditedMs(clips, 5)).toBe(5000);
  });

  it('accounts for cut regions', () => {
    // Keep [0,2] and [5,10] — a 3s gap at 2-5 is cut
    const clips: Clip[] = [
      { id: 'a', sourceStart: 0, sourceEnd: 2 },
      { id: 'b', sourceStart: 5, sourceEnd: 10 },
    ];
    expect(sourceSecToEditedMs(clips, 1)).toBe(1000);       // inside clip A
    expect(sourceSecToEditedMs(clips, 5.5)).toBe(2500);     // 2000 (clip A) + 500 ms in clip B
    expect(sourceSecToEditedMs(clips, 3)).toBeNull();        // inside the cut
  });
});

describe('chunkCaptions', () => {
  const fullClips: Clip[] = [{ id: 'a', sourceStart: 0, sourceEnd: 100 }];

  it('caps chunks at maxWords', () => {
    const words = Array.from({ length: 10 }, (_, i) => ({
      start: i * 0.3,
      end: i * 0.3 + 0.25,
      text: `word${i}`,
    }));
    // Disable maxChars for this test so word count is the binding limit.
    const caps = chunkCaptions(words, fullClips, { maxWords: 4, maxChars: 999, leadInMs: 0, gapFillMs: 0 });
    for (const c of caps) {
      expect(c.text.split(' ').length).toBeLessThanOrEqual(4);
    }
    expect(caps.length).toBe(3);
  });

  it('default maxWords is 3 (tight to speech)', () => {
    const words = Array.from({ length: 9 }, (_, i) => ({
      start: i * 0.3,
      end: i * 0.3 + 0.25,
      text: `w${i}`,
    }));
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    expect(caps.length).toBe(3); // 9 words / 3 = 3 chunks
    for (const c of caps) {
      expect(c.text.split(' ').length).toBeLessThanOrEqual(3);
    }
  });

  it('breaks on long pauses', () => {
    const words = [
      { start: 0, end: 0.3, text: 'hi' },
      { start: 0.4, end: 0.7, text: 'there' },
      { start: 2.0, end: 2.3, text: 'welcome' }, // >= 250ms gap
      { start: 2.4, end: 2.8, text: 'back' },
    ];
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    expect(caps.length).toBe(2);
    expect(caps[0].text).toBe('hi there');
    expect(caps[1].text).toBe('welcome back');
  });

  it('skips words that fall inside cuts', () => {
    const clips: Clip[] = [
      { id: 'a', sourceStart: 0, sourceEnd: 1 },
      { id: 'b', sourceStart: 3, sourceEnd: 5 },
    ];
    const words = [
      { start: 0.1, end: 0.3, text: 'keep' },
      { start: 2.0, end: 2.2, text: 'drop' },   // in the cut
      { start: 3.1, end: 3.3, text: 'keep2' },
    ];
    const caps = chunkCaptions(words, clips);
    const allText = caps.map((c) => c.text).join(' ');
    // "drop" was inside a cut region, so it must be absent
    expect(allText).not.toContain('drop');
    expect(allText).toContain('keep');
    expect(allText).toContain('keep2');
  });

  it('remaps caption timing onto the edited timeline', () => {
    // Cut out [1,3]; word at 3.5s should map to 1500ms on the edited timeline
    const clips: Clip[] = [
      { id: 'a', sourceStart: 0, sourceEnd: 1 },
      { id: 'b', sourceStart: 3, sourceEnd: 5 },
    ];
    const words = [{ start: 3.5, end: 3.8, text: 'hello' }];
    const caps = chunkCaptions(words, clips, { leadInMs: 0, gapFillMs: 0 });
    expect(caps[0].startMs).toBe(1500);
    expect(caps[0].endMs).toBe(1800);
  });

  it('applies lead-in and gap-fill for smoother display', () => {
    const words = [
      { start: 1.0, end: 1.2, text: 'hello' },
      { start: 1.3, end: 1.5, text: 'world' },
      { start: 1.8, end: 2.0, text: 'again' }, // 300ms gap → new chunk
      { start: 2.1, end: 2.3, text: 'yes' },
    ];
    const caps = chunkCaptions(words, fullClips, { maxWords: 2, leadInMs: 80, gapFillMs: 800 });
    expect(caps).toHaveLength(2);
    // Lead-in shifts start 80ms earlier
    expect(caps[0].startMs).toBe(920);
    expect(caps[1].startMs).toBe(1720);
    // Gap-fill extends first caption's endMs to second's startMs
    expect(caps[0].endMs).toBe(1720);
  });

  it('breaks on sentence-ending punctuation', () => {
    const words = [
      { start: 0, end: 0.3, text: 'hello' },
      { start: 0.4, end: 0.7, text: 'world.' },
      { start: 0.8, end: 1.1, text: 'next' },
      { start: 1.2, end: 1.5, text: 'chunk' },
    ];
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    expect(caps.length).toBe(2);
    expect(caps[0].text).toBe('hello world.');
    expect(caps[1].text).toBe('next chunk');
  });

  it('merges apostrophe contractions back onto previous word', () => {
    const words = [
      { start: 0.0, end: 0.2, text: 'can' },
      { start: 0.2, end: 0.3, text: "'t" },
      { start: 0.4, end: 0.6, text: 'wait' },
    ];
    const caps = chunkCaptions(words, fullClips);
    expect(caps[0].text).toBe("can't wait");
  });

  it("handles n't, 're, 've, 'll, 's contractions", () => {
    const words = [
      { start: 0, end: 0.1, text: 'I' },
      { start: 0.1, end: 0.2, text: "'ll" },
      { start: 0.3, end: 0.4, text: 'see' },
      { start: 0.5, end: 0.6, text: 'you' },
      { start: 0.7, end: 0.8, text: "'re" },
      { start: 0.9, end: 1.0, text: 'right' },
    ];
    const caps = chunkCaptions(words, fullClips);
    const text = caps.map((c) => c.text).join(' ');
    expect(text).toContain("I'll");
    expect(text).toContain("you're");
  });

  it('attaches standalone comma to previous word (no space before)', () => {
    const words = [
      { start: 0, end: 0.1, text: 'hello' },
      { start: 0.1, end: 0.15, text: ',' },
      { start: 0.2, end: 0.3, text: 'world' },
    ];
    const caps = chunkCaptions(words, fullClips);
    expect(caps[0].text).toBe('hello, world');
  });

  it('never starts a caption with punctuation', () => {
    const words = [
      { start: 0, end: 0.05, text: '.' },
      { start: 0.1, end: 0.3, text: 'hello' },
      { start: 0.4, end: 0.6, text: 'world' },
    ];
    const caps = chunkCaptions(words, fullClips);
    expect(caps[0].text.startsWith('.')).toBe(false);
    expect(caps[0].text).toBe('hello world');
  });
});

describe('mergeFragments', () => {
  it('merges adjacent short tokens with tight gaps (< 10ms)', () => {
    // "S" + "oren" with 2ms gap — realistic whisper sub-token split.
    const r = mergeFragments([
      { start: 0.10, end: 0.20, text: 'S' },
      { start: 0.202, end: 0.50, text: 'oren' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe('Soren');
    expect(r[0].start).toBe(0.10);
    expect(r[0].end).toBe(0.50);
  });

  it('merges a short (≤3-char) capitalized proper-noun fragment ("Soc" + "rates")', () => {
    // Path B only fires for a tiny capitalized fragment, not a full
    // capitalized sentence-start word (which would glue real words).
    const r = mergeFragments([
      { start: 1.00, end: 1.15, text: 'Soc' },
      { start: 1.151, end: 1.50, text: 'rates' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe('Socrates');
  });

  it('does NOT glue a capitalized sentence-start word ("Nothing" + "beats")', () => {
    const r = mergeFragments([
      { start: 1.00, end: 1.30, text: 'Nothing' },
      { start: 1.300, end: 1.70, text: 'beats' }, // gap≈0, but "Nothing" is 7 chars
    ]);
    expect(r).toHaveLength(2);
  });

  it('does NOT merge when gap is too wide', () => {
    const r = mergeFragments([
      { start: 0, end: 0.2, text: 'S' },
      { start: 0.5, end: 0.8, text: 'oren' }, // 300ms gap
    ]);
    expect(r).toHaveLength(2);
  });

  it('does NOT merge two long words (fast speech, not fragments)', () => {
    const r = mergeFragments([
      { start: 0, end: 0.3, text: 'running' },
      { start: 0.32, end: 0.6, text: 'quickly' },
    ]);
    expect(r).toHaveLength(2);
  });

  it('does NOT merge contraction fragments (preserves their own pass)', () => {
    const r = mergeFragments([
      { start: 0, end: 0.2, text: 'can' },
      { start: 0.22, end: 0.3, text: "'t" },
    ]);
    // "'t" should NOT be merged in this pass (handled by contraction logic)
    expect(r).toHaveLength(2);
  });

  it('does NOT merge across sentence boundaries', () => {
    const r = mergeFragments([
      { start: 0, end: 0.2, text: 'end.' },
      { start: 0.22, end: 0.3, text: 'St' },
    ]);
    expect(r).toHaveLength(2);
  });
});

describe('mergeFragments — suffix path no longer over-merges real words', () => {
  // Regression: Path A (suffix match) used to merge gap-agnostically with no
  // common-word check, so any word followed by a token that happened to equal
  // a real standalone word that is ALSO a suffix ("ship", "able", "age",
  // "less", "ward", "wise", "hood", "ant") got glued with no space:
  // "the ship" → "theship". Lars saw these missing-space glue-ups regularly
  // and had to add the space by hand. Path A now requires the same tight-gap
  // + non-common guards as the other merge paths.
  const tight = (a: string, b: string) => mergeFragments([
    { start: 0, end: 0.30, text: a },
    { start: 0.302, end: 0.60, text: b }, // ~2ms gap (tight)
  ]);

  it('does NOT glue a common word onto a suffix-word ("the"+"ship")', () => {
    expect(tight('the', 'ship').map((w) => w.text)).toEqual(['the', 'ship']);
  });

  it('does NOT glue "be"+"able", "old"+"age", or "do"+"less"', () => {
    for (const [a, b] of [['be', 'able'], ['old', 'age'], ['do', 'less']] as const) {
      expect(tight(a, b).map((w) => w.text)).toEqual([a, b]);
    }
  });

  it('does NOT glue a suffix-word at a WIDE gap ("rocket"+"ship" 50ms)', () => {
    const r = mergeFragments([
      { start: 0, end: 0.30, text: 'rocket' },
      { start: 0.35, end: 0.60, text: 'ship' }, // 50ms gap — clearly two words
    ]);
    expect(r).toHaveLength(2);
  });

  it('STILL merges genuine sub-token splits ("compl"+"icated", "nihil"+"ism")', () => {
    // Both tokens >4 chars so only the suffix path can catch "complicated".
    expect(tight('compl', 'icated').map((w) => w.text)).toEqual(['complicated']);
    expect(tight('nihil', 'ism').map((w) => w.text)).toEqual(['nihilism']);
  });

  it('STILL merges a real bound-morpheme suffix ("teach"+"er")', () => {
    // "er" is a true morpheme (never a standalone word), so it still joins.
    expect(tight('teach', 'er').map((w) => w.text)).toEqual(['teacher']);
  });
});

describe('chunkCaptions — maxChars', () => {
  const fullClips: Clip[] = [{ id: 'a', sourceStart: 0, sourceEnd: 100 }];

  it('breaks chunks at character limit, never mid-word', () => {
    // Three short words + one long word that would push over 10 chars.
    const words = [
      { start: 0.0, end: 0.2, text: 'the' },
      { start: 0.3, end: 0.5, text: 'cat' },
      { start: 0.6, end: 1.2, text: 'jumped' },
    ];
    const caps = chunkCaptions(words, fullClips, {
      maxWords: 5,    // so word count isn't the limiting factor
      maxChars: 10,
      leadInMs: 0,
      gapFillMs: 0,
    });
    // "the cat" = 7 chars ≤ 10, but "the cat jumped" = 14 > 10 → break
    // Expected: ["the cat", "jumped"]
    expect(caps).toHaveLength(2);
    expect(caps[0].text).toBe('the cat');
    expect(caps[1].text).toBe('jumped');
  });

  it('emits a single too-long word as its own chunk', () => {
    const words = [
      { start: 0.0, end: 0.5, text: 'KIERKEGAARD' }, // 11 chars, > maxChars=10
    ];
    const caps = chunkCaptions(words, fullClips, {
      maxChars: 10,
      leadInMs: 0,
      gapFillMs: 0,
    });
    expect(caps).toHaveLength(1);
    expect(caps[0].text).toBe('KIERKEGAARD');
  });

  it('does NOT auto-merge fragments by default (no false positives on fast speech)', () => {
    // Realistic fluent speech: short adjacent words with ~20ms gaps.
    const words = [
      { start: 0.0,  end: 0.20, text: 'so' },
      { start: 0.22, end: 0.40, text: 'for' },
      { start: 0.42, end: 0.55, text: 'me' },
    ];
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    // These MUST stay as separate tokens; must NOT produce "SOFORME"
    const allText = caps.map((c) => c.text).join(' ');
    expect(allText).not.toContain('soforme');
    expect(allText).not.toContain('SOFORME');
    expect(allText.toLowerCase()).toContain('so');
    expect(allText.toLowerCase()).toContain('for');
    expect(allText.toLowerCase()).toContain('me');
  });

  it('merges whisper fragments when autoMergeFragments is enabled', () => {
    // Opt-in test of the fragment merger working on a Kierkegaard case.
    const words = [
      { start: 0.0,  end: 0.10, text: 'S' },
      { start: 0.11, end: 0.40, text: 'oren' },
      { start: 0.5,  end: 0.8,  text: 'said' },
    ];
    const caps = chunkCaptions(words, fullClips, {
      autoMergeFragments: true,
      leadInMs: 0,
      gapFillMs: 0,
    });
    const text = caps.map((c) => c.text).join(' ');
    expect(text).toContain('Soren');
    expect(text.split(/\s+/)).not.toContain('S');
  });
});

describe('chunkCaptions — tight auto-merge (default 10ms)', () => {
  const fullClips: Clip[] = [{ id: 'a', sourceStart: 0, sourceEnd: 100 }];

  it('merges true whisper sub-token fragments (≈0ms gap)', () => {
    // Whisper's typical sub-token split: "nihil" + "ism" with 2ms gap.
    const words = [
      { start: 0.00, end: 0.80, text: 'nihil' },
      { start: 0.802, end: 1.20, text: 'ism' },
    ];
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    expect(caps).toHaveLength(1);
    expect(caps[0].text).toBe('nihilism');
  });

  it('merges "pred" + "icated" with 3ms gap', () => {
    const words = [
      { start: 0.00, end: 0.30, text: 'pred' },
      { start: 0.303, end: 0.80, text: 'icated' },
    ];
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    expect(caps[0].text).toBe('predicated');
  });

  it('does NOT merge real words at 20ms gap (above 10ms threshold)', () => {
    const words = [
      { start: 0.00, end: 0.20, text: 'so' },
      { start: 0.22, end: 0.40, text: 'for' },
      { start: 0.42, end: 0.55, text: 'me' },
    ];
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    const text = caps.map((c) => c.text).join(' ').toLowerCase();
    expect(text).not.toContain('soforme');
    expect(text).not.toContain('sofor');
    expect(text.split(/\s+/)).toContain('so');
    expect(text.split(/\s+/)).toContain('for');
    expect(text.split(/\s+/)).toContain('me');
  });

  it('does NOT merge at the exact 10ms boundary', () => {
    const words = [
      { start: 0.00, end: 0.50, text: 'fast' },
      { start: 0.510, end: 1.00, text: 'talk' }, // 10ms gap exactly
    ];
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    expect(caps[0].text).toBe('fast talk');
  });

  // ── Regression tests for over-merging at tight gaps ──────────────
  it('does NOT merge "choice" + "isn\'t" (apostrophe blocks merge)', () => {
    // Even if whisper reports a 2ms gap, "isn't" has an apostrophe
    // and must NEVER be glued onto the previous word.
    const words = [
      { start: 0.00, end: 0.40, text: 'choice' },
      { start: 0.402, end: 0.70, text: "isn't" },
      { start: 0.72, end: 0.95, text: 'that' },
    ];
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    const allText = caps.map((c) => c.text).join(' ').toLowerCase();
    expect(allText).not.toContain('choiceisn');
    expect(allText).toContain('choice');
    expect(allText).toContain("isn't");
  });

  it('does NOT merge "choice" + "is" (common-word block)', () => {
    // "is" is a real standalone word — never glue onto the prior word.
    const words = [
      { start: 0.00, end: 0.40, text: 'choice' },
      { start: 0.401, end: 0.55, text: 'is' }, // 1ms gap — very tight
      { start: 0.58, end: 0.90, text: 'that' },
    ];
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    const allText = caps.map((c) => c.text).join(' ').toLowerCase();
    expect(allText).not.toContain('choiceis');
    const tokens = allText.split(/\s+/);
    expect(tokens).toContain('choice');
    expect(tokens).toContain('is');
  });

  it('does NOT merge "word" + "the" / "and" / "for" (common words)', () => {
    for (const nextWord of ['the', 'and', 'for', 'was', 'are', 'have']) {
      const words = [
        { start: 0.00, end: 0.30, text: 'here' },
        { start: 0.301, end: 0.50, text: nextWord },
      ];
      const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
      const allText = caps.map((c) => c.text).join(' ').toLowerCase();
      expect(allText).not.toContain(`here${nextWord}`);
      expect(allText.split(/\s+/)).toContain('here');
      expect(allText.split(/\s+/)).toContain(nextWord);
    }
  });

  it('does NOT merge when second token starts uppercase (new word signal)', () => {
    // "had" + "Bob" — Bob is a new proper noun, never a fragment.
    const words = [
      { start: 0.00, end: 0.30, text: 'had' },
      { start: 0.301, end: 0.50, text: 'Bob' },
    ];
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    const allText = caps.map((c) => c.text).join(' ');
    expect(allText).not.toContain('hadBob');
    expect(allText).toContain('Bob');
  });

  it('does NOT merge when either token has punctuation attached', () => {
    const words = [
      { start: 0.00, end: 0.30, text: 'end.' },   // trailing period
      { start: 0.301, end: 0.50, text: 'new' },
    ];
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    expect(caps.map((c) => c.text).join(' ')).not.toContain('end.new');
  });

  // ── Symmetric common-word regression tests (iteration 5) ────────
  // Observed in live plan.captions: "thatnothing", "hasinherent",
  // "mebecause". Prior rule only blocked merges when the SECOND token
  // was a common word; these slipped through because the common word
  // was on the LEFT. Symmetric check now blocks both sides.

  it('does NOT merge "that" + "nothing" (prev token is common)', () => {
    const words = [
      { start: 0.00, end: 0.30, text: 'that' },
      { start: 0.302, end: 0.70, text: 'nothing' }, // 2ms gap
    ];
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    const allText = caps.map((c) => c.text).join(' ').toLowerCase();
    expect(allText).not.toContain('thatnothing');
    expect(allText.split(/\s+/)).toContain('that');
    expect(allText.split(/\s+/)).toContain('nothing');
  });

  it('does NOT merge "me" + "because" (prev token is common)', () => {
    const words = [
      { start: 0.00, end: 0.20, text: 'me' },
      { start: 0.202, end: 0.70, text: 'because' },
    ];
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    const allText = caps.map((c) => c.text).join(' ').toLowerCase();
    expect(allText).not.toContain('mebecause');
    expect(allText.split(/\s+/)).toContain('me');
    expect(allText.split(/\s+/)).toContain('because');
  });

  it('does NOT merge "has" + "inherent" (prev token is common)', () => {
    const words = [
      { start: 0.00, end: 0.30, text: 'has' },
      { start: 0.302, end: 0.80, text: 'inherent' },
    ];
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    const allText = caps.map((c) => c.text).join(' ').toLowerCase();
    expect(allText).not.toContain('hasinherent');
    expect(allText.split(/\s+/)).toContain('has');
    expect(allText.split(/\s+/)).toContain('inherent');
  });

  it('symmetric check works even when only prev is common', () => {
    // Real sentence fragment: "where nothing resolves". All three pairs
    // have a common word on ONE side — all must stay split.
    const words = [
      { start: 0.0, end: 0.3, text: 'where' },   // prev common
      { start: 0.303, end: 0.8, text: 'nothing' },
      { start: 0.803, end: 1.3, text: 'resolves' },
    ];
    const caps = chunkCaptions(words, fullClips, { leadInMs: 0, gapFillMs: 0 });
    const allText = caps.map((c) => c.text).join(' ').toLowerCase();
    expect(allText).not.toContain('wherenothing');
    expect(allText).not.toContain('nothingresolves');
  });
});

describe('mergeFragments — short-fragment path requires a ≤2-char token', () => {
  it('does NOT merge two ordinary words even with empty common-words (length guard blocks it)', () => {
    // Whisper reports gap=0 even between ordinary adjacent words, so the
    // short-fragment path can't rely on the gap — it now requires a ≤2-char
    // token. "that"/"nothing" are both longer, so they stay split even with
    // no common-word guard. (This is what stops "step"+"process" gluing.)
    const r = mergeFragments(
      [
        { start: 0.0, end: 0.30, text: 'that' },
        { start: 0.300, end: 0.70, text: 'nothing' },
      ],
      0.010,
      new Set<string>(), // empty common-words set
    );
    expect(r).toHaveLength(2);
  });

  it('still merges a genuine ≤2-char fragment ("re"+"design")', () => {
    const r = mergeFragments([
      { start: 0.0, end: 0.20, text: 're' },
      { start: 0.200, end: 0.60, text: 'design' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe('redesign');
  });
});

describe('applySpellingCorrections', () => {
  it('applies a single word-boundary correction', () => {
    expect(applySpellingCorrections(
      'I met Coach Cav yesterday',
      [{ from: 'coach cav', to: 'Coach Kav' }],
    )).toBe('I met Coach Kav yesterday');
  });

  it('is case-insensitive on the match side', () => {
    expect(applySpellingCorrections(
      'COACH CAV',
      [{ from: 'coach cav', to: 'Coach Kav' }],
    )).toBe('Coach Kav');
  });

  it('preserves diacritics in the replacement', () => {
    expect(applySpellingCorrections(
      'Soren said',
      [{ from: 'soren', to: 'Søren' }],
    )).toBe('Søren said');
  });

  it('respects word boundaries (no partial matches)', () => {
    // "cavalry" should NOT be replaced by "cav" rule
    expect(applySpellingCorrections(
      'The cavalry arrived',
      [{ from: 'cav', to: 'Kav' }],
    )).toBe('The cavalry arrived');
  });

  it('applies multiple corrections in order', () => {
    expect(applySpellingCorrections(
      'Soren quoted Coach Cav',
      [
        { from: 'coach cav', to: 'Coach Kav' },
        { from: 'soren', to: 'Søren' },
      ],
    )).toBe('Søren quoted Coach Kav');
  });

  it('ignores empty from/to entries', () => {
    expect(applySpellingCorrections(
      'hello world',
      [{ from: '', to: 'X' }, { from: 'hello', to: '' }, { from: 'world', to: 'Earth' }],
    )).toBe('hello Earth');
  });
});

describe('chunkCaptions — customSpellings integration', () => {
  const fullClips: Clip[] = [{ id: 'a', sourceStart: 0, sourceEnd: 100 }];

  it('applies corrections to generated captions', () => {
    const words = [
      { start: 0.0, end: 0.3, text: 'meet' },
      { start: 0.4, end: 0.7, text: 'coach' },
      { start: 0.8, end: 1.1, text: 'cav' },
    ];
    const caps = chunkCaptions(words, fullClips, {
      leadInMs: 0,
      gapFillMs: 0,
      customSpellings: [{ from: 'coach cav', to: 'Coach Kav' }],
    });
    const allText = caps.map((c) => c.text).join(' ');
    expect(allText).toContain('Coach Kav');
    expect(allText.toLowerCase()).not.toContain('coach cav');
  });

  it('has no effect when customSpellings is empty', () => {
    const words = [
      { start: 0.0, end: 0.3, text: 'coach' },
      { start: 0.4, end: 0.7, text: 'cav' },
    ];
    const caps = chunkCaptions(words, fullClips, {
      leadInMs: 0,
      gapFillMs: 0,
    });
    expect(caps[0].text).toBe('coach cav');
  });
});

describe('chunkCaptions — word atomicity invariant', () => {
  const fullClips: Clip[] = [{ id: 'a', sourceStart: 0, sourceEnd: 100 }];

  /**
   * Validate that every token appearing in every caption matches one of
   * the original input tokens (after normalizing punctuation, which gets
   * re-attached). A failure indicates the chunker sliced a word mid-letter.
   */
  const assertAtomic = (inputs: string[], captions: { text: string }[]) => {
    // Build a pool of acceptable output tokens. A caption token may be:
    //   - an input word exactly
    //   - an input word with trailing punctuation ("world" → "world.")
    //   - a contraction rebuilt from two input tokens ("can" + "'t" → "can't")
    //   - a concatenation of a word + trailing punctuation ("hello" + "," → "hello,")
    const pool = new Set<string>();
    for (const w of inputs) pool.add(w);
    // Also allow contraction/punctuation rebuilds: walk pairs
    for (let i = 0; i < inputs.length - 1; i++) {
      pool.add(inputs[i] + inputs[i + 1]);
    }
    // Allow triplet merges for "can" + "'t" + "."
    for (let i = 0; i < inputs.length - 2; i++) {
      pool.add(inputs[i] + inputs[i + 1] + inputs[i + 2]);
    }
    for (const cap of captions) {
      const outTokens = cap.text.split(/\s+/);
      for (const t of outTokens) {
        // Every output token must appear in the pool as a substring of an
        // input, OR be a punctuation-suffixed input. We check exact pool
        // membership first, then fall back to "starts with an input word".
        const exact = pool.has(t);
        const prefixMatch = !exact && Array.from(pool).some(
          (p) => t === p || t.startsWith(p) || p.startsWith(t),
        );
        if (!exact && !prefixMatch) {
          throw new Error(
            `Atomicity violation: output token "${t}" is not a whole input word. Input pool: [${Array.from(pool).slice(0, 20).join(', ')}…]`,
          );
        }
      }
    }
  };

  it('never splits a word mid-letter under tight maxChars', () => {
    const inputs = ['abolition', 'extraordinary', 'yes'];
    const words = inputs.map((text, i) => ({
      start: i * 0.5,
      end: i * 0.5 + 0.4,
      text,
    }));
    // Force a tight char limit that's SMALLER than individual words.
    const caps = chunkCaptions(words, fullClips, {
      maxChars: 5,  // smaller than "abolition" (9) or "extraordinary" (13)
      leadInMs: 0,
      gapFillMs: 0,
    });
    // Every word should emit whole in its own chunk — never split.
    expect(caps.map((c) => c.text)).toEqual(['abolition', 'extraordinary', 'yes']);
    assertAtomic(inputs, caps);
  });

  it('never emits partial words even when maxWords=1 and maxChars=3', () => {
    const inputs = ['hello', 'my', 'friend'];
    const words = inputs.map((text, i) => ({
      start: i * 0.5,
      end: i * 0.5 + 0.3,
      text,
    }));
    const caps = chunkCaptions(words, fullClips, {
      maxWords: 1,
      maxChars: 3,
      leadInMs: 0,
      gapFillMs: 0,
    });
    expect(caps).toHaveLength(3);
    expect(caps[0].text).toBe('hello');
    expect(caps[1].text).toBe('my');
    expect(caps[2].text).toBe('friend');
    assertAtomic(inputs, caps);
  });

  it('preserves atomicity across pause breaks and sentence ends', () => {
    const inputs = ['the', 'cat.', 'jumped', 'over', 'the', 'moon.'];
    const words = inputs.map((text, i) => ({
      start: i * 0.4,
      end: i * 0.4 + 0.3,
      text,
    }));
    const caps = chunkCaptions(words, fullClips, {
      maxChars: 12,
      leadInMs: 0,
      gapFillMs: 0,
    });
    assertAtomic(inputs, caps);
    // Every output token should be a whole input word (with punctuation ok).
    const outputText = caps.map((c) => c.text).join(' ');
    for (const word of ['the', 'cat', 'jumped', 'over', 'moon']) {
      expect(outputText.toLowerCase()).toContain(word);
    }
  });
});

describe('joinCaptionText', () => {
  it('single space between words', () => {
    expect(joinCaptionText(['hello', 'world'])).toBe('hello world');
  });
  it('no space before comma', () => {
    expect(joinCaptionText(['hello', ',', 'world'])).toBe('hello, world');
  });
  it('no space before period', () => {
    expect(joinCaptionText(['bye', '.'])).toBe('bye.');
  });
  it('collapses extra whitespace inside tokens', () => {
    expect(joinCaptionText(['hi  ', '  there'])).toBe('hi there');
  });
  it('strips leading punctuation', () => {
    expect(joinCaptionText(['.', 'hello'])).toBe('hello');
  });
});
