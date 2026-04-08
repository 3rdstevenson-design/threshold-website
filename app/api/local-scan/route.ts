import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export interface LocalFile {
  id: string; // stable key: type + relative path
  type: 'reel' | 'carousel';
  name: string; // display name
  filePath: string; // absolute path (for upload)
  previewUrl: string; // /api/media?url=file://... for video, same for image
  slideCount?: number; // carousel only
  slidePaths?: string[]; // carousel only
  captionHint?: string; // from caption.txt if present
  sizeMB?: number;
}

function findVideoDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '../my-video-projects/out'),
    path.resolve(process.cwd(), '../../my-video-projects/out'),
  ];
  return candidates.find(fs.existsSync) ?? null;
}

function findCarouselDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '../threshold-carousel/output'),
    path.resolve(process.cwd(), '../../threshold-carousel/output'),
  ];
  return candidates.find(fs.existsSync) ?? null;
}

export async function GET() {
  const results: LocalFile[] = [];

  // ── Reels (MP4s) ──────────────────────────────────────────────────────────
  const videoDir = findVideoDir();
  if (videoDir) {
    const mp4s = fs.readdirSync(videoDir)
      .filter(f => f.endsWith('.mp4'))
      .map(f => {
        const abs = path.join(videoDir, f);
        return { name: f, abs, mtime: fs.statSync(abs).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime); // newest first

    for (const { name, abs } of mp4s) {
      const sizeMB = fs.statSync(abs).size / 1024 / 1024;
      results.push({
        id: `reel:${name}`,
        type: 'reel',
        name,
        filePath: abs,
        previewUrl: `/api/media?url=${encodeURIComponent('file://' + abs)}`,
        sizeMB: Math.round(sizeMB * 10) / 10,
      });
    }
  }

  // ── Carousels (subfolders with slide PNGs) ────────────────────────────────
  const carouselDir = findCarouselDir();
  if (carouselDir) {
    const folders = fs.readdirSync(carouselDir)
      .filter(f => {
        if (f === 'temp') return false;
        const abs = path.join(carouselDir, f);
        return fs.statSync(abs).isDirectory();
      })
      .map(f => {
        const abs = path.join(carouselDir, f);
        return { name: f, abs, mtime: fs.statSync(abs).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime); // newest first

    for (const { name, abs } of folders) {
      const slides = fs.readdirSync(abs)
        .filter(f => /^slide-\d+\.png$/.test(f))
        .sort()
        .map(f => path.join(abs, f));

      if (slides.length === 0) continue;

      let captionHint: string | undefined;
      const captionPath = path.join(abs, 'caption.txt');
      if (fs.existsSync(captionPath)) {
        captionHint = fs.readFileSync(captionPath, 'utf-8').trim() || undefined;
      }

      results.push({
        id: `carousel:${name}`,
        type: 'carousel',
        name,
        filePath: abs,
        previewUrl: `/api/media?url=${encodeURIComponent('file://' + slides[0])}`,
        slideCount: slides.length,
        slidePaths: slides,
        captionHint,
      });
    }
  }

  return NextResponse.json(results);
}
