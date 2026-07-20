/**
 * POST /api/editor/upload
 *
 * multipart/form-data with:
 *   - file      : the video file (required)
 *   - category  : 'talking-head' | 'long-form' (optional, defaults to
 *                 'talking-head' for backwards compatibility)
 *
 * Saves the file to data/takes/<slug>/source.mp4, writes status.json
 * (including the category so the editor UI can route the project to the
 * correct tab + pipeline branch), returns { slug, category }.
 *
 * Does NOT run analysis synchronously — the client should then POST to
 * /api/editor/project/[slug]/process which branches on category:
 *   - talking-head → transcribe + silence/filler/caption + polish
 *   - long-form    → transcribe + diarize + propose-clips
 */
import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { checkAuth, validateSlug, TAKES_ROOT, VIDEO_PROJECT_ROOT } from '@/lib/editor/paths';
import { writeStatus, type Category } from '@/lib/editor/status';
import { probeDurationSec, probeVideoCodec, extractThumb } from '@/lib/editor/ffmpeg';
import { createPlan } from '@/lib/editor/editPlan';
import { writePlan } from '@/lib/editor/planStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Long-form uploads can be 2-5 GB; bump to 15 min so the multipart body
// has time to stream through even on slow writes. Recommend the
// ~/Videos/LongForm-Inbox/ watch folder for reliability at that size.
export const maxDuration = 900;

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return `${base || 'clip'}-${stamp}`;
}

export async function POST(req: NextRequest) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing file' }, { status: 400 });
  }

  const rawCategory = form.get('category');
  const category: Category =
    rawCategory === 'long-form' ? 'long-form' : 'talking-head';

  const slug = slugify(file.name);
  if (!validateSlug(slug)) {
    return NextResponse.json({ error: 'could not derive a valid slug' }, { status: 400 });
  }

  const slugDir = path.join(TAKES_ROOT, slug);
  fs.mkdirSync(slugDir, { recursive: true });

  const sourcePath = path.join(slugDir, 'source.mp4');
  // Stream the upload straight to disk instead of buffering the whole file
  // in memory + a synchronous write. A large (multi-hundred-MB) video would
  // otherwise block the single Node event loop and can OOM under load.
  await pipeline(
    Readable.fromWeb(file.stream() as unknown as Parameters<typeof Readable.fromWeb>[0]),
    fs.createWriteStream(sourcePath),
  );

  writeStatus(slug, {
    sourcePath: path.relative(VIDEO_PROJECT_ROOT, sourcePath),
    category,
  });

  // Probe basic info. Talking-head projects get an initial edit plan
  // seeded now; long-form projects skip the plan — they don't use one.
  let duration = 0;
  let codec = '';
  try {
    duration = await probeDurationSec(sourcePath);
    codec = await probeVideoCodec(sourcePath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeStatus(slug, { error: msg });
    return NextResponse.json({ error: `ffprobe failed: ${msg}` }, { status: 500 });
  }

  if (category === 'talking-head') {
    const plan = createPlan({
      slug,
      sourceVideo: path.relative(VIDEO_PROJECT_ROOT, sourcePath),
      sourceDuration: duration,
    });
    writePlan(plan);
  }

  writeStatus(slug, {
    durationSec: duration,
  });

  // Kick off a thumbnail in the background (best-effort, non-blocking).
  // For long-form, use a later timestamp so the thumb shows an actual
  // speaker frame rather than a blank intro.
  const thumbAt = category === 'long-form'
    ? Math.min(60, duration / 3)
    : Math.min(2, Math.max(0.5, duration / 3));
  extractThumb(sourcePath, path.join(slugDir, 'thumb.jpg'), thumbAt).catch(() => {});

  return NextResponse.json({
    slug,
    category,
    durationSec: duration,
    codec,
    hasAnalysis: false,
  });
}
