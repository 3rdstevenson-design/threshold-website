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
import * as fs from 'fs';
import * as path from 'path';
import {
  checkAuth,
  validateSlug,
  TAKES_ROOT,
  VIDEO_PROJECT_ROOT,
} from '@/lib/editor/paths';

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

  const slugDir = path.join(TAKES_ROOT, params.slug);
  const publicSlugDir = path.join(VIDEO_PROJECT_ROOT, 'public', 'takes', params.slug);

  // v2 artifacts (polish run outputs). final-v2.mp4 may have been
  // renamed to final-v2-FAILED.mp4 by the audit-fail branch — accept
  // either.
  const finalV2Path = path.join(slugDir, 'final-v2.mp4');
  const finalV2FailedPath = path.join(slugDir, 'final-v2-FAILED.mp4');
  const polishedPlanPath = path.join(slugDir, 'polished-plan.json');
  const concatV2Path = path.join(publicSlugDir, 'concat-v2.mp4');
  const planV2Path = path.join(publicSlugDir, 'edits-plan-v2.json');

  // v1 slots (what the editor reads)
  const finalV1Path = path.join(slugDir, 'final.mp4');
  const editPlanV1Path = path.join(slugDir, 'edit-plan.json');
  const editPlanBackupPath = path.join(slugDir, 'edit-plan.pre-polish.json');
  const concatV1Path = path.join(publicSlugDir, 'concat.mp4');
  const editsPlanV1Path = path.join(publicSlugDir, 'edits-plan.json');

  // Locate the v2 mp4 — could be either name.
  let sourceFinalV2: string | null = null;
  if (fs.existsSync(finalV2Path)) sourceFinalV2 = finalV2Path;
  else if (fs.existsSync(finalV2FailedPath)) sourceFinalV2 = finalV2FailedPath;

  if (!sourceFinalV2) {
    return new Response(
      JSON.stringify({
        error: 'no v2 artifacts found — run Polish first, or they were already promoted',
      }),
      { status: 404 },
    );
  }
  if (!fs.existsSync(polishedPlanPath)) {
    return new Response(
      JSON.stringify({ error: 'polished-plan.json missing — run Polish first' }),
      { status: 404 },
    );
  }
  if (!fs.existsSync(concatV2Path) || !fs.existsSync(planV2Path)) {
    return new Response(
      JSON.stringify({
        error:
          'v2 concat or edits-plan missing — run Polish again to regenerate',
      }),
      { status: 404 },
    );
  }

  try {
    // 1. Back up current edit-plan.json (will be overwritten below)
    if (fs.existsSync(editPlanV1Path)) {
      fs.copyFileSync(editPlanV1Path, editPlanBackupPath);
    }
    // 2. Replace v1 edit-plan with polished plan
    const polishedPlan = fs.readFileSync(polishedPlanPath, 'utf8');
    fs.writeFileSync(editPlanV1Path, polishedPlan);
    // 3. Move v2 MP4 → final.mp4 (overwriting previous v1 if present)
    if (fs.existsSync(finalV1Path)) fs.unlinkSync(finalV1Path);
    fs.renameSync(sourceFinalV2, finalV1Path);
    // 4. Move concat-v2.mp4 → concat.mp4
    if (fs.existsSync(concatV1Path)) fs.unlinkSync(concatV1Path);
    fs.renameSync(concatV2Path, concatV1Path);
    // 5. Move edits-plan-v2.json → edits-plan.json
    if (fs.existsSync(editsPlanV1Path)) fs.unlinkSync(editsPlanV1Path);
    fs.renameSync(planV2Path, editsPlanV1Path);

    return new Response(
      JSON.stringify({
        ok: true,
        promoted: true,
        outputPath: finalV1Path,
        backedUpFrom: path.basename(sourceFinalV2),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: `promote failed: ${msg}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
