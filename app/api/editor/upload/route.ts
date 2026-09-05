/**
 * POST /api/editor/upload — legacy single-request upload.
 *
 * multipart/form-data with:
 *   - file      : the video file (required)
 *   - category  : 'talking-head' | 'long-form' (optional; omitted = auto by
 *                 duration, see registerSource)
 *
 * Kept for small files and scripts. The editor UI now uses the chunked,
 * resumable flow (/api/editor/upload/init → [id]/chunk → [id]/finish), which
 * streams to disk part by part; this route has to materialize the multipart
 * body via req.formData() first, so it is not suitable for multi-GB sources.
 *
 * Does NOT run analysis synchronously — the client then POSTs to
 * /api/editor/project/[slug]/process which branches on category.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { checkAuth, TAKES_ROOT } from '@/lib/editor/paths';
import type { Category } from '@/lib/editor/status';
import { registerSource, slugForUpload } from '@/lib/editor/registerSource';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 900;

export async function POST(req: NextRequest) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing file' }, { status: 400 });
  }

  const rawCategory = form.get('category');
  const category: Category | null =
    rawCategory === 'long-form' ? 'long-form'
    : rawCategory === 'talking-head' ? 'talking-head'
    : null;

  const slug = slugForUpload(file.name);
  const slugDir = path.join(TAKES_ROOT, slug);
  fs.mkdirSync(slugDir, { recursive: true });
  const sourcePath = path.join(slugDir, 'source.mp4');
  await pipeline(
    Readable.fromWeb(file.stream() as unknown as Parameters<typeof Readable.fromWeb>[0]),
    fs.createWriteStream(sourcePath),
  );

  try {
    const r = await registerSource({ slug, sourcePath, category });
    return NextResponse.json({ ...r, hasAnalysis: false });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), slug }, { status: 500 });
  }
}
