/**
 * GET /api/editor/project/[slug]/waveform
 *
 * Returns a PNG waveform for the source video. Generates it on-demand
 * via ffmpeg showwavespic if waveform.png doesn't exist yet. The PNG
 * is intentionally wide and thin so the UI can scale it to the full
 * timeline width without re-generating at different zooms.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { checkAuth, validateSlug, TAKES_ROOT } from '@/lib/editor/paths';
import { resolveSource } from '@/lib/editor/sourceResolver';
import { renderWaveformPng } from '@/lib/editor/ffmpeg';

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
  const waveformPath = path.join(slugDir, 'waveform.png');

  if (!sourcePath) {
    return NextResponse.json({ error: 'source video not found' }, { status: 404 });
  }

  if (!fs.existsSync(waveformPath)) {
    try {
      await renderWaveformPng({
        videoPath: sourcePath,
        outputPath: waveformPath,
        width: 1600,
        height: 80,
        color: '0x9B30D9', // threshold-violet
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const buf = fs.readFileSync(waveformPath);
  return new Response(buf as BodyInit, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
