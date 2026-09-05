/**
 * POST /api/analytics/retention-frames/:mediaId/reextract
 *
 * Re-runs frame extraction + Claude-vision description against the
 * currently stored retention curve + the latest local source video.
 * Used when the user uploaded a retention screenshot before the source
 * video was cached locally, or after tweaking the curve.
 */
import { NextRequest, NextResponse } from 'next/server';
import { mergePerformance, readAnalytics } from '@/lib/analyticsStore';
import { findDropCliffs, invalidateCorpusCache } from '@/lib/performanceCorpus';
import { locateSourceVideo } from '@/lib/sourceVideoLocator';
import { extractFramesForCliffs } from '@/lib/retentionFrames';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: { mediaId: string } },
) {
  const pwd = req.headers.get('x-dashboard-key');
  if (!process.env.DASHBOARD_PASSWORD || pwd !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  const mediaId = params.mediaId;
  if (!mediaId) {
    return NextResponse.json({ error: 'missing mediaId' }, { status: 400 });
  }

  const store = await readAnalytics();
  const post = store.posts.find((p) => p.mediaId === mediaId);
  if (!post) {
    return NextResponse.json({ error: `mediaId ${mediaId} not found` }, { status: 404 });
  }
  if (!post.retentionCurve || post.retentionCurve.length < 2) {
    return NextResponse.json(
      { error: 'no retention curve — upload a screenshot first' },
      { status: 422 },
    );
  }

  // minSample 1 — this is a single post's own curve; the corpus-wide
  // default of 3 would return no cliffs for every single-curve call.
  const cliffs = findDropCliffs([post.retentionCurve], { minSample: 1 });
  if (cliffs.length === 0) {
    return NextResponse.json({
      ok: true,
      framesExtracted: 0,
      skippedReason: 'no drop cliffs detected',
    });
  }

  const located = await locateSourceVideo({
    mediaId,
    slug: post.slug,
    queuePostId: post.queuePostId,
  });
  if (!located) {
    return NextResponse.json({
      ok: true,
      framesExtracted: 0,
      skippedReason: 'source video not found',
    });
  }

  try {
    const frames = await extractFramesForCliffs({
      mediaId,
      slug: post.slug,
      videoAbsPath: located.absPath,
      cliffs: cliffs.map((c) => ({ secondRange: c.secondRange })),
      apiKey,
    });
    if (frames.length === 0) {
      return NextResponse.json({
        ok: true,
        framesExtracted: 0,
        skippedReason: 'frame extraction returned no frames',
      });
    }
    const updated = await mergePerformance(mediaId, { retentionFrames: frames });
    invalidateCorpusCache();
    return NextResponse.json({
      ok: true,
      framesExtracted: frames.length,
      source: located.source,
      post: updated,
    });
  } finally {
    located.cleanup?.();
  }
}
