import fs from 'fs';
import path from 'path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, r2PublicUrl } from './r2';

function contentTypeFor(ext: string): string {
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

export async function uploadFile(filePath: string, filename: string): Promise<string> {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const ext = path.extname(filename).toLowerCase();
  const key = `instagram/${Date.now()}-${filename}`;

  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET(),
    Key: key,
    Body: fs.readFileSync(filePath),
    ContentType: contentTypeFor(ext),
  }));

  return r2PublicUrl(key);
}

export async function uploadFiles(filePaths: string[]): Promise<string[]> {
  return Promise.all(
    filePaths.map((filePath) => uploadFile(filePath, path.basename(filePath)))
  );
}
