import { NextRequest, NextResponse } from 'next/server';
import { extractPatterns } from '@/lib/viralPatternsService';

export async function GET(req: NextRequest) {
  const pwd = req.headers.get('x-dashboard-key');
  if (!process.env.DASHBOARD_PASSWORD || pwd !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '90', 10) || 90, 1), 365);
  const patterns = await extractPatterns(days);
  return NextResponse.json(patterns);
}

export async function POST(req: NextRequest) {
  const pwd = req.headers.get('x-dashboard-key');
  if (!process.env.DASHBOARD_PASSWORD || pwd !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Proxy to sync endpoint
  const { fetchRecentMedia, fetchPostInsights } = await import('@/lib/insights');
  const { upsertPerformance } = await import('@/lib/analyticsStore');
  const { readQueue } = await import('@/lib/queue');

  let synced = 0, skipped = 0;
  const errors: string[] = [];

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
  } catch {}

  const media = await fetchRecentMedia(25);
  for (const item of media) {
    try {
      const insights = await fetchPostInsights(
        item.id,
        item.media_type,
        item.like_count ?? 0,
        item.comments_count ?? 0,
        item.video_duration,
      );
      if (!insights) { skipped++; continue; }
      const caption = item.caption ?? '';
      const keyword = caption.match(/comment\s+([A-Z]{2,})/i)?.[1]?.toUpperCase();
      const videoDurationMs =
        typeof item.video_duration === 'number'
          ? Math.round(item.video_duration * 1000)
          : undefined;
      const linked = publishIdMap[item.id];
      await upsertPerformance({
        mediaId: item.id,
        queuePostId: linked?.id,
        slug: linked?.slug,
        caption,
        mediaType: item.media_type,
        timestamp: item.timestamp,
        syncedAt: new Date().toISOString(),
        ...insights,
        videoDurationMs,
        manychatKeyword: keyword,
      });
      synced++;
    } catch (e: any) {
      errors.push(e.message);
    }
  }
  // Invalidate the performance-corpus cache so the next editor call
  // reflects the fresh sync immediately.
  try {
    const { invalidateCorpusCache } = await import('@/lib/performanceCorpus');
    invalidateCorpusCache();
  } catch {}
  return NextResponse.json({ synced, skipped, errors });
}
