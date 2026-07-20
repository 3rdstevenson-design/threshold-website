import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { checkAuth, PUBLIC_RAW, validateSlug } from '@/lib/editor/paths';

export const dynamic = 'force-dynamic';

const EXTS = ['.mov', '.MOV', '.mp4', '.MP4', '.m4v', '.M4V'];
const MIME: Record<string, string> = {
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
};

function resolveRawFile(slug: string): string | null {
  for (const ext of EXTS) {
    const p = path.join(PUBLIC_RAW, `${slug}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = header.match(/bytes=(\d*)-(\d*)/);
  if (!m) return null;
  const start = m[1] ? parseInt(m[1], 10) : 0;
  const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
  if (start > end || start < 0) return null;
  return { start, end };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;

  const { slug } = await params;
  if (!validateSlug(slug)) {
    return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  }

  const file = resolveRawFile(slug);
  if (!file) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const stat = fs.statSync(file);
  const size = stat.size;
  const ext = path.extname(file).toLowerCase();
  const contentType = MIME[ext] ?? 'video/mp4';

  const range = parseRange(req.headers.get('range'), size);

  if (range) {
    const chunkSize = range.end - range.start + 1;
    const stream = fs.createReadStream(file, { start: range.start, end: range.end });
    return new NextResponse(stream as any, {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(chunkSize),
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    });
  }

  const stream = fs.createReadStream(file);
  return new NextResponse(stream as any, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  });
}
