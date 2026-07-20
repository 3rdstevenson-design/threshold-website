import { readAnalytics, PostPerformance } from './analyticsStore';

export interface Baseline {
  avgViews: number;
  avgLikes: number;
  avgShares: number;
  avgSaves: number;
  avgEngagementRate: number;
  sampleSize: number;
}

export interface ViralPatterns {
  baseline: Baseline;
  outliers: PostPerformance[];
  allPosts: PostPerformance[];
  patterns: {
    topHookStyle: string;
    bestPerformingHook: string;
    strongestCtaKeyword: string;
    bestContentType: string;
    bestContentTypeEngagement: number;
  };
  warnings: string[];
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function withinDays(post: PostPerformance, days: number): boolean {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(post.timestamp).getTime() >= cutoff;
}

function detectHookStyle(caption: string): string {
  const firstLine = caption.split('\n')[0].trim();
  if (!firstLine) return 'Statement hook';
  if (firstLine.endsWith('?')) return 'Question hook';
  if (/^\d/.test(firstLine)) return 'Statistic or list hook';
  if (/i used to|i was |here'?s how/i.test(firstLine)) return 'Story hook';
  if (/most people|nobody|no one|stop |don'?t /i.test(firstLine)) return 'Contrarian hook';
  return 'Statement hook';
}

function detectCta(caption: string): string {
  const lower = caption.toLowerCase();
  const manychat = caption.match(/comment\s+([A-Z]{2,})/i);
  if (manychat) return `Comment ${manychat[1].toUpperCase()}`;
  if (lower.includes('save this')) return 'Save this';
  if (lower.includes('share this') || lower.includes('share with')) return 'Share this';
  if (lower.includes('link in bio')) return 'Link in bio';
  if (lower.includes('follow')) return 'Follow for more';
  return 'None detected';
}

export async function getBaseline(days = 90): Promise<Baseline> {
  const store = await readAnalytics();
  const posts = store.posts.filter((p) => withinDays(p, days));
  return {
    avgViews: avg(posts.map((p) => p.views)),
    avgLikes: avg(posts.map((p) => p.likes)),
    avgShares: avg(posts.map((p) => p.shares)),
    avgSaves: avg(posts.map((p) => p.saves)),
    avgEngagementRate: avg(posts.map((p) => p.engagementRate)),
    sampleSize: posts.length,
  };
}

export async function detectOutliers(days = 90): Promise<PostPerformance[]> {
  const store = await readAnalytics();
  const posts = store.posts.filter((p) => withinDays(p, days));
  if (posts.length === 0) return [];

  const baseline = {
    views: avg(posts.map((p) => p.views)),
    shares: avg(posts.map((p) => p.shares)),
    saves: avg(posts.map((p) => p.saves)),
  };

  return posts.filter(
    (p) => baseline.views > 0 && p.views >= baseline.views * 2
  );
}

export async function extractPatterns(days = 90): Promise<ViralPatterns> {
  const store = await readAnalytics();
  const posts = store.posts.filter((p) => withinDays(p, days));
  const warnings: string[] = [];

  if (posts.length === 0) {
    warnings.push('No performance data yet. Run the sync endpoint to pull Instagram metrics.');
  } else if (posts.length < 5) {
    warnings.push(`Only ${posts.length} posts synced — patterns will be rough until you have at least 5.`);
  }

  const baseline: Baseline = {
    avgViews: avg(posts.map((p) => p.views)),
    avgLikes: avg(posts.map((p) => p.likes)),
    avgShares: avg(posts.map((p) => p.shares)),
    avgSaves: avg(posts.map((p) => p.saves)),
    avgEngagementRate: avg(posts.map((p) => p.engagementRate)),
    sampleSize: posts.length,
  };

  // Detect outliers
  const outliers = posts.filter(
    (p) => baseline.avgViews > 0 && p.views >= baseline.avgViews * 2
  );

  // Top hook from highest-engagement outlier
  const topOutlier = [...outliers].sort((a, b) => b.engagementRate - a.engagementRate)[0];
  const topHookStyle = topOutlier ? detectHookStyle(topOutlier.caption) : 'Not enough data';
  const bestPerformingHook = topOutlier
    ? topOutlier.caption.split('\n')[0].trim().slice(0, 120)
    : 'Not enough data';

  // Strongest CTA from outliers (fall back to all posts)
  const ctaSource = outliers.length > 0 ? outliers : posts;
  const ctaCounts: Record<string, number> = {};
  for (const p of ctaSource) {
    const cta = detectCta(p.caption);
    ctaCounts[cta] = (ctaCounts[cta] ?? 0) + 1;
  }
  const strongestCtaKeyword = Object.entries(ctaCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'None detected';

  // Best content type by avg engagement rate
  const typeEngagement: Record<string, number[]> = {};
  for (const p of posts) {
    const key = p.mediaType === 'REELS' ? 'reel' : p.mediaType === 'CAROUSEL_ALBUM' ? 'carousel' : 'image';
    if (!typeEngagement[key]) typeEngagement[key] = [];
    typeEngagement[key].push(p.engagementRate);
  }
  const typeAvgs = Object.entries(typeEngagement).map(([type, vals]) => ({
    type,
    avgEng: avg(vals),
  }));
  typeAvgs.sort((a, b) => b.avgEng - a.avgEng);
  const bestContentType = typeAvgs[0]?.type ?? 'Not enough data';
  const bestContentTypeEngagement = typeAvgs[0]?.avgEng ?? 0;

  if (outliers.length === 0 && posts.length >= 5) {
    warnings.push('No viral outliers detected yet (no posts at 2× the average). Keep posting!');
  }

  return {
    baseline,
    outliers,
    allPosts: [...posts].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    patterns: {
      topHookStyle,
      bestPerformingHook,
      strongestCtaKeyword,
      bestContentType,
      bestContentTypeEngagement,
    },
    warnings,
  };
}
