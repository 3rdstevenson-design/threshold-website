import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Template preview videos live where the render:slides:<template>-demo
// scripts drop them. One pre-rendered MP4 per template, reused as the
// thumbnail in the Studio → Slides tab.
const PREVIEW_FILES: Record<string, string> = {
  framework: 'slides-framework-demo.mp4',
  'clinic-case': 'slides-clinic-demo.mp4',
  'principle-reveal': 'slides-principle-demo.mp4',
};

function previewPath(name: string): string | null {
  const file = PREVIEW_FILES[name];
  if (!file) return null;
  return path.join(os.homedir(), 'Social Media', 'Reels', 'Drafts', file);
}

export async function GET(req: NextRequest, { params }: { params: { name: string } }) {
  const p = previewPath(params.name);
  if (!p) return NextResponse.json({ error: 'unknown template' }, { status: 404 });
  if (!fs.existsSync(p)) {
    return NextResponse.json({ error: 'not rendered yet' }, { status: 404 });
  }

  const stat = fs.statSync(p);
  const size = stat.size;
  const range = req.headers.get('range');

  if (range) {
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
    const stream = fs.createReadStream(p, { start, end });
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(chunkSize),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  const stream = fs.createReadStream(p);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
