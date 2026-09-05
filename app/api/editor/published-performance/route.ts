import { NextRequest, NextResponse } from 'next/server';
import { readAnalytics } from '@/lib/analyticsStore';
import { hookHold3s } from '@/lib/retentionMath';

export const dynamic = 'force-dynamic';

/**
 * Performance of published reels keyed by their source editor project
 * slug, so the editor can show "this project's published reel held N%
 * at 3s" right where the next script gets cut.
 */
export async function GET(req: NextRequest) {
  const pwd = req.headers.get('x-dashboard-key');
  if (!process.env.DASHBOARD_PASSWORD || pwd !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const store = await readAnalytics();
  const bySlug: Record<
    string,
    { mediaId: string; views: number; completionRate: number | null; hookHold3sPct: number | null }
  > = {};
  for (const post of store.posts) {
    if (!post.slug) continue;
    const hold = post.retentionCurve ? hookHold3s(post.retentionCurve) : null;
    bySlug[post.slug] = {
      mediaId: post.mediaId,
      views: post.views,
      completionRate: typeof post.completionRate === 'number' ? post.completionRate : null,
      hookHold3sPct: hold === null ? null : Math.round(hold),
    };
  }
  return NextResponse.json({ bySlug });
}
