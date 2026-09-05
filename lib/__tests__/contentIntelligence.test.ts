/**
 * Tests for the analytics deep-dive additions: hook-hold math, corpus
 * extensions (hookHold/evergreen/pillarStats + prompt budget), content
 * brief guidance + markdown, Instagram id resolution, and the structured
 * retention-data body validator.
 */
import { describe, expect, it } from 'vitest';
import { buildCorpus, findDropCliffs, renderCorpusForPrompt } from '../performanceCorpus';
import { hookHold3s, pctAtSecond, HOOK_HOLD_FLAG_PCT } from '../retentionMath';
import { buildGuidance, renderBriefMarkdown, type ContentBrief } from '../contentBrief';
import { resolveMediaId, shortcodeToMediaId, extractShortcode } from '../instagramIds';
import { validateRetentionBody } from '../retentionIngest';
import type { PostPerformance, RetentionPoint } from '../analyticsStore';
import type { HistoryStore } from '../analyticsHistory';

const DAY = 24 * 3600_000;

function reel(partial: Partial<PostPerformance> & { mediaId: string }): PostPerformance {
  return {
    caption: '',
    mediaType: 'REELS',
    timestamp: '2026-01-01T00:00:00Z',
    syncedAt: '2026-01-02T00:00:00Z',
    views: 1000,
    likes: 50,
    shares: 10,
    saves: 10,
    comments: 5,
    engagementRate: 0.05,
    ...partial,
  };
}

/** Linear curve from startPct at 0s to endPct at durSec. */
function curve(startPct: number, endPct: number, durSec = 30): RetentionPoint[] {
  const out: RetentionPoint[] = [];
  for (let s = 0; s <= durSec; s += 1) {
    out.push({ sec: s, pctViewers: startPct + ((endPct - startPct) * s) / durSec });
  }
  return out;
}

describe('retentionMath', () => {
  it('interpolates pctAtSecond linearly', () => {
    const c = [
      { sec: 0, pctViewers: 100 },
      { sec: 10, pctViewers: 50 },
    ];
    expect(pctAtSecond(c, 5)).toBe(75);
    expect(pctAtSecond(c, 0)).toBe(100);
    expect(pctAtSecond(c, 20)).toBe(50); // clamped to last point
    expect(pctAtSecond([], 3)).toBeNull();
  });

  it('hookHold3s reads the 3-second mark', () => {
    expect(hookHold3s(curve(100, 40, 30))).toBeCloseTo(94, 0);
  });
});

describe('findDropCliffs minSample override', () => {
  it('detects a cliff on a single curve with minSample 1', () => {
    // Steep early cliff: 100% → 60% across 2-4s.
    const single: RetentionPoint[] = [
      { sec: 0, pctViewers: 100 },
      { sec: 2, pctViewers: 98 },
      { sec: 4, pctViewers: 60 },
      { sec: 30, pctViewers: 50 },
    ];
    expect(findDropCliffs([single])).toEqual([]); // corpus default needs 3 curves
    const cliffs = findDropCliffs([single], { minSample: 1 });
    expect(cliffs.length).toBeGreaterThan(0);
    expect(cliffs[0].secondRange[0]).toBeLessThanOrEqual(3);
  });
});

