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
  timestamp: string;
  like_count: number;
  comments_count: number;
  /** Duration in seconds. Present for REELS/VIDEO; absent for IMAGE/CAROUSEL. */
  video_duration?: number;
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
}

export async function fetchRecentMedia(limit = 25): Promise<RecentMedia[]> {
  const url = new URL(`${BASE}/${igId()}/media`);
  url.searchParams.set(
    'fields',
    'id,caption,media_type,timestamp,like_count,comments_count,video_duration',
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
  // Meta v22.0 removed impressions; not all metrics are available for every post age/type.
  // For REELS we try watch-time + replay metrics first, then fall back to engagement-only.
  const attempts: { metrics: string; viewKey: string }[] =
    mediaType === 'REELS'
      ? [
          {
            metrics:
              'plays,reach,saved,shares,ig_reels_avg_watch_time,ig_reels_video_view_total_time,clips_replays_count',
            viewKey: 'plays',
          },
          { metrics: 'plays,reach,saved,shares', viewKey: 'plays' },
          { metrics: 'plays,reach,saved',        viewKey: 'plays' },
          { metrics: 'reach,saved',              viewKey: 'reach' },
        ]
      : mediaType === 'VIDEO'
      ? [
          { metrics: 'video_views,reach,saved',  viewKey: 'video_views' },
          { metrics: 'reach,saved',              viewKey: 'reach' },
        ]
      : [
          // IMAGE and CAROUSEL_ALBUM
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
    };
  }

  console.warn(`All metric attempts failed for ${mediaId} (${mediaType})`);
  return null;
}
