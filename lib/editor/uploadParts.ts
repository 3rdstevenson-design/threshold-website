/**
 * uploadParts.ts — bookkeeping for chunked, resumable uploads.
 *
 * Layout on disk (UPLOADS_ROOT = my-video-projects/data/uploads):
 *
 *   <uploadId>/manifest.json   { uploadId, name, size, category, chunkSize, ... }
 *   <uploadId>/parts/<N>.part  fully-written chunk N (N is 0-based)
 *   <uploadId>/parts/<N>.part.tmp  chunk being written; never counted
 *
 * `uploadId` is derived from the client's fingerprint (name + size) so an
 * interrupted upload can be resumed from another tab or after a reload:
 * `init` is idempotent and returns the part indexes already on disk.
 *
 * Pure helpers (`partCount`, `expectedPartBytes`, `missingParts`) are
 * exported for tests; the fs-touching functions take an explicit root so
 * tests can point them at a temp dir.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { Category } from './status';

/** 8 MiB: progress granularity of ~0.3-2s on LAN/Tailscale, a retry costs at
 *  most 8 MB, and mobile Safari slices File objects lazily so memory is flat.
 *  Returned by `init` so the client never hard-codes it. */
export const CHUNK_SIZE = 8 * 1024 * 1024;

/** Upload dirs older than this are swept on the next `init`. */
export const STALE_UPLOAD_MS = 48 * 60 * 60 * 1000;

export type UploadManifest = {
  uploadId: string;
  name: string;
  size: number;
  category: Category | null;
  chunkSize: number;
  createdAt: string;
  updatedAt: string;
};

export function uploadIdFor(fingerprint: string): string {
  return createHash('sha1').update(fingerprint).digest('hex').slice(0, 16);
}

export function isValidUploadId(id: string): boolean {
  return /^[a-f0-9]{16}$/.test(id);
}

export function partCount(size: number, chunkSize: number = CHUNK_SIZE): number {
  if (size <= 0) return 0;
  return Math.ceil(size / chunkSize);
}

/** Byte length chunk `index` must have; the last chunk carries the remainder. */
export function expectedPartBytes(
  index: number,
  size: number,
  chunkSize: number = CHUNK_SIZE,
): number {
  const n = partCount(size, chunkSize);
  if (index < 0 || index >= n) return -1;
  if (index < n - 1) return chunkSize;
  const rem = size - chunkSize * (n - 1);
  return rem;
}

export function missingParts(received: number[], size: number, chunkSize: number = CHUNK_SIZE): number[] {
  const have = new Set(received);
  const out: number[] = [];
  for (let i = 0; i < partCount(size, chunkSize); i++) if (!have.has(i)) out.push(i);
  return out;
}

// ── fs-backed store ──────────────────────────────────────────────────────────

export function uploadDir(root: string, id: string): string {
  return path.join(root, id);
}

export function manifestPath(root: string, id: string): string {
  return path.join(uploadDir(root, id), 'manifest.json');
}

export function partPath(root: string, id: string, index: number): string {
  return path.join(uploadDir(root, id), 'parts', `${index}.part`);
}

export function readManifest(root: string, id: string): UploadManifest | null {
  const p = manifestPath(root, id);
  if (!fs.existsSync(p)) return null;
  try {
    const m = JSON.parse(fs.readFileSync(p, 'utf-8')) as UploadManifest;
    return m && typeof m.size === 'number' ? m : null;
  } catch {
    return null;
  }
}

export function writeManifest(root: string, m: UploadManifest): void {
  const dir = uploadDir(root, m.uploadId);
  fs.mkdirSync(path.join(dir, 'parts'), { recursive: true });
  const p = manifestPath(root, m.uploadId);
  fs.writeFileSync(`${p}.tmp`, JSON.stringify(m, null, 2));
  fs.renameSync(`${p}.tmp`, p);
}

/** Part indexes whose fully-written `.part` file has the expected byte count. */
export function receivedParts(root: string, m: UploadManifest): number[] {
  const dir = path.join(uploadDir(root, m.uploadId), 'parts');
  if (!fs.existsSync(dir)) return [];
  const out: number[] = [];
  for (const f of fs.readdirSync(dir)) {
    const mt = /^(\d+)\.part$/.exec(f);
    if (!mt) continue;
    const idx = Number(mt[1]);
    const want = expectedPartBytes(idx, m.size, m.chunkSize);
    if (want < 0) continue;
    try {
      if (fs.statSync(path.join(dir, f)).size === want) out.push(idx);
    } catch {
      /* ignore */
    }
  }
  return out.sort((a, b) => a - b);
}

export function removeUpload(root: string, id: string): void {
  fs.rmSync(uploadDir(root, id), { recursive: true, force: true });
}

/** Delete upload dirs whose manifest is older than STALE_UPLOAD_MS. */
export function sweepStaleUploads(root: string, now: number = Date.now()): string[] {
  if (!fs.existsSync(root)) return [];
  const removed: string[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || !isValidUploadId(e.name)) continue;
    const m = readManifest(root, e.name);
    const ts = m ? Date.parse(m.updatedAt || m.createdAt) : 0;
    if (!m || !Number.isFinite(ts) || now - ts > STALE_UPLOAD_MS) {
      removeUpload(root, e.name);
      removed.push(e.name);
    }
  }
  return removed;
}

/**
 * Stream every part, in order, into `dest`. Throws if any part is missing
 * or the assembled byte count differs from the manifest. Writes to a `.tmp`
 * sibling and renames so a crash never leaves a half source.mp4 behind.
 */
export async function assembleParts(root: string, m: UploadManifest, dest: string): Promise<void> {
  const missing = missingParts(receivedParts(root, m), m.size, m.chunkSize);
  if (missing.length > 0) {
    throw new Error(`upload incomplete: missing part(s) ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  const out = fs.createWriteStream(tmp);
  try {
    for (let i = 0; i < partCount(m.size, m.chunkSize); i++) {
      await new Promise<void>((resolve, reject) => {
        const rs = fs.createReadStream(partPath(root, m.uploadId, i));
        rs.on('error', reject);
        rs.on('end', resolve);
        rs.pipe(out, { end: false });
      });
    }
    await new Promise<void>((resolve, reject) => {
      out.on('error', reject);
      out.end(resolve);
    });
  } catch (e) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  const got = fs.statSync(tmp).size;
  if (got !== m.size) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`assembled ${got} bytes, expected ${m.size}`);
  }
  fs.renameSync(tmp, dest);
}
