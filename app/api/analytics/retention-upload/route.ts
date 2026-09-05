/**
 * POST /api/analytics/retention-upload
 *
 * multipart/form-data with:
 *   - file              : screenshot of the Instagram Pro Dashboard retention chart
 *   - mediaId           : Instagram media id (required unless reelUrl is provided)
 *   - reelUrl           : Instagram Reel URL; shortcode is decoded to mediaId
 *                         when mediaId isn't provided directly
 *   - caption           : optional, used if mediaId isn't in store yet (stub)
 *   - videoDurationMs   : optional, used for stub creation
 *   - notes             : optional free-text notes from the user
 *
 * Flow:
 *   1. Resolve mediaId (lib/instagramIds.ts).
 *   2. Stash the screenshot in R2 under analytics/retention/<mediaId>.<ext>.
 *   3. Call Claude vision to extract {curve, videoDurationSec, notes}.
 *   4. Hand off to ingestRetentionCurve (lib/retentionIngest.ts): merge the
 *      curve into analytics (stub record if new), detect drop cliffs, and
 *      fail-soft extract a described frame per cliff from the source video.
 *
 * Structured curve data (no screenshot) goes to /api/analytics/retention-data
 * instead — same ingest tail, no vision call.
 */
import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, r2PublicUrl, useR2 } from '@/lib/r2';
import { parseRetentionScreenshot } from '@/lib/retentionParser';
import { resolveMediaId } from '@/lib/instagramIds';
import { ingestRetentionCurve } from '@/lib/retentionIngest';
import { readAnalytics } from '@/lib/analyticsStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function extFor(mediaType: string): string {
  if (mediaType === 'image/png') return 'png';
  if (mediaType === 'image/webp') return 'webp';
  return 'jpg';
}

/** Vision reads the duration off a chart axis, so it lands close but rarely
 *  exact. Wide enough to survive that, tight enough that two Reels cut to the
 *  same target length still separate in practice. */
const DURATION_TOLERANCE_MS = 1500;

interface DurationMatch {
  mediaId?: string;
  reason?: string;
  candidates: { mediaId: string; hook: string; durationSec: number; deltaSec: number }[];
}

/**
 * Find the one Reel a curve belongs to, by duration, among Reels that don't
 * already have a curve. Returns `mediaId` only on an unambiguous single hit —
 * zero matches and multiple matches both come back as candidates so the caller
 * can ask rather than guess. Silently attaching a curve to the wrong Reel would
 * poison the content brief, which is the whole point of collecting it.
 */
async function matchReelByDuration(durationMs?: number): Promise<DurationMatch> {
  const store = await readAnalytics();
  const eligible = store.posts.filter(
    (p) =>
      (p.mediaType === 'REELS' || p.mediaType === 'VIDEO') &&
      !(p.retentionCurve && p.retentionCurve.length > 1) &&
      typeof p.videoDurationMs === 'number' &&
      p.videoDurationMs > 0,
  );

  const describe = (p: (typeof eligible)[number]) => ({
    mediaId: p.mediaId,
    hook: (p.caption ?? '').split('\n')[0].trim().slice(0, 80),
    durationSec: Math.round((p.videoDurationMs ?? 0) / 100) / 10,
    deltaSec: durationMs
      ? Math.round(Math.abs((p.videoDurationMs ?? 0) - durationMs) / 100) / 10
      : -1,
  });

  if (!durationMs) {
    return {
      reason: 'the chart had no readable duration, so there is nothing to match on',
      candidates: eligible.slice(0, 8).map(describe),
    };
  }

  const near = eligible
    .filter((p) => Math.abs((p.videoDurationMs ?? 0) - durationMs) <= DURATION_TOLERANCE_MS)
    .sort(
      (a, b) =>
        Math.abs((a.videoDurationMs ?? 0) - durationMs) -
        Math.abs((b.videoDurationMs ?? 0) - durationMs),
    );

  if (near.length === 1) return { mediaId: near[0].mediaId, candidates: [] };

  return {
    reason: near.length
      ? `${near.length} Reels without a curve are within ${DURATION_TOLERANCE_MS / 1000}s of this chart`
      : 'no Reel without a curve matches this duration',
    candidates: (near.length ? near : eligible)
      .slice(0, 8)
      .map(describe)
      .sort((a, b) => a.deltaSec - b.deltaSec),
  };
}

