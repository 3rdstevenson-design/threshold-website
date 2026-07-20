import { NextRequest, NextResponse } from 'next/server';
import { fetchRecentMedia, fetchPostInsights } from '@/lib/insights';
import { upsertPerformance, PostPerformance } from '@/lib/analyticsStore';
import { readQueue } from '@/lib/queue';

function extractManychatKeyword(caption: string): string | undefined {
  const match = caption.match(/comment\s+([A-Z]{2,})/i);
  return match ? match[1].toUpperCase() : undefined;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const errors: string[] = [];
  let synced = 0;
  let skipped = 0;

  // Build map of metaPublishId → {queuePostId, slug}. Slug lets retention
  // frame extraction locate the rendered .mp4 under TAKES_ROOT. Older rows
  // without an explicit `slug` fall back to stripping `.mp4` off `notes`.
  let publishIdMap: Record<string, { id: string; slug?: string }> = {};
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

  let media: Awaited<ReturnType<typeof fetchRecentMedia>> = [];
  try {
    media = await fetchRecentMedia(25);
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to fetch media list: ${err.message}` }, { status: 500 });
  }

  for (const item of media) {
    try {
      const insights = await fetchPostInsights(
        item.id,
        item.media_type,
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
        mediaType: item.media_type,
        timestamp: item.timestamp,
        syncedAt: new Date().toISOString(),
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
      };

      await upsertPerformance(record);
      synced++;
    } catch (err: any) {
      const msg = `Media ${item.id}: ${err.message}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  return NextResponse.json({ synced, skipped, errors });
}
