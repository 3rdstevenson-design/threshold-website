import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { readDraft, draftPaths } from '@/lib/carouselDrafts';
import { renderPreviewHtml } from '@/lib/carouselRenderer';
import { getActiveVisualBackgrounds } from '@/lib/carouselVisuals';

interface Params {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const plan = readDraft(params.id);
  if (!plan) return new NextResponse('Draft not found', { status: 404 });

  // Always re-render from slides.json so Claude's disk edits show up on reload.
  const html = renderPreviewHtml(plan, {
    visualBackgrounds: getActiveVisualBackgrounds(params.id),
  });

  // Keep the on-disk file fresh too, so anyone reading it directly sees the
  // same output as the browser.
  try {
    fs.writeFileSync(draftPaths(params.id).html, html);
  } catch {
    // non-fatal
  }

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
