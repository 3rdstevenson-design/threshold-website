/**
 * GET /api/editor/project/[slug]/source
 *
 * Streams the source video file to the browser so the <video> element
 * in the preview pane can play it. Supports HTTP Range so scrubbing
 * through a long clip doesn't re-download the whole file.
 */
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { checkAuth, validateSlug } from '@/lib/editor/paths';
import { resolveSource } from '@/lib/editor/sourceResolver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function contentTypeFor(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.m4v') return 'video/x-m4v';
  return 'video/mp4';
}

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) {
    return new Response('invalid slug', { status: 400 });
  }

  const sourcePath = resolveSource(params.slug);
  if (!sourcePath) {
    return new Response('source video not found', { status: 404 });
  }

  const stat = fs.statSync(sourcePath);
  const total = stat.size;
  const range = req.headers.get('range');

  if (!range) {
    const stream = fs.createReadStream(sourcePath);
    return new Response(stream as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(sourcePath),
        'Content-Length': String(total),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    });
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) {
    return new Response('invalid range', { status: 416 });
  }
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : total - 1;
  if (start >= total || end >= total || start > end) {
    return new Response('range not satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${total}` },
    });
  }
  const stream = fs.createReadStream(sourcePath, { start, end });
  return new Response(stream as unknown as BodyInit, {
    status: 206,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  });
}
