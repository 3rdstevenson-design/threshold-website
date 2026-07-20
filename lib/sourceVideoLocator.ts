/**
 * sourceVideoLocator.ts
 *
 * Resolves a `PostPerformance` record to the absolute path of its rendered
 * `.mp4`. Used by the retention-upload + reextract endpoints so we can run
 * ffmpeg thumbnail extraction against the *actual* source a viewer saw.
 *
 * Priority:
 *   1. TAKES_ROOT/<slug>/final.mp4 — editor's source-of-truth render
 *   2. VIDEO_OUT_DIR/<slug>.mp4   — watch-renders copy alongside Drafts
 *   3. Download from the R2 key encoded in QueuePost.videoUrl into a temp
 *      file (used only when the local copy has been GC'd).
 *
 * Returns { absPath, source, cleanup? } or null. The caller MUST call
 * `cleanup()` when source === 'r2' to remove the temp file.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GetObjectCommand } from '@aws-sdk/client-s3';

import { TAKES_ROOT, VIDEO_OUT_DIR } from './editor/paths';
import { r2, R2_BUCKET, useR2 } from './r2';
import { readQueue } from './queue';

export type VideoSource = 'takes' | 'out' | 'r2';

export interface LocatedVideo {
  absPath: string;
  source: VideoSource;
  cleanup?: () => void;
}

export async function locateSourceVideo(input: {
  mediaId: string;
  slug?: string;
  queuePostId?: string;
}): Promise<LocatedVideo | null> {
  const { slug, mediaId, queuePostId } = input;

  if (slug) {
    const takesPath = path.join(TAKES_ROOT, slug, 'final.mp4');
    if (fs.existsSync(takesPath)) {
      return { absPath: takesPath, source: 'takes' };
    }
    const outPath = path.join(VIDEO_OUT_DIR, `${slug}.mp4`);
    if (fs.existsSync(outPath)) {
      return { absPath: outPath, source: 'out' };
    }
  }

  // Fallback: pull from R2 using the queue record's videoUrl.
  if (!useR2()) return null;
  try {
    const queue = await readQueue();
    const post = queue.find((p) =>
      (queuePostId && p.id === queuePostId) ||
      (slug && p.slug === slug) ||
      (slug && p.notes === `${slug}.mp4`),
    );
    if (!post?.videoUrl) return null;
    const key = extractR2Key(post.videoUrl);
    if (!key) return null;

    const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET(), Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) return null;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `retention-src-${mediaId}-`));
    const tmpPath = path.join(tmpDir, 'source.mp4');
    fs.writeFileSync(tmpPath, bytes);
    return {
      absPath: tmpPath,
      source: 'r2',
      cleanup: () => {
        try { fs.unlinkSync(tmpPath); } catch {}
        try { fs.rmdirSync(tmpDir); } catch {}
      },
    };
  } catch {
    return null;
  }
}

function extractR2Key(videoUrl: string): string | null {
  const publicBase = process.env.R2_PUBLIC_URL;
  if (publicBase && videoUrl.startsWith(publicBase)) {
    return videoUrl.slice(publicBase.length).replace(/^\/+/, '');
  }
  try {
    const u = new URL(videoUrl);
    return u.pathname.replace(/^\/+/, '');
  } catch {
    return null;
  }
}
