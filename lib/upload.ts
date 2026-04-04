import fs from 'fs';
import path from 'path';
import { put } from '@vercel/blob';

/**
 * Upload a single local file to Vercel Blob and return its public URL.
 */
export async function uploadFile(filePath: string, filename: string): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set. Check your .env.local file.');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filename).toLowerCase();
  const contentType = ext === '.mp4' ? 'video/mp4'
    : ext === '.png' ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : 'application/octet-stream';

  const blob = await put(`instagram/${filename}`, fileBuffer, {
    access: 'public',
    contentType,
    addRandomSuffix: true,
  });

  return blob.url;
}

/**
 * Upload multiple files in parallel. Returns URLs in the same order as input.
 */
export async function uploadFiles(filePaths: string[]): Promise<string[]> {
  return Promise.all(
    filePaths.map((filePath) => uploadFile(filePath, path.basename(filePath)))
  );
}
