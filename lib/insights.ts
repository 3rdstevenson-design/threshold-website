const BASE = 'https://graph.facebook.com/v22.0';

function igId() {
  const id = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!id) throw new Error('INSTAGRAM_ACCOUNT_ID is not set');
  return id;
}

function token() {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new Error('META_ACCESS_TOKEN is not set');
  return t;
}

export interface RecentMedia {
  id: string;
  caption: string;
  media_type: 'IMAGE' | 'CAROUSEL_ALBUM' | 'REELS' | 'VIDEO';
  /** Meta types reels as media_type VIDEO — the reel-ness lives here. */
  media_product_type?: 'FEED' | 'REELS' | 'STORY' | 'AD';
  timestamp: string;
  like_count: number;
  comments_count: number;
  /** Duration in seconds. Present for REELS/VIDEO; absent for IMAGE/CAROUSEL. */
  video_duration?: number;
}

/**
 * The store's media type, normalized: a VIDEO whose media_product_type is
 * REELS is a Reel — that is what unlocks the reels watch-time metrics and
 * every reels-only analytics feature downstream.
 */
export function normalizedMediaType(
  item: Pick<RecentMedia, 'media_type' | 'media_product_type'>,
): RecentMedia['media_type'] {
  return item.media_product_type === 'REELS' ? 'REELS' : item.media_type;
}

export interface PostInsights {
  views: number;
  likes: number;
  shares: number;
  saves: number;
  comments: number;
  engagementRate: number;
  /** Avg watch time in ms. Only populated for REELS (ig_reels_avg_watch_time). */
  avgWatchTimeMs?: number;
  /** Total watch time in ms across all viewers (ig_reels_video_view_total_time). */
  totalWatchTimeMs?: number;
  /** clips_replays_count — how many viewers re-watched. */
  replays?: number;
  /** avgWatchTimeMs / videoDurationMs, clamped to [0, 1]. */
  completionRate?: number;
  /** reels_skip_rate — percent (0–100) of viewers who skipped away.
   *  REELS only. The closest thing the Graph API offers to a retention
   *  curve: Instagram's per-second curve is mobile-app-only (see
   *  docs/ig-insights-api.md), so this scalar stands in for hook strength.
   *  Lower is better. */
  skipRate?: number;
}

export async function fetchRecentMedia(limit = 25): Promise<RecentMedia[]> {
  const url = new URL(`${BASE}/${igId()}/media`);
  url.searchParams.set(
    'fields',
    'id,caption,media_type,media_product_type,timestamp,like_count,comments_count,video_duration',
  );
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('access_token', token());

  const res = await fetch(url.toString());
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Meta media list error: ${JSON.stringify(json.error || json)}`);
  }
  return (json.data ?? []) as RecentMedia[];
}

async function tryFetchMetrics(mediaId: string, metrics: string): Promise<Record<string, number> | null> {
  const url = new URL(`${BASE}/${mediaId}/insights`);
  url.searchParams.set('metric', metrics);
  url.searchParams.set('access_token', token());

  const res = await fetch(url.toString());
  const json = await res.json();
  if (!res.ok || json.error) return null;

  const data: Record<string, number> = {};
  for (const item of json.data ?? []) {
    data[item.name] = item.values?.[0]?.value ?? item.value ?? 0;
  }
  return data;
}

export async function fetchPostInsights(
  mediaId: string,
  mediaType: 'IMAGE' | 'CAROUSEL_ALBUM' | 'REELS' | 'VIDEO',
  likes: number,
  comments: number,
  videoDurationSec?: number,
): Promise<PostInsights | null> {
  // Try progressively simpler metric sets until one succeeds.
  // Verified against v22.0 on 2026-07-22: `plays`, `video_views`, and
  // `clips_replays_count` are gone; `views` is the unified view metric and
  // the ig_reels_* watch-time metrics still work for reels.
  const attempts: { metrics: string; viewKey: string }[] =
    mediaType === 'REELS'
      ? [
          {
            metrics:
              'views,reach,saved,shares,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate',
            viewKey: 'views',
          },
          // Same minus reels_skip_rate — keeps watch-time if a given reel
          // predates the skip-rate metric or Meta rejects it.
          {
            metrics:
              'views,reach,saved,shares,ig_reels_avg_watch_time,ig_reels_video_view_total_time',
            viewKey: 'views',
          },
          { metrics: 'views,reach,saved,shares', viewKey: 'views' },
          { metrics: 'reach,saved',              viewKey: 'reach' },
        ]
      : mediaType === 'VIDEO'
      ? [
          { metrics: 'views,reach,saved',        viewKey: 'views' },
          { metrics: 'reach,saved',              viewKey: 'reach' },
        ]
      : [
          // IMAGE and CAROUSEL_ALBUM
          { metrics: 'views,reach,saved',        viewKey: 'views' },
          { metrics: 'reach,saved',              viewKey: 'reach' },
        ];

  for (const { metrics, viewKey } of attempts) {
    const data = await tryFetchMetrics(mediaId, metrics);
    if (!data) continue;

    const views = data[viewKey] ?? 0;
    const shares = data.shares ?? 0;
    const saves = data.saved ?? 0;
    const engagementRate = views > 0
      ? (likes + comments + shares + saves) / views
      : 0;

    const avgWatchTimeMs = data.ig_reels_avg_watch_time;
    const totalWatchTimeMs = data.ig_reels_video_view_total_time;
    const replays = data.clips_replays_count;
    const skipRate = data.reels_skip_rate;

    let completionRate: number | undefined;
    if (
      typeof avgWatchTimeMs === 'number' &&
      typeof videoDurationSec === 'number' &&
      videoDurationSec > 0
    ) {
      const rate = avgWatchTimeMs / (videoDurationSec * 1000);
      completionRate = Math.max(0, Math.min(1, rate));
    }

    return {
      views,
      likes,
      shares,
      saves,
      comments,
      engagementRate,
      avgWatchTimeMs: typeof avgWatchTimeMs === 'number' ? avgWatchTimeMs : undefined,
      totalWatchTimeMs: typeof totalWatchTimeMs === 'number' ? totalWatchTimeMs : undefined,
      replays: typeof replays === 'number' ? replays : undefined,
      completionRate,
      skipRate: typeof skipRate === 'number' ? skipRate : undefined,
    };
  }

  console.warn(`All metric attempts failed for ${mediaId} (${mediaType})`);
  return null;
}
