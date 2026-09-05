/**
 * PUT /api/editor/upload/[id]/chunk?index=N
 *
 * Body: raw bytes of chunk N (application/octet-stream). Streamed straight to
 * parts/N.part.tmp and renamed on completion, so a killed request never
 * leaves a truncated part that `init` would count as received.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { checkAuth, UPLOADS_ROOT } from '@/lib/editor/paths';
import {
  expectedPartBytes,
  isValidUploadId,
  partPath,
  readManifest,
  writeManifest,
} from '@/lib/editor/uploadParts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;

  const id = params.id;
  if (!isValidUploadId(id)) return NextResponse.json({ error: 'bad upload id' }, { status: 400 });
  const manifest = readManifest(UPLOADS_ROOT, id);
  if (!manifest) return NextResponse.json({ error: 'unknown upload — call init first' }, { status: 404 });

  const index = Number(new URL(req.url).searchParams.get('index'));
  const want = Number.isInteger(index) ? expectedPartBytes(index, manifest.size, manifest.chunkSize) : -1;
  if (want < 0) return NextResponse.json({ error: 'index out of range' }, { status: 400 });
  if (!req.body) return NextResponse.json({ error: 'empty body' }, { status: 400 });

  const dest = partPath(UPLOADS_ROOT, id, index);
  const tmp = `${dest}.tmp`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    await pipeline(
      Readable.fromWeb(req.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
      fs.createWriteStream(tmp),
    );
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    return NextResponse.json({ error: `write failed: ${e instanceof Error ? e.message : e}` }, { status: 500 });
  }
  const got = fs.statSync(tmp).size;
  if (got !== want) {
    fs.rmSync(tmp, { force: true });
    return NextResponse.json({ error: `chunk ${index}: got ${got} bytes, expected ${want}` }, { status: 400 });
  }
  fs.renameSync(tmp, dest);
  writeManifest(UPLOADS_ROOT, { ...manifest, updatedAt: new Date().toISOString() });
  return NextResponse.json({ index, bytes: got });
}
