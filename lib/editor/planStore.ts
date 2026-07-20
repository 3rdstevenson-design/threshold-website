/**
 * planStore.ts — server-only filesystem bindings for the edit plan.
 *
 * Keep all `fs`/`path` usage here so lib/editor/editPlan.ts stays
 * safe to import from client components (see VideoPreview.tsx).
 */
import * as fs from 'fs';
import * as path from 'path';
import { TAKES_ROOT } from './paths';
import { migratePlan, validatePlan, type EditPlan } from './editPlan';

export function planPath(slug: string): string {
  return path.join(TAKES_ROOT, slug, 'edit-plan.json');
}

export function readPlan(slug: string): EditPlan | null {
  const p = planPath(slug);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return validatePlan(parsed) ? migratePlan(parsed) : null;
  } catch {
    return null;
  }
}

export function writePlan(plan: EditPlan): void {
  const p = planPath(plan.slug);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(plan, null, 2));
}
