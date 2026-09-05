/**
 * performanceSync.ts
 *
 * The Meta insights sync loop, shared by the Vercel cron
 * (/api/cron/content-performance-sync) and the dashboard's manual
 * "Sync now" (/api/dashboard/analytics POST) — previously duplicated
 * verbatim in both routes. Each route keeps only its own auth check.
 *
 * Besides upserting current metrics into analytics/performance.json,
 * every successful sync appends one MetricSnapshot per post to the
 * history store (views-over-time / evergreen analysis). History append
 * is fail-soft: a history error lands in `errors[]` without blocking
 * the metric sync.
 */
import { fetchRecentMedia, fetchPostInsights, normalizedMediaType } from './insights';
import { upsertPerformance, type PostPerformance } from './analyticsStore';
import { readQueue } from './queue';
import { appendSnapshots, type MetricSnapshot } from './analyticsHistory';
import { invalidateCorpusCache } from './performanceCorpus';

export interface SyncResult {
  synced: number;
  skipped: number;
  errors: string[];
  history?: { appended: number; deduped: number };
}

function extractManychatKeyword(caption: string): string | undefined {
  const match = caption.match(/comment\s+([A-Z]{2,})/i);
  return match ? match[1].toUpperCase() : undefined;
}

export async function runPerformanceSync(): Promise<SyncResult> {
  const errors: string[] = [];
  let synced = 0;
  let skipped = 0;

  // Build map of metaPublishId → {queuePostId, slug}. Slug lets retention
  // frame extraction locate the rendered .mp4 under TAKES_ROOT. Older rows
  // without an explicit `slug` fall back to stripping `.mp4` off `notes`.
  const publishIdMap: Record<string, { id: string; slug?: string }> = {};
  try {
    const queue = await readQueue();
    for (const post of queue) {
      if (post.metaPublishId) {
        publishIdMap[post.metaPublishId] = {
          id: post.id,
          slug: post.slug ?? post.notes?.replace(/\.mp4$/, ''),
        };
      }
    }
  } catch (err: any) {
    console.warn('Could not read queue for linking:', err.message);
  }

  const media = await fetchRecentMedia(25);
  const snapshots: Array<{ mediaId: string; snapshot: MetricSnapshot }> = [];

  for (const item of media) {
    try {
      // Meta types reels as media_type VIDEO; normalize via
      // media_product_type so reels get the watch-time metric path and
      // land in the store as REELS (which every reels-only analytics
      // feature filters on).
      const mediaType = normalizedMediaType(item);
      const insights = await fetchPostInsights(
        item.id,
        mediaType,
        item.like_count ?? 0,
        item.comments_count ?? 0,
        item.video_duration,
      );
      if (!insights) {
        skipped++;
        console.warn(`No insights for media ${item.id} (${item.media_type})`);
        continue;
      }

      const caption = item.caption ?? '';
      const syncedAt = new Date().toISOString();
      const videoDurationMs =
        typeof item.video_duration === 'number'
          ? Math.round(item.video_duration * 1000)
          : undefined;

      const linked = publishIdMap[item.id];
      const record: PostPerformance = {
        mediaId: item.id,
        queuePostId: linked?.id,
        slug: linked?.slug,
        caption,
        mediaType,
        timestamp: item.timestamp,
        syncedAt,
        views: insights.views,
        likes: insights.likes,
        shares: insights.shares,
        saves: insights.saves,
        comments: insights.comments,
        engagementRate: insights.engagementRate,
        manychatKeyword: extractManychatKeyword(caption),
        avgWatchTimeMs: insights.avgWatchTimeMs,
        totalWatchTimeMs: insights.totalWatchTimeMs,
        replays: insights.replays,
        videoDurationMs,
        completionRate: insights.completionRate,
        skipRate: insights.skipRate,
      };

      await upsertPerformance(record);
      snapshots.push({
        mediaId: item.id,
        snapshot: {
          at: syncedAt,
          views: insights.views,
          likes: insights.likes,
          shares: insights.shares,
          saves: insights.saves,
          comments: insights.comments,
          ...(typeof insights.avgWatchTimeMs === 'number'
            ? { avgWatchTimeMs: insights.avgWatchTimeMs }
            : {}),
          ...(typeof insights.skipRate === 'number'
            ? { skipRate: insights.skipRate }
            : {}),
        },
      });
      synced++;
    } catch (err: any) {
      const msg = `Media ${item.id}: ${err.message}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  let history: SyncResult['history'];
  try {
    history = await appendSnapshots(snapshots);
  } catch (err: any) {
    errors.push(`History append failed: ${err.message}`);
  }

  // Invalidate the performance-corpus cache so the next editor call
  // reflects the fresh sync immediately.
  try {
    invalidateCorpusCache();
  } catch {}

  return { synced, skipped, errors, ...(history ? { history } : {}) };
}