describe('corpus extensions', () => {
  const posts: PostPerformance[] = [
    reel({
      mediaId: 'a',
      queuePostId: 'q1',
      caption: 'Why do your knees ache?',
      completionRate: 0.6,
      retentionCurve: curve(100, 55),
      views: 5000,
    }),
    reel({
      mediaId: 'b',
      queuePostId: 'q2',
      caption: 'Most people squat wrong',
      completionRate: 0.4,
      retentionCurve: curve(80, 20),
      views: 900,
    }),
    reel({
      mediaId: 'c',
      queuePostId: 'q3',
      caption: '3 cues for a stronger serve',
      completionRate: 0.5,
      retentionCurve: curve(90, 40),
      views: 2000,
    }),
  ];

  it('computes hookHold with flagged count', () => {
    const c = buildCorpus(posts);
    expect(c.hookHold).toBeDefined();
    expect(c.hookHold!.best[0].pct).toBeGreaterThanOrEqual(c.hookHold!.worst[0].pct);
    // curve(80,20) holds 74% at 3s → flagged below 65? 80 - (60*3/30) = 74 — not flagged.
    // All three hold above 65 at 3s, so flaggedCount is 0 here.
    expect(c.hookHold!.flaggedCount).toBe(0);
  });

  it('flags a weak hook and populates evergreen + pillars from extras', () => {
    const weak = [
      ...posts,
      reel({
        mediaId: 'd',
        caption: 'A slow wind-up opener',
        completionRate: 0.2,
        retentionCurve: [
          { sec: 0, pctViewers: 100 },
          { sec: 3, pctViewers: 40 },
          { sec: 30, pctViewers: 10 },
        ],
        views: 100,
      }),
    ];
    const now = Date.now();
    const publishedAt = new Date(now - 45 * DAY).toISOString();
    const history: HistoryStore = {
      updatedAt: new Date(now).toISOString(),
      posts: {
        a: [
          { at: new Date(now - 44 * DAY).toISOString(), views: 0, likes: 0, shares: 0, saves: 0, comments: 0 },
          { at: new Date(now - 38 * DAY).toISOString(), views: 700, likes: 0, shares: 0, saves: 0, comments: 0 },
          { at: new Date(now - 6 * DAY).toISOString(), views: 4000, likes: 0, shares: 0, saves: 0, comments: 0 },
          { at: new Date(now - 1 * DAY).toISOString(), views: 4900, likes: 0, shares: 0, saves: 0, comments: 0 },
        ],
      },
    };
    const withTs = weak.map((p) => (p.mediaId === 'a' ? { ...p, timestamp: publishedAt } : p));
    const c = buildCorpus(withTs, [], {
      history,
      pillarByQueueId: new Map([
        ['q1', 'clinic_case'],
        ['q2', 'clinic_case'],
        ['q3', 'exercise'],
      ]),
    });
    expect(c.hookHold!.flaggedCount).toBe(1);
    expect(c.evergreen).toBeDefined();
    expect(c.evergreen!.count).toBe(1);
    // exercise pillar has n=1 → filtered; clinic_case n=2 survives.
    expect(c.pillarStats).toBeDefined();
    expect(c.pillarStats![0].pillar).toBe('clinic_case');
    const prompt = renderCorpusForPrompt(c)!;
    expect(prompt).toContain('Hook hold at 3s');
    expect(prompt).toContain('Evergreen');
    expect(prompt).toContain('Pillar performance');
  });

  it('keeps the rendered prompt inside the token budget on a maximal fixture', () => {
    const many: PostPerformance[] = [];
    for (let i = 0; i < 40; i++) {
      many.push(
        reel({
          mediaId: `m${i}`,
          queuePostId: `q${i % 4}`,
          caption: `Hook line number ${i} that is fairly long and wordy for testing purposes?`,
          completionRate: 0.3 + (i % 7) * 0.05,
          videoDurationMs: 20_000 + i * 1000,
          retentionCurve: curve(100 - (i % 5) * 5, 20 + (i % 9) * 3),
          retentionNotes: `Note ${i}: the pacing sagged in the middle section of this reel.`,
          retentionUploadedAt: new Date(Date.now() - i * DAY).toISOString(),
        }),
      );
    }
    const history: HistoryStore = { updatedAt: '', posts: {} };
    for (let i = 0; i < 40; i++) {
      history.posts[`m${i}`] = [
        { at: new Date(Date.now() - 40 * DAY).toISOString(), views: 100, likes: 0, shares: 0, saves: 0, comments: 0 },
        { at: new Date(Date.now() - 2 * DAY).toISOString(), views: 5000, likes: 0, shares: 0, saves: 0, comments: 0 },
      ];
    }
    const c = buildCorpus(many, [], {
      history,
      pillarByQueueId: new Map(Array.from({ length: 40 }, (_, i) => [`q${i % 4}`, 'clinic_case'])),
    });
    const prompt = renderCorpusForPrompt(c)!;
    // ~4 chars/token → 6000 chars ≈ 1500 tokens.
    expect(prompt.length).toBeLessThan(6000);
  });
});

