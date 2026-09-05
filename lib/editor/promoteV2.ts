/**
 * promoteV2.ts — move a polish run's v2 artifacts into the v1 slots the
 * editor reads (final.mp4, edit-plan.json, public concat + edits-plan).
 * Used by the automatic promote in polishPipeline, the "Promote anyway"
 * button, and Approve & promote after an audit-fail review.
 */
import * as fs from 'fs';
import * as path from 'path';
import { TAKES_ROOT, VIDEO_PROJECT_ROOT } from './paths';

export type PromoteResult = { ok: true; outputPath: string; from: string } | { ok: false; error: string };

export function promoteV2Artifacts(slug: string): PromoteResult {
  const slugDir = path.join(TAKES_ROOT, slug);
  const publicSlugDir = path.join(VIDEO_PROJECT_ROOT, 'public', 'takes', slug);
  const finalV2Path = path.join(slugDir, 'final-v2.mp4');
  const finalV2FailedPath = path.join(slugDir, 'final-v2-FAILED.mp4');
  const polishedPlanPath = path.join(slugDir, 'polished-plan.json');
  const concatV2Path = path.join(publicSlugDir, 'concat-v2.mp4');
  const planV2Path = path.join(publicSlugDir, 'edits-plan-v2.json');
  const finalV1Path = path.join(slugDir, 'final.mp4');
  const editPlanV1Path = path.join(slugDir, 'edit-plan.json');
  const editPlanBackupPath = path.join(slugDir, 'edit-plan.pre-polish.json');
  const concatV1Path = path.join(publicSlugDir, 'concat.mp4');
  const editsPlanV1Path = path.join(publicSlugDir, 'edits-plan.json');

  const source = fs.existsSync(finalV2Path) ? finalV2Path : fs.existsSync(finalV2FailedPath) ? finalV2FailedPath : null;
  if (!source) return { ok: false, error: 'no v2 render found — run Polish first, or it was already promoted' };
  if (!fs.existsSync(polishedPlanPath)) return { ok: false, error: 'polished-plan.json missing — run Polish first' };
  if (!fs.existsSync(concatV2Path) || !fs.existsSync(planV2Path)) {
    return { ok: false, error: 'v2 concat or edits-plan missing — run Polish again to regenerate' };
  }
  try {
    if (fs.existsSync(editPlanV1Path)) fs.copyFileSync(editPlanV1Path, editPlanBackupPath);
    fs.writeFileSync(editPlanV1Path, fs.readFileSync(polishedPlanPath, 'utf8'));
    if (fs.existsSync(finalV1Path)) fs.unlinkSync(finalV1Path);
    fs.renameSync(source, finalV1Path);
    if (fs.existsSync(concatV1Path)) fs.unlinkSync(concatV1Path);
    fs.renameSync(concatV2Path, concatV1Path);
    if (fs.existsSync(editsPlanV1Path)) fs.unlinkSync(editsPlanV1Path);
    fs.renameSync(planV2Path, editsPlanV1Path);
    return { ok: true, outputPath: finalV1Path, from: path.basename(source) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
