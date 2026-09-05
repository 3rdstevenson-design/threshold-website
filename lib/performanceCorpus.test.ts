import { describe, it, expect } from 'vitest';
import {
  buildCorpus,
  detectHookStyle,
  renderCorpusForPrompt,
} from './performanceCorpus';
import type { PostPerformance } from './analyticsStore';

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

describe('detectHookStyle', () => {
  it('flags a question hook', () => {
    expect(detectHookStyle('Why do your knees ache?')).toBe('Question hook');
  });

  it('flags a number-led caption as statistic hook', () => {
    expect(detectHookStyle('3 things every runner should know')).toBe(
      'Statistic or list hook',
    );
  });

  it('flags a personal-story opener', () => {
    expect(detectHookStyle("I used to squat 400lb with bad form")).toBe('Story hook');
  });

  it('flags a contrarian opener', () => {
    expect(detectHookStyle('Most people squat wrong')).toBe('Contrarian hook');
  });

  it('falls back to statement hook', () => {
    expect(detectHookStyle('The patellar tendon connects kneecap to tibia.')).toBe(
      'Statement hook',
    );
  });

  it('uses the first line only', () => {
    const caption = 'Most people squat wrong\nHere is why it matters.';
    expect(detectHookStyle(caption)).toBe('Contrarian hook');
  });
});

describe('buildCorpus — empty & single-post', () => {
  it('returns zeros for an empty store', () => {
    const c = buildCorpus([]);
    expect(c.sampleSize).toBe(0);
    expect(c.sampleSizeWithWatchTime).toBe(0);
    expect(c.sampleSizeWithRetention).toBe(0);
    expect(c.baseline.avgCompletionRate).toBe(0);
    expect(c.hookPatterns).toEqual([]);
    expect(c.lengthBuckets).toEqual([]);
    expect(c.topPerformers).toEqual([]);
    expect(c.bottomPerformers).toEqual([]);
    expect(c.dropCliffs).toBeUndefined();
  });

  it('ignores non-REELS media entirely', () => {
    const c = buildCorpus([
      reel({
        mediaId: 'a',
        mediaType: 'CAROUSEL_ALBUM',
        completionRate: 0.9,
        videoDurationMs: 30_000,
        avgWatchTimeMs: 27_000,
      }),
    ]);
    expect(c.sampleSize).toBe(0);
    expect(c.sampleSizeWithWatchTime).toBe(0);
  });

  it('handles a single-post store without crashing', () => {
    const c = buildCorpus([
      reel({
        mediaId: 'single',
        caption: 'Why do your knees ache?',
        completionRate: 0.72,
        videoDurationMs: 20_000,
        avgWatchTimeMs: 14_400,
      }),
    ]);
    expect(c.sampleSize).toBe(1);
    expect(c.sampleSizeWithWatchTime).toBe(1);
    expect(c.topPerformers).toHaveLength(1);
    expect(c.bottomPerformers).toHaveLength(1);
    expect(c.baseline.avgCompletionRate).toBeCloseTo(0.72, 3);
  });
});