describe('content brief guidance', () => {
  const baseBriefInput = {
    hookStyles: [
      { pattern: 'Question hook' as const, sampleSize: 5, avgCompletionRate: 0.6, deltaPp: 8 },
      { pattern: 'Statement hook' as const, sampleSize: 4, avgCompletionRate: 0.3, deltaPp: -6 },
    ],
    cliffs: [
      {
        secondRange: [1, 4] as [number, number],
        medianPctDrop: 15,
        sampleSize: 4,
        commonCauseHypothesis: 'opener payload too delayed',
        observedVisualContexts: ['talking head with no text overlay'],
      },
    ],
    hookHoldRanking: [
      { mediaId: 'a', hook: 'Why do your knees ache?', pct: 88, flagged: false },
      { mediaId: 'b', hook: 'A slow wind-up opener', pct: 40, flagged: true },
    ],
    skipRateByHookStyle: [
      { pattern: 'Question hook', sampleSize: 12, avgPct: 52, deltaPp: -8 },
      { pattern: 'Statement hook', sampleSize: 9, avgPct: 66, deltaPp: 6 },
    ],
    evergreen: [{ mediaId: 'a', hook: 'Why do your knees ache?', ageDays: 45, recentDailyRate: 12 }],
    pillars: [
      { pillar: 'clinic_case', sampleSize: 5, avgViews: 3000, avgEngagementRate: 0.06 },
      { pillar: 'exercise', sampleSize: 3, avgViews: 900, avgEngagementRate: 0.03 },
    ],
    lengthBuckets: [{ bucketSec: '15-30', sampleSize: 6, avgCompletionRate: 0.55 }],
  };

  it('fires the expected rules', () => {
    const g = buildGuidance(baseBriefInput);
    expect(g.doMore.join(' ')).toContain('question hook');
    expect(g.doMore.join(' ')).toContain('15-30');
    expect(g.doMore.join(' ')).toContain('clinic case');
    expect(g.avoid.join(' ')).toContain('statement hook');
    expect(g.avoid.join(' ')).toContain('1-4s');
    expect(g.avoid.join(' ')).toContain(`${HOOK_HOLD_FLAG_PCT}%`);
  });

  it('falls back gracefully with no data', () => {
    const g = buildGuidance({
      hookStyles: [], cliffs: [], hookHoldRanking: [], evergreen: [], pillars: [], lengthBuckets: [],
    });
    expect(g.doMore.length).toBe(1);
    expect(g.avoid.length).toBe(0);
  });

  it('turns skip rate by hook style into do-more and avoid rules', () => {
    const g = buildGuidance(baseBriefInput);
    // Best style skips 8pp below average -> a do-more rule naming it.
    expect(g.doMore.join(' ')).toContain('skipped 8 points less');
    expect(g.doMore.join(' ')).toContain('question hook');
    // Worst style skips 6pp above average -> an avoid rule naming it.
    expect(g.avoid.join(' ')).toContain('skipped 6 points more');
    expect(g.avoid.join(' ')).toContain('statement hook');
  });

  it('stays quiet on skip rate when the spread is inside the noise band', () => {
    const g = buildGuidance({
      ...baseBriefInput,
      skipRateByHookStyle: [
        { pattern: 'Question hook', sampleSize: 12, avgPct: 59, deltaPp: -1 },
        { pattern: 'Statement hook', sampleSize: 9, avgPct: 61, deltaPp: 1 },
      ],
    });
    expect(g.doMore.join(' ')).not.toContain('points less');
    expect(g.avoid.join(' ')).not.toContain('points more');
  });

  it('omits skip-rate guidance entirely when the field is absent', () => {
    const g = buildGuidance({ ...baseBriefInput, skipRateByHookStyle: undefined });
    expect(g.doMore.join(' ')).not.toContain('points less');
    expect(g.avoid.join(' ')).not.toContain('points more');
  });

  it('renders markdown with all populated sections, complete sentences, no emoji', () => {
    const brief: ContentBrief = {
      generatedAt: '2026-07-22T00:00:00Z',
      sampleSize: 10,
      sampleSizeWithRetention: 4,
      baseline: { avgCompletionRate: 0.45, avgViews: 1500, avgEngagementRate: 0.05 },
      working: {
        hookStyles: baseBriefInput.hookStyles,
        lengthBuckets: baseBriefInput.lengthBuckets,
        topPerformers: [
          { mediaId: 'a', caption: 'x', hook: 'Why do your knees ache?', hookStyle: 'Question hook', completionRate: 0.7, views: 5000 },
        ],
        bottomPerformers: [],
      },
      fallOff: { cliffs: baseBriefInput.cliffs },
      hookHoldRanking: baseBriefInput.hookHoldRanking,
      skipRateRanking: [
        { mediaId: 'a', hook: 'Why do your knees ache?', pct: 41.2, flagged: false },
        { mediaId: 'b', hook: 'A slow wind-up opener', pct: 78.4, flagged: true },
      ],
      skipRateByHookStyle: baseBriefInput.skipRateByHookStyle,
      evergreen: baseBriefInput.evergreen,
      pillars: baseBriefInput.pillars,
      guidance: buildGuidance(baseBriefInput),
    };
    const md = renderBriefMarkdown(brief);
    for (const heading of [
      '# Threshold Content Brief',
      '## Do more of this',
      '## Avoid',
      '## Hook styles',
      '## Where viewers leave',
      '## Hook hold at 3 seconds',
      '## Still earning views',
      '## Pillar performance',
      '## Top performers',
    ]) {
      expect(md).toContain(heading);
    }
    // Brand rule: no emoji anywhere in the brief (surrogate-pair range
    // catches all supplementary-plane emoji; BMP range catches dingbats).
    expect(/[\uD83C-\uDBFF]|[☀-➿]/.test(md)).toBe(false);
  });
});

