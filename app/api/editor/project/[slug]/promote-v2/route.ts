/**
 * POST /api/editor/project/[slug]/promote-v2
 *
 * Force-promote the polished v2 artifacts into the v1 slots even when
 * the post-render audit returned `fail`. This is the "Promote anyway"
 * escape hatch — the audit is a soft gate, and the user is the final
 * authority on whether the cut looks right.
 *
 * Mirrors Phase 6 of the polish pipeline (see polish/route.ts). Does
 * nothing if no v2 artifacts are on disk (404) — that means either the
 * last polish run never completed or it was already promoted.
 *
 * No body required.
 */
import { NextRequest } from 'next/server';
import { checkAuth, validateSlug } from '@/lib/editor/paths';
import { promoteV2Artifacts } from '@/lib/editor/promoteV2';
import { readProject, writeStatus } from '@/lib/editor/status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) {
    return new Response(JSON.stringify({ error: 'invalid slug' }), { status: 400 });
  }
  const r = promoteV2Artifacts(params.slug);
  if (!r.ok) {
    return new Response(JSON.stringify({ error: r.error }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  // Promoting by hand resolves an audit-fail review, if one is pending.
  const prev = readProject(params.slug)?.review;
  if (prev?.required) writeStatus(params.slug, { review: { ...prev, required: false, resolvedAt: new Date().toISOString() }, outputPath: r.outputPath });
  return new Response(
    JSON.stringify({ ok: true, promoted: true, outputPath: r.outputPath, backedUpFrom: r.from }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