describe('buildCorpus — mixed top/bottom performers', () => {
  const posts: PostPerformance[] = [
    reel({
      mediaId: 'q1',
      caption: 'Why are your knees killing you after squats?',
      completionRate: 0.82,
      views: 50_000,
      videoDurationMs: 20_000,
      avgWatchTimeMs: 16_400,
      engagementRate: 0.08,
    }),
    reel({
      mediaId: 'q2',
      caption: 'What really causes low-back pain?',
      completionRate: 0.78,
      views: 40_000,
      videoDurationMs: 25_000,
      avgWatchTimeMs: 19_500,
      engagementRate: 0.07,
    }),
    reel({
      mediaId: 'q3',
      caption: 'Does foam rolling actually do anything?',
      completionRate: 0.74,
      views: 30_000,
      videoDurationMs: 18_000,
      avgWatchTimeMs: 13_320,
      engagementRate: 0.06,
    }),
    reel({
      mediaId: 'c1',
      caption: 'Most people stretch the wrong muscle group.',
      completionRate: 0.32,
      views: 5_000,
      videoDurationMs: 55_000,
      avgWatchTimeMs: 17_600,
      engagementRate: 0.02,
    }),
    reel({
      mediaId: 's1',
      caption: 'Here is a clinical note on patellar tracking.',
      completionRate: 0.28,
      views: 3_000,
      videoDurationMs: 70_000,
      avgWatchTimeMs: 19_600,
      engagementRate: 0.015,
    }),
  ];

  it('ranks top and bottom performers by completionRate', () => {
    const c = buildCorpus(posts);
    expect(c.topPerformers[0].mediaId).toBe('q1');
    expect(c.topPerformers.map((p) => p.mediaId)).toEqual(['q1', 'q2', 'q3']);
    expect(c.bottomPerformers[0].mediaId).toBe('s1');
    expect(c.bottomPerformers.map((p) => p.mediaId)).toEqual(['s1', 'c1', 'q3']);
  });

  it('aggregates hook-pattern stats and sorts by completion rate', () => {
    const c = buildCorpus(posts);
    const byPattern = Object.fromEntries(
      c.hookPatterns.map((h) => [h.pattern, h]),
    );
    expect(byPattern['Question hook'].sampleSize).toBe(3);
    expect(byPattern['Question hook'].avgCompletionRate).toBeCloseTo(0.78, 2);
    expect(byPattern['Question hook'].deltaPp).toBeGreaterThan(0);
    expect(c.hookPatterns[0].pattern).toBe('Question hook');
  });

  it('buckets by duration', () => {
    const c = buildCorpus(posts);
    const buckets = Object.fromEntries(
      c.lengthBuckets.map((b) => [b.bucketSec, b]),
    );
    expect(buckets['15-30']).toBeDefined();
    expect(buckets['30-60']).toBeDefined();
    expect(buckets['60+']).toBeDefined();
    expect(buckets['15-30'].sampleSize).toBe(3);
    expect(buckets['15-30'].avgCompletionRate).toBeGreaterThan(
      buckets['60+'].avgCompletionRate,
    );
  });

  it('omits posts missing completionRate from baseline', () => {
    const postsWithNoise = [
      ...posts,
      reel({ mediaId: 'noise', caption: 'No watch-time yet' }),
    ];
    const c = buildCorpus(postsWithNoise);
    expect(c.sampleSize).toBe(6);
    expect(c.sampleSizeWithWatchTime).toBe(5);
  });
});

describe('buildCorpus — drop cliffs from retention curves', () => {
  const base = {
    completionRate: 0.5,
    videoDurationMs: 30_000,
    avgWatchTimeMs: 15_000,
  };

  it('does not flag cliffs with fewer than 3 curves', () => {
    const posts = [
      reel({
        mediaId: 'a',
        ...base,
        retentionCurve: [
          { sec: 0, pctViewers: 100 },
          { sec: 3, pctViewers: 60 },
          { sec: 30, pctViewers: 40 },
        ],
      }),
      reel({
        mediaId: 'b',
        ...base,
        retentionCurve: [
          { sec: 0, pctViewers: 100 },
          { sec: 3, pctViewers: 55 },
          { sec: 30, pctViewers: 35 },
        ],
      }),
    ];
    const c = buildCorpus(posts);
    expect(c.dropCliffs).toBeUndefined();
  });

  it('flags an opener cliff when ≥3 curves show a sharp early drop', () => {
    const posts = [
      reel({
        mediaId: 'a',
        ...base,
        retentionCurve: [
          { sec: 0, pctViewers: 100 },
          { sec: 3, pctViewers: 60 },
          { sec: 30, pctViewers: 30 },
        ],
      }),
      reel({
        mediaId: 'b',
        ...base,
        retentionCurve: [
          { sec: 0, pctViewers: 100 },
          { sec: 3, pctViewers: 55 },
          { sec: 30, pctViewers: 25 },
        ],
      }),
      reel({
        mediaId: 'c',
        ...base,
        retentionCurve: [
          { sec: 0, pctViewers: 100 },
          { sec: 3, pctViewers: 50 },
          { sec: 30, pctViewers: 20 },
        ],
      }),
    ];
    const c = buildCorpus(posts);
    expect(c.dropCliffs).toBeDefined();
    expect(c.dropCliffs!.length).toBeGreaterThan(0);
    const first = c.dropCliffs![0];
    expect(first.secondRange[0]).toBeLessThanOrEqual(3);
    expect(first.medianPctDrop).toBeGreaterThanOrEqual(8);
    expect(first.commonCauseHypothesis).toMatch(/opener/i);
  });

  it('skips curves with fewer than 2 points', () => {
    const posts = [
      reel({
        mediaId: 'too-short',
        ...base,
        retentionCurve: [{ sec: 0, pctViewers: 100 }],
      }),
    ];
    const c = buildCorpus(posts);
    expect(c.sampleSizeWithRetention).toBe(0);
  });
});

