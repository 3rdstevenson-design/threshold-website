import { NextRequest, NextResponse } from 'next/server';
import { readHistory } from '@/lib/analyticsHistory';
import { readAnalytics } from '@/lib/analyticsStore';
import { assessEvergreen } from '@/lib/evergreen';

export const dynamic = 'force-dynamic';

/**
 * Per-post metric-history snapshots joined with evergreen assessments.
 * Powers the Longevity section of the analytics page. `?mediaId=` narrows
 * to one post; `lastSyncedAt` feeds the staleness banner (a dead Meta
 * token shows up here first).
 */
export async function GET(req: NextRequest) {
  const pwd = req.headers.get('x-dashboard-key');
  if (!process.env.DASHBOARD_PASSWORD || pwd !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const mediaIdFilter = searchParams.get('mediaId');

  const [history, analytics] = await Promise.all([readHistory(), readAnalytics()]);
  const timestampById = new Map(analytics.posts.map((p) => [p.mediaId, p.timestamp]));

  const posts = Object.entries(history.posts)
    .filter(([mediaId]) => !mediaIdFilter || mediaId === mediaIdFilter)
    .map(([mediaId, snapshots]) => ({
      mediaId,
      snapshots,
      evergreen: assessEvergreen(
        timestampById.get(mediaId) ?? snapshots[0]?.at ?? new Date().toISOString(),
        snapshots,
      ),
    }));

  return NextResponse.json({
    updatedAt: history.updatedAt,
    lastSyncedAt: analytics.lastSyncedAt,
    posts,
  });
}
