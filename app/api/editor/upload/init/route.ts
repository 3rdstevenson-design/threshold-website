/**
 * POST /api/editor/upload/init
 *
 * Body: { name, size, category?: 'talking-head' | 'long-form' | null, fingerprint }
 * → { uploadId, chunkSize, received: number[], partCount }
 *
 * Idempotent: the uploadId is derived from the fingerprint (name + size),
 * so re-calling init for an interrupted upload returns the parts already on
 * disk and the client resumes from there. A manifest whose size differs from
 * the request (the file was re-exported) is discarded and started fresh.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkAuth, UPLOADS_ROOT } from '@/lib/editor/paths';
import {
  CHUNK_SIZE,
  partCount,
  readManifest,
  receivedParts,
  removeUpload,
  sweepStaleUploads,
  uploadIdFor,
  writeManifest,
  type UploadManifest,
} from '@/lib/editor/uploadParts';
import type { Category } from '@/lib/editor/status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = { name?: unknown; size?: unknown; category?: unknown; fingerprint?: unknown };

export async function POST(req: NextRequest) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;

  let body: Body = {};
  try { body = (await req.json()) as Body; } catch { body = {}; }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const size = typeof body.size === 'number' && Number.isFinite(body.size) ? Math.floor(body.size) : -1;
  const fingerprint = typeof body.fingerprint === 'string' && body.fingerprint ? body.fingerprint : `${name}:${size}`;
  const category: Category | null =
    body.category === 'long-form' ? 'long-form'
    : body.category === 'talking-head' ? 'talking-head'
    : null;

  if (!name || size <= 0) {
    return NextResponse.json({ error: 'name and a positive size are required' }, { status: 400 });
  }

  try { sweepStaleUploads(UPLOADS_ROOT); } catch { /* best effort */ }

  const uploadId = uploadIdFor(fingerprint);
  const now = new Date().toISOString();
  let manifest = readManifest(UPLOADS_ROOT, uploadId);
  if (manifest && manifest.size !== size) {
    removeUpload(UPLOADS_ROOT, uploadId);
    manifest = null;
  }
  if (!manifest) {
    manifest = { uploadId, name, size, category, chunkSize: CHUNK_SIZE, createdAt: now, updatedAt: now };
  } else {
    manifest = { ...manifest, name, category: category ?? manifest.category, updatedAt: now };
  }
  writeManifest(UPLOADS_ROOT, manifest satisfies UploadManifest);

  return NextResponse.json({
    uploadId,
    chunkSize: manifest.chunkSize,
    partCount: partCount(size, manifest.chunkSize),
    received: receivedParts(UPLOADS_ROOT, manifest),
  });
}
