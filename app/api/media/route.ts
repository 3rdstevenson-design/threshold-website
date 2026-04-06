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
    // Support range requests for video seeking
    const parts = range.replace('bytes=', '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    return new NextResponse(stream as any, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': contentType,
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new NextResponse(stream as any, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
    },
  });
}
