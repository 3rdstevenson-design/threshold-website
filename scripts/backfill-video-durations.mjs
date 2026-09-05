#!/usr/bin/env node
/**
 * backfill-video-durations.mjs — local duration backfill.
 *
 * Graph API v22 dropped video_duration, so completionRate (avg watch
 * time / duration) can't be computed from the API alone. This script
 * fills videoDurationMs for reels that are missing it by locating each
 * post's rendered .mp4 (editor project or Reels/Final) and ffprobing
 * its duration, then re-deriving completionRate. Local-only (the videos
 * live on this machine). Idempotent; run any time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of fs.readFileSync(path.join(repoRoot, '.env.local'), 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const { readAnalytics, writeAnalytics, withDerivedCompletionRate } = await import('../lib/analyticsStore.ts');
const { locateSourceVideo } = await import('../lib/sourceVideoLocator.ts');
const { probeDurationSec } = await import('../lib/editor/ffmpeg.ts');

const store = await readAnalytics();
const candidates = store.posts.filter(
  (p) =>
    (p.mediaType === 'REELS' || p.mediaType === 'VIDEO') &&
    !(typeof p.videoDurationMs === 'number' && p.videoDurationMs > 0),
);
console.log(`${candidates.length} video posts missing duration.`);

let filled = 0;
let derived = 0;
for (const post of candidates) {
  try {
    const located = await locateSourceVideo({
      mediaId: post.mediaId,
      slug: post.slug,
      queuePostId: post.queuePostId,
    });
    if (!located) continue;
    try {
      const sec = await probeDurationSec(located.absPath);
      if (sec > 0) {
        post.videoDurationMs = Math.round(sec * 1000);
        filled++;
        const before = post.completionRate;
        Object.assign(post, withDerivedCompletionRate(post));
        if (typeof post.completionRate === 'number' && before === undefined) derived++;
      }
    } finally {
      located.cleanup?.();
    }
  } catch (e) {
    console.warn(`${post.mediaId}: ${e?.message ?? e}`);
  }
}

if (filled > 0) {
  store.lastSyncedAt = new Date().toISOString();
  await writeAnalytics(store);
}
console.log(`Filled ${filled} durations; derived ${derived} completion rates.`);
