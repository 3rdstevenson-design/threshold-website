/**
 * GET  /api/editor/project/[slug]/plan  — return the current edit plan
 *                                         (creates a default one if source
 *                                         exists but no plan has been made)
 * PUT  /api/editor/project/[slug]/plan  — replace the plan with the body
 */
import { NextRequest, NextResponse } from 'next/server';
import * as path from 'path';
import { checkAuth, validateSlug, VIDEO_PROJECT_ROOT } from '@/lib/editor/paths';
import { createPlan, validatePlan } from '@/lib/editor/editPlan';
import { readPlan, writePlan } from '@/lib/editor/planStore';
import { resolveSource } from '@/lib/editor/sourceResolver';
import { writeStatus } from '@/lib/editor/status';
import { probeDurationSec } from '@/lib/editor/ffmpeg';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';


export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  }

  const existing = readPlan(params.slug);
  if (existing) {
    return NextResponse.json({ plan: existing });
  }

  // No plan yet. If a source video exists, bootstrap a default plan so the
  // user can start editing immediately.
  const src = resolveSource(params.slug);
  if (!src) {
    return NextResponse.json({ error: 'no source video' }, { status: 404 });
  }
  const duration = await probeDurationSec(src);
  const plan = createPlan({
    slug: params.slug,
    sourceVideo: path.relative(VIDEO_PROJECT_ROOT, src),
    sourceDuration: duration,
  });
  writePlan(plan);
  writeStatus(params.slug, { durationSec: duration });
  return NextResponse.json({ plan });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  }

  const body = await req.json();
  if (!validatePlan(body?.plan)) {
    return NextResponse.json({ error: 'invalid plan shape' }, { status: 400 });
  }
  if (body.plan.slug !== params.slug) {
    return NextResponse.json({ error: 'slug mismatch' }, { status: 400 });
  }
  writePlan(body.plan);
  writeStatus(params.slug, {}); // touches updatedAt
  return NextResponse.json({ ok: true });
}
