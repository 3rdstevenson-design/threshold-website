import fs from 'fs';
import path from 'path';
import { PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, r2PublicUrl } from './r2';

function contentTypeFor(ext: string): string {
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

/**
 * `instagram/` carries a 30-day expiration lifecycle rule (scripts/set-r2-lifecycle.mjs)
 * because auto-published media is transit-only. Manual-post media is NOT transit: the
 * `story-*` loop/timelapse reels sit in the queue for months waiting on their scheduled
 * hand-off, so objects under `instagram/` expired out from under them and the Telegram
 * hand-off died on a 404 (2026-08-05). Those go under `manual/`, which has no rule.
 * Keep this prefix out of any lifecycle/orphan-sweep scope.
 */
function prefixFor(filename: string): string {
  return /^story-/i.test(filename) ? 'manual/' : 'instagram/';
}

export async function uploadFile(filePath: string, filename: string): Promise<string> {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const ext = path.extname(filename).toLowerCase();
  const key = `${prefixFor(filename)}${Date.now()}-${filename}`;
  const body = fs.readFileSync(filePath);

  // Retry, and VERIFY the object landed at full size. R2 has silently stored
  // TRUNCATED objects (a partial body still returns a URL) — the file plays its
  // header but not its data. Sending ContentLength lets R2 reject a short body,
  // and the HeadObject check catches any truncation before we trust the URL.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET(),
        Key: key,
        Body: body,
        ContentType: contentTypeFor(ext),
        ContentLength: body.length,
      }));
      const head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET(), Key: key }));
      if (head.ContentLength === body.length) return r2PublicUrl(key);
      lastErr = new Error(`stored ${head.ContentLength} of ${body.length} bytes (truncated)`);
    } catch (e) {
      lastErr = e;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  throw new Error(`R2 upload failed for ${filename} after 3 attempts: ${(lastErr as Error)?.message ?? String(lastErr)}`);
}

export async function uploadFiles(filePaths: string[]): Promise<string[]> {
  return Promise.all(
    filePaths.map((filePath) => uploadFile(filePath, path.basename(filePath)))
  );
}
