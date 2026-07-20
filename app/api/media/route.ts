import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';

/**
 * Local media proxy — serves video/image files from the filesystem.
 * Used in dev when videos haven't been uploaded to Vercel Blob yet.
 * Only serves file:// protocol URLs (local files); passes through http(s) as-is.
 *
 * Usage: /api/media?url=file:///path/to/file.mp4
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return new NextResponse('Missing url', { status: 400 });

  // Pass through remote URLs — shouldn't be proxied here
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return NextResponse.redirect(url);
  }

  if (!url.startsWith('file://')) {
    return new NextResponse('Unsupported URL scheme', { status: 400 });
  }

  const filePath = url.replace('file://', '');
  if (!fs.existsSync(filePath)) {
    return new NextResponse('File not found', { status: 404 });
  }

  const ext = filePath.split('.').pop()?.toLowerCase();
  const contentType = ext === 'mp4' ? 'video/mp4'
    : ext === 'png' ? 'image/png'
    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : 'application/octet-stream';

  const stat = fs.statSync(filePath);
  const range = req.headers.get('range');

  if (range) {
    // Support range requests for video seeking. Validate/clamp so a malformed or
    // out-of-bounds header can't spawn a NaN read stream (a silently black video).
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= stat.size) end = stat.size - 1;
    if (start > end) {
      return new NextResponse('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${stat.size}`, 'Accept-Ranges': 'bytes' },
      });
    }
    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => stream.destroy());
    return new NextResponse(stream as any, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => stream.destroy());
  return new NextResponse(stream as any, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  });
}
