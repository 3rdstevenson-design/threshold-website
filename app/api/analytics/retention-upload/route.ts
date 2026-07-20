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
 *   1. Resolve mediaId (either direct or via reelUrl shortcode decode).
 *   2. Stash the screenshot in R2 under analytics/retention/<mediaId>.<ext>.
 *   3. Call Claude vision to extract {curve, videoDurationSec, notes}.
 *   4. Merge the curve + screenshot URL into analytics. If the post isn't
 *      there yet, create a stub record with manualEntry: true so the next
 *      sync cron upgrades it with real metrics.
 *   5. Detect drop cliffs. If a local source video can be located, extract
 *      a frame per cliff + get a one-shot Claude vision description.
 *   6. Invalidate the performance-corpus cache.
 */
import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, r2PublicUrl, useR2 } from '@/lib/r2';
import { parseRetentionScreenshot } from '@/lib/retentionParser';
import {
  mergePerformance,
  readAnalytics,
  upsertStubPerformance,
  type PostPerformance,
} from '@/lib/analyticsStore';
import { findDropCliffs, invalidateCorpusCache } from '@/lib/performanceCorpus';
import { locateSourceVideo } from '@/lib/sourceVideoLocator';
import { extractFramesForCliffs } from '@/lib/retentionFrames';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const SHORTCODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function extFor(mediaType: string): string {
  if (mediaType === 'image/png') return 'png';
  if (mediaType === 'image/webp') return 'webp';
  return 'jpg';
}

/**
 * Decode an Instagram shortcode to the numeric media pk. Uses the standard
 * base64 alphabet (A-Z, a-z, 0-9, -, _). The pk is the first 11 chars for
 * Reels; we decode the full shortcode for safety and stringify as decimal.
 */
function shortcodeToMediaId(shortcode: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(shortcode)) return null;
  let n = BigInt(0);
  const radix = BigInt(64);
  for (let i = 0; i < shortcode.length; i++) {
    const idx = SHORTCODE_ALPHABET.indexOf(shortcode.charAt(i));
    if (idx < 0) return null;
    n = n * radix + BigInt(idx);
  }
  return n.toString();
}

function extractShortcode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:reel|p|reels)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

function resolveMediaId(input: { mediaId?: string; reelUrl?: string }): string | null {
  const direct = input.mediaId?.trim();
  if (direct) {
    if (/^\d{10,}$/.test(direct)) return direct;
    // Accept a raw shortcode too.
    if (/^[A-Za-z0-9_-]{5,}$/.test(direct)) {
      const decoded = shortcodeToMediaId(direct);
      if (decoded) return decoded;
    }
  }
  const url = input.reelUrl?.trim();
  if (url) {
    const sc = extractShortcode(url);
    if (sc) return shortcodeToMediaId(sc);
    if (/^\d{10,}$/.test(url)) return url;
  }
  return null;
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
  const mediaId = resolveMediaId({ mediaId: rawMediaId, reelUrl });
  if (!mediaId) {
    return NextResponse.json(
      { error: 'missing mediaId — provide a numeric id or a Reel URL' },
      { status: 400 },
    );
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `unsupported file type ${file.type}; use PNG, JPEG, or WebP` },
      { status: 400 },
    );
  }

  const store = await readAnalytics();
  let existing = store.posts.find((p) => p.mediaId === mediaId);
  if (!existing) {
    existing = await upsertStubPerformance({
      mediaId,
      caption: captionInput || undefined,
      videoDurationMs: Number.isFinite(videoDurationMsInput) && videoDurationMsInput > 0
        ? videoDurationMsInput
        : undefined,
    });
  }

  const buf = Buffer.from(await file.arrayBuffer());
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
      : existing.videoDurationMs;

  const updated = await mergePerformance(mediaId, {
    retentionCurve: parsed.curve,
    retentionScreenshotUrl: screenshotUrl,
    retentionUploadedAt: new Date().toISOString(),
    retentionNotes: notes || parsed.notes,
    videoDurationMs,
    caption: existing.caption || captionInput || '',
  });

  invalidateCorpusCache();

  // ── Retention frames (fail-soft) ─────────────────────────────────────
  let framesExtracted = 0;
  let framesSkippedReason: string | undefined;
  try {
    const cliffs = findDropCliffs([parsed.curve]);
    if (cliffs.length === 0) {
      framesSkippedReason = 'no drop cliffs detected';
    } else {
      const located = await locateSourceVideo({
        mediaId,
        slug: updated?.slug,
        queuePostId: updated?.queuePostId,
      });
      if (!located) {
        framesSkippedReason = 'source video not found';
      } else {
        try {
          const frames = await extractFramesForCliffs({
            mediaId,
            slug: updated?.slug,
            videoAbsPath: located.absPath,
            cliffs: cliffs.map((c) => ({ secondRange: c.secondRange })),
            apiKey,
          });
          if (frames.length > 0) {
            await mergePerformance(mediaId, { retentionFrames: frames });
            framesExtracted = frames.length;
            invalidateCorpusCache();
          } else {
            framesSkippedReason = 'frame extraction returned no frames';
          }
        } finally {
          located.cleanup?.();
        }
      }
    }
  } catch (e: any) {
    framesSkippedReason = `frame extraction threw: ${e?.message ?? e}`;
    console.warn(framesSkippedReason);
  }

  const finalPost = framesExtracted > 0
    ? (await readAnalytics()).posts.find((p) => p.mediaId === mediaId)
    : updated;

  return NextResponse.json({
    ok: true,
    mediaId,
    curvePoints: parsed.curve.length,
    visionNotes: parsed.notes,
    framesExtracted,
    framesSkippedReason,
    post: finalPost,
  });
}
