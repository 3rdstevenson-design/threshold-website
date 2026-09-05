/**
 * POST /api/editor/upload/[id]/finish
 *
 * Verifies every part is present, assembles them into
 * data/takes/<slug>/source.mp4, registers the project (status, plan, thumb)
 * and removes the staging dir. Response matches the legacy upload route:
 * { slug, category, durationSec, codec, hasAnalysis: false, categorySource }.
 *
 * DELETE /api/editor/upload/[id] cancels an in-progress upload.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { checkAuth, TAKES_ROOT, UPLOADS_ROOT } from '@/lib/editor/paths';
import { assembleParts, isValidUploadId, readManifest, removeUpload } from '@/lib/editor/uploadParts';
import { registerSource, slugForUpload } from '@/lib/editor/registerSource';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;

  const id = params.id;
  if (!isValidUploadId(id)) return NextResponse.json({ error: 'bad upload id' }, { status: 400 });
  const manifest = readManifest(UPLOADS_ROOT, id);
  if (!manifest) return NextResponse.json({ error: 'unknown upload — call init first' }, { status: 404 });

  const slug = slugForUpload(manifest.name);
  const sourcePath = path.join(TAKES_ROOT, slug, 'source.mp4');
  try {
    await assembleParts(UPLOADS_ROOT, manifest, sourcePath);
  } catch (e) {
    fs.rmSync(path.join(TAKES_ROOT, slug), { recursive: true, force: true });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }

  try {
    const r = await registerSource({ slug, sourcePath, category: manifest.category });
    removeUpload(UPLOADS_ROOT, id);
    return NextResponse.json({ ...r, hasAnalysis: false });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), slug }, { status: 500 });
  }
}
