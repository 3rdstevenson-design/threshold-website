/**
 * POST /api/cover  { id, timeMs }
 *
 * Grab a single frame from a reel at `timeMs` and set it as the post's
 * coverImageUrl. That field is already wired through to the queue thumbnail
 * (video poster) AND the Instagram cover (publishReelPost → cover_url), so
 * this is the only missing piece: produce + host the chosen frame.
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { readQueue, updatePost } from '@/lib/queue';
import { resolveDraftFile } from '@/lib/transcribe';
import { uploadFile } from '@/lib/upload';

export async function POST(req: NextRequest) {
  let tmp: string | null = null;
  try {
    const { id, timeMs } = await req.json();
    if (!id || typeof timeMs !== 'number' || !Number.isFinite(timeMs)) {
      return NextResponse.json({ error: 'id and numeric timeMs are required' }, { status: 400 });
    }

    const post = (await readQueue()).find((p) => p.id === id);
    if (!post) return NextResponse.json({ error: 'post not found' }, { status: 404 });
    if (post.type !== 'reel') {
      return NextResponse.json({ error: 'cover frames are only for reels' }, { status: 400 });
    }

    // Prefer the local source (Reels/Final) for a fast, exact grab; fall back
    // to the public videoUrl — ffmpeg can seek an https input too.
    const local = post.notes ? resolveDraftFile(post.notes) : null;
    const source = local ?? post.videoUrl ?? null;
    if (!source) {
      return NextResponse.json({ error: 'no video source found for this post' }, { status: 404 });
    }

    const sec = Math.max(0, timeMs / 1000);
    tmp = path.join(os.tmpdir(), `cover-${id}-${Date.now()}.jpg`);

    // execFile (not a shell) so the source path/URL can't be a command-injection vector.
    try {
      execFileSync(
        'ffmpeg',
        ['-y', '-ss', String(sec), '-i', source, '-frames:v', '1', '-q:v', '2', tmp],
        { stdio: 'ignore' },
      );
    } catch {
      return NextResponse.json(
        { error: 'ffmpeg could not grab that frame (ffmpeg missing, or source unreachable).' },
        { status: 500 },
      );
    }

    if (!fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
      return NextResponse.json(
        { error: 'No frame at that time — try a moment earlier (it may be past the end).' },
        { status: 422 },
      );
    }

    const base = (post.notes || String(id)).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const coverImageUrl = await uploadFile(tmp, `${base}-cover-${Date.now()}.jpg`);

    await updatePost(id, { coverImageUrl });
    const updated = (await readQueue()).find((p) => p.id === id);
    return NextResponse.json(updated ?? { id, coverImageUrl });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'unknown error' }, { status: 500 });
  } finally {
    if (tmp && fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }
}
