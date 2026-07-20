/**
 * Shared helper: given a slug, find the actual source video file on disk.
 * Handles both new uploads (data/takes/<slug>/source.mp4) and legacy
 * pipeline projects whose analysis.json points at the original file.
 *
 * Server-only — uses fs.
 */
import * as fs from 'fs';
import * as path from 'path';
import { TAKES_ROOT, VIDEO_PROJECT_ROOT } from './paths';

export function resolveSource(slug: string): string | null {
  const slugDir = path.join(TAKES_ROOT, slug);
  const direct = path.join(slugDir, 'source.mp4');
  if (fs.existsSync(direct)) return direct;
  const analysisPath = path.join(slugDir, 'analysis.json');
  if (!fs.existsSync(analysisPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(analysisPath, 'utf-8'));
    if (typeof parsed.videoPath === 'string') {
      const abs = path.resolve(VIDEO_PROJECT_ROOT, parsed.videoPath);
      if (fs.existsSync(abs)) return abs;
    }
  } catch {}
  return null;
}
