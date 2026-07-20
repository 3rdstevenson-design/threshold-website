import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * localScan.ts — filesystem scan for finished renders, shared by
 * /api/local-scan (the queue page's auto-populate source) and /api/pipeline
 * (the health view). Extracted from the route so both read the same truth.
 */

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
  mtimeMs: number;
}

export const VIDEO_DIR = path.join(os.homedir(), 'Code', 'Social Media', 'Reels', 'Final');
export const CAROUSEL_DIR = path.join(os.homedir(), 'Code', 'Social Media', 'Carousels', 'Final');

export function scanLocalFiles(): LocalFile[] {
  const results: LocalFile[] = [];

  // ── Reels (MP4s) ──────────────────────────────────────────────────────────
  if (fs.existsSync(VIDEO_DIR)) {
    const mp4s = fs.readdirSync(VIDEO_DIR)
      .filter(f => /\.(mp4|mov)$/i.test(f))
      .map(f => {
        const abs = path.join(VIDEO_DIR, f);
        return { name: f, abs, mtime: fs.statSync(abs).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime); // newest first

    for (const { name, abs, mtime } of mp4s) {
      const sizeMB = fs.statSync(abs).size / 1024 / 1024;
      results.push({
        id: `reel:${name}`,
        type: 'reel',
        name,
        filePath: abs,
        previewUrl: `/api/media?url=${encodeURIComponent('file://' + abs)}`,
        sizeMB: Math.round(sizeMB * 10) / 10,
        mtimeMs: mtime,
      });
    }
  }

  // ── Carousels (subfolders with slide PNGs) ────────────────────────────────
  if (fs.existsSync(CAROUSEL_DIR)) {
    const folders = fs.readdirSync(CAROUSEL_DIR)
      .filter(f => {
        // Skip scratch dirs — the carousel generator's real scratch dir is
        // `.temp` (the old check only matched `temp`) — and any hidden dir.
        if (f === 'temp' || f.startsWith('.')) return false;
        const abs = path.join(CAROUSEL_DIR, f);
        return fs.statSync(abs).isDirectory();
      })
      .map(f => {
        const abs = path.join(CAROUSEL_DIR, f);
        return { name: f, abs, mtime: fs.statSync(abs).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime); // newest first

    for (const { name, abs, mtime } of folders) {
      // Any image file in the folder is treated as a slide. We don't try
      // to match slide-naming conventions — too many tools, too many
      // patterns. Skip hidden files (e.g. .DS_Store) and intermediate
      // "-raw" files produced by the threshold-carousel generator.
      const slides = fs.readdirSync(abs)
        .filter(f => {
          if (f.startsWith('.')) return false;
          if (!/\.(png|jpe?g)$/i.test(f)) return false;
          if (/-raw\.[a-z]+$/i.test(f)) return false;
          return true;
        })
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
        mtimeMs: mtime,
      });
    }
  }

  return results;
}
