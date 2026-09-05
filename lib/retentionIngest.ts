/**
 * retentionIngest.ts
 *
 * The shared tail of every retention-data path (screenshot upload, and
 * the structured /api/analytics/retention-data endpoint fed by the
 * /sync-retention browser routine): store the curve on the post record,
 * invalidate the corpus, then fail-soft extract a frame per drop cliff
 * from the local source video with a Claude-vision description.
 */
import {
  mergePerformance,
  readAnalytics,
  upsertStubPerformance,
  type PostPerformance,
  type RetentionPoint,
} from './analyticsStore';
import { findDropCliffs, invalidateCorpusCache } from './performanceCorpus';
import { locateSourceVideo } from './sourceVideoLocator';
import { extractFramesForCliffs } from './retentionFrames';

export interface RetentionIngestResult {
  post: PostPerformance | null;
  framesExtracted: number;
  framesSkippedReason?: string;
}

export async function ingestRetentionCurve(input: {
  mediaId: string;
  curve: RetentionPoint[];
  videoDurationMs?: number;
  caption?: string;
  notes?: string;
  screenshotUrl?: string;
  apiKey: string;
}): Promise<RetentionIngestResult> {
  const { mediaId, curve, apiKey } = input;

  const store = await readAnalytics();
  let existing = store.posts.find((p) => p.mediaId === mediaId);
  if (!existing) {
    existing = await upsertStubPerformance({
      mediaId,
      caption: input.caption || undefined,
      videoDurationMs: input.videoDurationMs,
    });
  }

  const updated = await mergePerformance(mediaId, {
    retentionCurve: curve,
    retentionUploadedAt: new Date().toISOString(),
    ...(input.screenshotUrl ? { retentionScreenshotUrl: input.screenshotUrl } : {}),
    ...(input.notes ? { retentionNotes: input.notes } : {}),
    videoDurationMs: input.videoDurationMs ?? existing.videoDurationMs,
    caption: existing.caption || input.caption || '',
  });

  invalidateCorpusCache();

  // ── Retention frames (fail-soft) ─────────────────────────────────────
  // minSample 1: this is a single post's own curve — a cliff on it IS the
  // signal (the corpus-wide default of 3 is for cross-reel statistics).
  let framesExtracted = 0;
  let framesSkippedReason: string | undefined;
  try {
    const cliffs = findDropCliffs([curve], { minSample: 1 });
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
    ? (await readAnalytics()).posts.find((p) => p.mediaId === mediaId) ?? updated
    : updated;

  return { post: finalPost, framesExtracted, framesSkippedReason };
}

/** Pure validator for the structured retention-data body — exported so it
 *  is unit-testable without a Next request. */
export function validateRetentionBody(body: any): {
  ok: boolean;
  error?: string;
  curve?: RetentionPoint[];
  source?: 'ig-internal-api' | 'manual';
} {
  if (!body || typeof body !== 'object') return { ok: false, error: 'missing JSON body' };
  const source = body.source;
  if (source !== 'ig-internal-api' && source !== 'manual') {
    return { ok: false, error: "source must be 'ig-internal-api' or 'manual'" };
  }
  if (!Array.isArray(body.curve) || body.curve.length < 2) {
    return { ok: false, error: 'curve must be an array of at least 2 points' };
  }
  const curve: RetentionPoint[] = [];
  for (const pt of body.curve) {
    const sec = Number(pt?.sec);
    const pct = Number(pt?.pctViewers);
    if (!Number.isFinite(sec) || sec < 0) {
      return { ok: false, error: 'every curve point needs sec >= 0' };
    }
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { ok: false, error: 'every curve point needs pctViewers in 0-100' };
    }
    curve.push({ sec, pctViewers: pct });
  }
  curve.sort((a, b) => a.sec - b.sec);
  return { ok: true, curve, source };
}
