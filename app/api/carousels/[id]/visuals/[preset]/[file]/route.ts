import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { isVisualPreset, visualPath } from '@/lib/carouselVisuals';

interface Params {
  params: { id: string; preset: string; file: string };
}

export async function GET(_req: NextRequest, { params }: Params) {
  if (!isVisualPreset(params.preset)) {
    return new NextResponse('Not found', { status: 404 });
  }
  const preset = params.preset;
  const file = path.basename(params.file);
  if (!/^slide-\d+\.png$/.test(file)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const filePath = visualPath(params.id, preset, file);
  if (!fs.existsSync(filePath)) {
    return new NextResponse('Not found', { status: 404 });
  }

  return new NextResponse(fs.readFileSync(filePath), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    },
  });
}
