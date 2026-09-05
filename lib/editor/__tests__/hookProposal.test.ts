import { describe, it, expect } from 'vitest';
import { rankCandidates, applyHookToPlan, openingTranscript, HOOK_FADE_AFTER_SECONDS, type HookProposal } from '../hookProposal';
import { createPlan, applyAction } from '../editPlan';

const raw = (text: string, type: string, h: number, p: number, s: number) => ({ text, type, hookStrength: h, payoffClarity: p, shareability: s, rationale: 'r' });

describe('rankCandidates', () => {
  it('scores 2*hook + payoff + share, picks the best lint-passing candidate', () => {
    const r = rankCandidates([
      raw('Ice slows your recovery after every session.', 'contrarian', 3, 2, 3),
      raw('Rest is not the answer, load is.', 'contrarian', 3, 3, 3), // "Not X, Y" style, still lint-clean here
      raw('Let us talk about icing today', 'statement', 1, 1, 0),
    ]);
    expect(r.candidates.map((c) => c.score)).toEqual([11, 12, 3]);
    expect(r.chosenId).toBe('hook_2');
    expect(r.flags).toEqual([]);
  });

  it('drops candidates that fail Voice DNA lint (em dash) or run long, and flags when none pass', () => {
    const r = rankCandidates([
      raw('Ice after training — it slows you down', 'contrarian', 3, 3, 3),
      raw('this is a very long candidate that runs well past the nine word limit', 'statement', 1, 1, 1),
    ]);
    // em dash is auto-fixable → the fixed text passes; the long one fails.
    expect(r.candidates[0].lint.autoFixed).toBe(true);
    expect(r.candidates[0].text).not.toContain('—');
    expect(r.candidates[1].lint.pass).toBe(false);
    expect(r.candidates[1].lint.violations).toContain('over 9 words');
    expect(r.chosenId).toBe('hook_1');

    const none = rankCandidates([raw('one two three four five six seven eight nine ten', 'statement', 3, 3, 3)]);
    expect(none.chosenId).toBeNull();
    expect(none.flags).toEqual(['hook-lint']);
  });

  it('flags hook-low-score when the winner is weak', () => {
    const r = rankCandidates([raw('Today we cover icing.', 'statement', 1, 2, 1)]);
    expect(r.chosenId).toBe('hook_1');
    expect(r.flags).toEqual(['hook-low-score']);
  });
});

describe('applyHookToPlan', () => {
  const proposal = (): HookProposal => ({
    generatedAt: 'now', model: 'm', sourceWords: 50, applied: false, flags: [],
    candidates: [{ id: 'hook_1', text: 'Ice slows recovery.', type: 'contrarian', rubric: { hookStrength: 3, payoffClarity: 2, shareability: 3 }, score: 11, rationale: '', lint: { pass: true, autoFixed: false, violations: [] } }],
    chosenId: 'hook_1',
  });

  it('applies a fade-after header and stamps auto provenance', () => {
    const plan = createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 30 });
    const r = applyHookToPlan(plan, proposal());
    expect(r.applied).toBe(true);
    expect(r.plan.header).toMatchObject({ text: 'Ice slows recovery.', durationMode: 'fadeAfter', fadeAfterSeconds: HOOK_FADE_AFTER_SECONDS, position: 'top' });
    expect(r.plan.hook?.source).toBe('auto');
    expect(r.plan.hook?.proposalId).toBe('hook_1');
    // __source/__proposalId never leak into the stored header
    expect(Object.keys(r.plan.header ?? {})).not.toContain('__source');
  });

  it('never overwrites a user-authored header, but does replace an earlier auto one', () => {
    let plan = createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 30 });
    plan = applyAction(plan, { type: 'set_header', params: { text: 'My own line', position: 'bottom', durationMode: 'full' } });
    expect(plan.hook?.source).toBe('user');
    const r = applyHookToPlan(plan, proposal());
    expect(r.applied).toBe(false);
    expect(r.plan.header?.text).toBe('My own line');

    let auto = applyHookToPlan(createPlan({ slug: 's', sourceVideo: 'v.mp4', sourceDuration: 30 }), proposal()).plan;
    const p2 = proposal(); p2.candidates[0].text = 'Load beats rest.';
    auto = applyHookToPlan(auto, p2).plan;
    expect(auto.header?.text).toBe('Load beats rest.');
  });
});

describe('openingTranscript', () => {
  it('returns kept words up to the opening budget and the rest separately', () => {
    const words = Array.from({ length: 200 }, (_, i) => ({ text: `w${i}`, start: i * 0.5, end: i * 0.5 + 0.4 }));
    const clips = [{ id: 'c', sourceStart: 0, sourceEnd: 100 }];
    const o = openingTranscript(words, clips);
    expect(o.count).toBe(200);
    expect(o.opening.split(' ').length).toBeGreaterThan(40);
    expect(o.opening.split(' ').length).toBeLessThan(200);
    expect(o.rest.length).toBeGreaterThan(0);
  });
});