export async function POST(req: NextRequest) {
  const pwd = req.headers.get('x-dashboard-key');
  if (!process.env.DASHBOARD_PASSWORD || pwd !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e: any) {
    return NextResponse.json({ error: `bad form: ${e?.message ?? e}` }, { status: 400 });
  }

  const file = form.get('file');
  const rawMediaId = String(form.get('mediaId') ?? '').trim();
  const reelUrl = String(form.get('reelUrl') ?? '').trim();
  const captionInput = String(form.get('caption') ?? '').trim().slice(0, 500);
  const notes = String(form.get('notes') ?? '').trim().slice(0, 500);
  const videoDurationMsInput = parseInt(String(form.get('videoDurationMs') ?? ''), 10);

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing file' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `unsupported file type ${file.type}; use PNG, JPEG, or WebP` },
      { status: 400 },
    );
  }

  // mediaId is OPTIONAL. Instagram's retention chart doesn't name the Reel, so
  // an unattended sender (the Telegram concierge) has no id to pass. When it's
  // absent we match on the duration the vision pass reads off the x-axis.
  //
  // That forces parse-before-stash: the R2 object key is <mediaId>.<ext>, so
  // the id has to be known first. Side benefit — screenshots we can't read no
  // longer orphan themselves in the bucket.
  const explicitMediaId = resolveMediaId({ mediaId: rawMediaId, reelUrl });

  const buf = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = await parseRetentionScreenshot({
      imageBase64: buf.toString('base64'),
      mediaType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
      apiKey,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `vision parse failed: ${e?.message ?? e}` },
      { status: 500 },
    );
  }

  if (parsed.curve.length < 2) {
    return NextResponse.json(
      {
        error: 'Claude could not read a usable retention curve from the screenshot',
        visionNotes: parsed.notes,
      },
      { status: 422 },
    );
  }

  const videoDurationMs = parsed.videoDurationSec
    ? parsed.videoDurationSec * 1000
    : Number.isFinite(videoDurationMsInput) && videoDurationMsInput > 0
      ? videoDurationMsInput
      : undefined;

  let mediaId = explicitMediaId;
  let matchedBy: 'explicit' | 'duration' = 'explicit';
  if (!mediaId) {
    const match = await matchReelByDuration(videoDurationMs);
    if (!match.mediaId) {
      // 409, not 500: nothing failed, we just can't tell which Reel this is.
      // Callers should surface the candidates rather than retry blindly.
      return NextResponse.json(
        {
          error: 'ambiguous match',
          reason: match.reason,
          chartDurationSec: parsed.videoDurationSec,
          candidates: match.candidates,
        },
        { status: 409 },
      );
    }
    mediaId = match.mediaId;
    matchedBy = 'duration';
  }

  const ext = extFor(file.type);
  const key = `analytics/retention/${mediaId}.${ext}`;

  let screenshotUrl: string | undefined;
  if (useR2()) {
    try {
      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET(),
          Key: key,
          Body: buf,
          ContentType: file.type,
        }),
      );
      screenshotUrl = r2PublicUrl(key);
    } catch (e: any) {
      return NextResponse.json(
        { error: `R2 upload failed: ${e?.message ?? e}` },
        { status: 500 },
      );
    }
  }

  const result = await ingestRetentionCurve({
    mediaId,
    curve: parsed.curve,
    videoDurationMs,
    caption: captionInput || undefined,
    notes: notes || parsed.notes,
    screenshotUrl,
    apiKey,
  });

  return NextResponse.json({
    ok: true,
    mediaId,
    matchedBy,
    curvePoints: parsed.curve.length,
    visionNotes: parsed.notes,
    framesExtracted: result.framesExtracted,
    framesSkippedReason: result.framesSkippedReason,
    post: result.post,
  });
}
