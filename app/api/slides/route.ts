import { NextRequest, NextResponse } from 'next/server';
import {
  listDrafts,
  newDraftId,
  writeDraft,
  type SlideDraftMeta,
  type SlidePlan,
  type SlideTemplate,
} from '@/lib/slideDrafts';
import type { ContentPillar } from '@/lib/queue';

export async function GET() {
  const drafts = listDrafts();
  return NextResponse.json({ drafts });
}

// Skill-driven creation. Claude Code POSTs after it writes the bespoke
// composition file (or picks a template) so the dashboard can show the draft
// immediately. Analytics-driven generation goes through /api/slides/generate.
export async function POST(req: NextRequest) {
  let body: {
    topic?: string;
    pillar?: ContentPillar;
    template?: SlideTemplate;
    compositionId?: string;
    script?: Record<string, unknown>;
    source?: SlideDraftMeta['source'];
    id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const topic = body.topic?.trim();
  if (!topic) return NextResponse.json({ error: 'topic required' }, { status: 400 });
  const pillar: ContentPillar = body.pillar ?? 'exercise';
  const template: SlideTemplate = body.template ?? 'bespoke';
  const id = body.id ?? newDraftId(topic);

  const compositionId =
    body.compositionId ??
    (template === 'bespoke'
      ? `Slides-${id}`
      : template === 'framework'
        ? 'Slides-Framework-Demo'
        : template === 'clinic-case'
          ? 'Slides-ClinicCase-Demo'
          : 'Slides-PrincipleReveal-Demo');

  const meta: SlideDraftMeta = {
    id,
    createdAt: new Date().toISOString(),
    status: 'draft',
    pillar,
    topic,
    template,
    compositionId,
    source: body.source,
  };
  const plan: SlidePlan = { meta, script: body.script ?? {} };
  writeDraft(plan);
  return NextResponse.json({ ok: true, id, meta });
}
