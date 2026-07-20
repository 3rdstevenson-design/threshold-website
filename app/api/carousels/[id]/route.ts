import { NextRequest, NextResponse } from 'next/server';
import { readDraft, deleteDraft, writeDraft, SlidePlan } from '@/lib/carouselDrafts';
import { renderPreviewHtml } from '@/lib/carouselRenderer';
import { getActiveVisualBackgrounds } from '@/lib/carouselVisuals';

interface Params {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const plan = readDraft(params.id);
  if (!plan) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  return NextResponse.json(plan);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const ok = deleteDraft(params.id);
  if (!ok) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest, { params }: Params) {
  // Used by Claude Code / scripts to write an edited plan back. The dashboard
  // doesn't call this — editing happens by editing slides.json on disk directly.
  const plan = (await req.json()) as SlidePlan;
  if (plan.meta?.id !== params.id) {
    return NextResponse.json({ error: 'id mismatch' }, { status: 400 });
  }
  plan.meta.status = 'edited';
  const html = renderPreviewHtml(plan, {
    visualBackgrounds: getActiveVisualBackgrounds(params.id),
  });
  writeDraft(plan, html);
  return NextResponse.json({ ok: true });
}
