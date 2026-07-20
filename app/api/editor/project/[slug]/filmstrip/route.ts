/**
 * GET /api/editor/project/[slug]/filmstrip
 *
 * Returns one wide JPEG of FILMSTRIP_FRAMES frames sampled evenly across
 * the source video. Generated on-demand via ffmpeg fps+tile and cached at
 * <slug>/filmstrip.jpg — the Timeline picks individual frames out of the
 * strip with pure CSS background math, so this is the only request the
 * clip thumbnails ever make.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { checkAuth, validateSlug, TAKES_ROOT } from '@/lib/editor/paths';
import { resolveSource } from '@/lib/editor/sourceResolver';
import { probeDurationSec, renderFilmstripJpg } from '@/lib/editor/ffmpeg';
import { FILMSTRIP_FRAMES, FILMSTRIP_FRAME_HEIGHT } from '@/lib/editor/filmstrip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  }

  const slugDir = path.join(TAKES_ROOT, params.slug);
  const sourcePath = resolveSource(params.slug);
  const filmstripPath = path.join(slugDir, 'filmstrip.jpg');

  if (!sourcePath) {
    return NextResponse.json({ error: 'source video not found' }, { status: 404 });
  }

  if (!fs.existsSync(filmstripPath)) {
    try {
      const durationSec = await probeDurationSec(sourcePath);
      await renderFilmstripJpg({
        videoPath: sourcePath,
        outputPath: filmstripPath,
        durationSec,
        frames: FILMSTRIP_FRAMES,
        frameHeight: FILMSTRIP_FRAME_HEIGHT,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const buf = fs.readFileSync(filmstripPath);
  return new Response(buf as BodyInit, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