describe('buildCorpus — upload notes', () => {
  it('collects notes most-recent first, capped at 5', () => {
    const posts = Array.from({ length: 7 }, (_, i) =>
      reel({
        mediaId: `n${i}`,
        completionRate: 0.5,
        videoDurationMs: 30_000,
        retentionCurve: [
          { sec: 0, pctViewers: 100 },
          { sec: 10, pctViewers: 50 },
        ],
        retentionNotes: `note ${i}`,
        retentionUploadedAt: `2026-01-${String(10 + i).padStart(2, '0')}T00:00:00Z`,
      }),
    );
    const c = buildCorpus(posts);
    expect(c.uploadNotes).toHaveLength(5);
    expect(c.uploadNotes[0]).toBe('note 6');
    expect(c.uploadNotes[4]).toBe('note 2');
  });
});

describe('renderCorpusForPrompt', () => {
  it('returns null when fewer than 3 reels have watch-time', () => {
    const posts = [
      reel({ mediaId: 'a', completionRate: 0.7, videoDurationMs: 20_000 }),
      reel({ mediaId: 'b', completionRate: 0.5, videoDurationMs: 25_000 }),
    ];
    const c = buildCorpus(posts);
    expect(renderCorpusForPrompt(c)).toBeNull();
  });

  it('renders a prompt block once sample size is sufficient', () => {
    const posts = [
      reel({
        mediaId: 'a',
        caption: 'Why do your knees hurt?',
        completionRate: 0.8,
        videoDurationMs: 20_000,
      }),
      reel({
        mediaId: 'b',
        caption: 'Most people squat wrong.',
        completionRate: 0.3,
        videoDurationMs: 50_000,
      }),
      reel({
        mediaId: 'c',
        caption: 'What is hip impingement?',
        completionRate: 0.6,
        videoDurationMs: 25_000,
      }),
    ];
    const c = buildCorpus(posts);
    const text = renderCorpusForPrompt(c);
    expect(text).not.toBeNull();
    expect(text).toContain('PERFORMANCE CONTEXT');
    expect(text).toContain('Baseline completion rate');
    expect(text).toContain('Top performers');
    expect(text).toContain('Bottom performers');
  });

  it('surfaces skip rate and its per-hook-style split in the prompt', () => {
    // Question hooks skip much less than statement hooks here.
    const posts: PostPerformance[] = Array.from({ length: 12 }, (_, i) =>
      reel({
        mediaId: `s${i}`,
        caption: i % 2 === 0 ? `Why does ${i} matter?` : `Most people get ${i} wrong.`,
        skipRate: i % 2 === 0 ? 45 + (i % 3) : 75 + (i % 3),
        views: 1_000,
      }),
    );
    const c = buildCorpus(posts);
    expect(c.skipRate?.sampleSize).toBe(12);
    // Ascending: the low-skip style must rank first.
    expect(c.skipRate!.byHookStyle[0].avgPct).toBeLessThan(
      c.skipRate!.byHookStyle[c.skipRate!.byHookStyle.length - 1].avgPct,
    );
    expect(c.skipRate!.best[0].pct).toBeLessThan(c.skipRate!.worst[0].pct);

    const text = renderCorpusForPrompt(c)!;
    expect(text).toContain('Skip rate');
    expect(text).toContain('By hook style');
    expect(text).toContain('Least skipped');
  });

  it('omits the skip-rate block entirely when no reel has the metric', () => {
    const posts: PostPerformance[] = [reel({ mediaId: 'n1', caption: 'No skip data here.' })];
    const c = buildCorpus(posts);
    expect(c.skipRate).toBeUndefined();
    expect(renderCorpusForPrompt(c) ?? '').not.toContain('Skip rate');
  });

  it('stays under ~1500 tokens (~6000 chars) on a realistic corpus', () => {
    const posts: PostPerformance[] = Array.from({ length: 50 }, (_, i) =>
      reel({
        mediaId: `p${i}`,
        caption:
          i % 3 === 0
            ? `Why does ${i} matter for your training?`
            : i % 3 === 1
              ? `Most ${i}-year-olds get this wrong.`
              : `Clinical note ${i} on biomechanics.`,
        completionRate: 0.3 + (i % 10) / 20,
        videoDurationMs: 15_000 + (i % 4) * 15_000,
        avgWatchTimeMs: 10_000,
        views: 1_000 + i * 100,
      }),
    );
    const c = buildCorpus(posts);
    const text = renderCorpusForPrompt(c)!;
    expect(text.length).toBeLessThan(6000);
  });
});
