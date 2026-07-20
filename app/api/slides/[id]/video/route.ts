import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { draftPaths } from '@/lib/slideDrafts';

// GET /api/slides/[id]/video — stream the locally-rendered final.mp4 to the
// dashboard preview. Supports HTTP Range so the <video> element can scrub.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { finalMp4 } = draftPaths(params.id);
  if (!fs.existsSync(finalMp4)) {
    return NextResponse.json({ error: 'not rendered yet' }, { status: 404 });
  }
  const stat = fs.statSync(finalMp4);
  const size = stat.size;
  const range = req.headers.get('range');

  if (range) {
    // bytes=start-end (end optional)
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) {
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : size - 1;
    if (isNaN(start) || isNaN(end) || start > end || end >= size) {
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(finalMp4, { start, end });
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(chunkSize),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    });
  }

  const stream = fs.createReadStream(finalMp4);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  });
}
