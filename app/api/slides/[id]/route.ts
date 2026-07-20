import { NextRequest, NextResponse } from 'next/server';
import {
  readDraft,
  deleteDraft,
  writeDraft,
  hasRenderedMp4,
  type SlidePlan,
} from '@/lib/slideDrafts';

interface Params {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const plan = readDraft(params.id);
  if (!plan) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  return NextResponse.json({
    ...plan,
    hasRender: hasRenderedMp4(params.id),
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const ok = deleteDraft(params.id);
  if (!ok) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// Used by Claude Code / scripts to write an edited script back. The dashboard
// Chat panel calls /api/slides/<id>/chat which ends up here after Claude
// regenerates.
export async function PUT(req: NextRequest, { params }: Params) {
  const plan = (await req.json()) as SlidePlan;
  if (plan.meta?.id !== params.id) {
    return NextResponse.json({ error: 'id mismatch' }, { status: 400 });
  }
  plan.meta.status = 'edited';
  writeDraft(plan);
  return NextResponse.json({ ok: true });
}
