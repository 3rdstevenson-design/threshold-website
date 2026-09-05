/**
 * POST /api/analytics/retention-data
 *
 * Structured retention-curve ingest — the no-vision sibling of
 * /api/analytics/retention-upload, fed by the /sync-retention browser
 * routine once it can read Instagram's own insights JSON (see
 * docs/ig-insights-api.md), or by any script with curve data in hand.
 *
 * JSON body:
 *   {
 *     mediaId?: string;            // one of mediaId | reelUrl required
 *     reelUrl?: string;
 *     curve: { sec: number; pctViewers: number }[];   // >= 2 points
 *     videoDurationSec?: number;
 *     caption?: string;
 *     notes?: string;
 *     source: 'ig-internal-api' | 'manual';
 *   }
 *
 * Frame extraction only works where the source video exists (locally);
 * on Vercel locateSourceVideo fails soft and framesSkippedReason says so.
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveMediaId } from '@/lib/instagramIds';
import { ingestRetentionCurve, validateRetentionBody } from '@/lib/retentionIngest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const pwd = req.headers.get('x-dashboard-key');
  if (!process.env.DASHBOARD_PASSWORD || pwd !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const validated = validateRetentionBody(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const mediaId = resolveMediaId({
    mediaId: typeof body.mediaId === 'string' ? body.mediaId : undefined,
    reelUrl: typeof body.reelUrl === 'string' ? body.reelUrl : undefined,
  });
  if (!mediaId) {
    return NextResponse.json(
      { error: 'missing mediaId — provide a numeric id or a Reel URL' },
      { status: 400 },
    );
  }

  const videoDurationSec = Number(body.videoDurationSec);
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : '';

  const result = await ingestRetentionCurve({
    mediaId,
    curve: validated.curve!,
    videoDurationMs:
      Number.isFinite(videoDurationSec) && videoDurationSec > 0
        ? Math.round(videoDurationSec * 1000)
        : undefined,
    caption: typeof body.caption === 'string' ? body.caption.trim().slice(0, 500) : undefined,
    notes: `[${validated.source}]${notes ? ` ${notes}` : ''}`,
    apiKey,
  });

  return NextResponse.json({
    ok: true,
    mediaId,
    curvePoints: validated.curve!.length,
    framesExtracted: result.framesExtracted,
    framesSkippedReason: result.framesSkippedReason,
  });
}