describe('instagramIds', () => {
  it('passes through a numeric media id', () => {
    expect(resolveMediaId({ mediaId: '17900000000000000' })).toBe('17900000000000000');
  });

  it('decodes a shortcode and a reel URL to the same pk', () => {
    const fromCode = shortcodeToMediaId('C1AbC2dEfGh');
    expect(fromCode).toMatch(/^\d+$/);
    expect(resolveMediaId({ reelUrl: 'https://www.instagram.com/reel/C1AbC2dEfGh/' })).toBe(fromCode);
    expect(resolveMediaId({ mediaId: 'C1AbC2dEfGh' })).toBe(fromCode);
  });

  it('extracts shortcodes from p/ and reels/ URLs', () => {
    expect(extractShortcode('https://instagram.com/p/Xyz_-123/')).toBe('Xyz_-123');
    expect(extractShortcode('https://www.instagram.com/reels/AbCdEf/')).toBe('AbCdEf');
    expect(extractShortcode('https://example.com/nope')).toBeNull();
  });

  it('rejects garbage', () => {
    expect(resolveMediaId({})).toBeNull();
    expect(resolveMediaId({ mediaId: '!!' })).toBeNull();
  });
});

describe('validateRetentionBody', () => {
  it('accepts a valid body and sorts the curve', () => {
    const v = validateRetentionBody({
      source: 'ig-internal-api',
      curve: [
        { sec: 10, pctViewers: 50 },
        { sec: 0, pctViewers: 100 },
      ],
    });
    expect(v.ok).toBe(true);
    expect(v.curve![0].sec).toBe(0);
    expect(v.source).toBe('ig-internal-api');
  });

  it('rejects bad sources, short curves, and out-of-range points', () => {
    expect(validateRetentionBody({ source: 'other', curve: [] }).ok).toBe(false);
    expect(validateRetentionBody({ source: 'manual', curve: [{ sec: 0, pctViewers: 100 }] }).ok).toBe(false);
    expect(
      validateRetentionBody({
        source: 'manual',
        curve: [{ sec: 0, pctViewers: 150 }, { sec: 1, pctViewers: 90 }],
      }).ok,
    ).toBe(false);
    expect(
      validateRetentionBody({
        source: 'manual',
        curve: [{ sec: -1, pctViewers: 90 }, { sec: 1, pctViewers: 80 }],
      }).ok,
    ).toBe(false);
  });
});
