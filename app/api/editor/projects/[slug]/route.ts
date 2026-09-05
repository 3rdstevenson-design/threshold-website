import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  checkAuth,
  TAKES_ROOT,
  PUBLIC_RAW,
  PUBLIC_SELECTOR,
  VIDEO_PROJECT_ROOT,
  validateSlug,
} from '@/lib/editor/paths';
import { isJobActive } from '@/lib/editor/jobRunner';
import { readProject, writeStatus, type Category } from '@/lib/editor/status';
import { readPlan, writePlan } from '@/lib/editor/planStore';
import { createPlan } from '@/lib/editor/editPlan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * PATCH /api/editor/projects/[slug]  { category: 'talking-head' | 'long-form' }
 *
 * Moves a project between pipelines. Uploads used to inherit whichever tab
 * was open with no way to fix a wrong drop short of delete + re-upload. The
 * caller should offer "Re-process" afterwards: long-form needs diarization a
 * talking-head ingest never produced, and vice versa the plan needs seeding.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  const { slug } = await params;
  if (!validateSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  const project = readProject(slug);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (isJobActive(slug)) {
    return NextResponse.json({ error: 'a pipeline job is running for this project — cancel it first' }, { status: 409 });
  }
  let body: { category?: unknown } = {};
  try { body = await req.json(); } catch {}
  const category: Category | null =
    body.category === 'long-form' ? 'long-form'
    : body.category === 'talking-head' ? 'talking-head'
    : null;
  if (!category) return NextResponse.json({ error: 'category must be talking-head or long-form' }, { status: 400 });

  writeStatus(slug, { category, error: null });
  if (category === 'talking-head' && !readPlan(slug) && project.sourcePath) {
    writePlan(createPlan({
      slug,
      sourceVideo: project.sourcePath,
      sourceDuration: project.durationSec ?? 0,
    }));
  }
  return NextResponse.json({ ok: true, slug, category, previous: project.category });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;

  const { slug } = await params;
  if (!validateSlug(slug)) {
    return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  }

  const removed: string[] = [];
  const errors: string[] = [];

  // SOFT delete — move into data/trash/<slug>-<ts>/ instead of rmSync.
  // The sidebar × used to hard-delete the whole project dir INCLUDING
  // source.mp4 (2026-07-25: seven teleprompter sources were lost this
  // way mid-reprocess and had to be re-AirDropped). Trash keeps the
  // bytes until someone empties data/trash/ deliberately.
  const trashDir = path.join(
    VIDEO_PROJECT_ROOT, 'data', 'trash', `${slug}-${Date.now()}`,
  );
  const tryRm = (p: string) => {
    try {
      if (fs.existsSync(p)) {
        fs.mkdirSync(trashDir, { recursive: true });
        fs.renameSync(p, path.join(trashDir, path.basename(p)));
        removed.push(path.relative(VIDEO_PROJECT_ROOT, p));
      }
    } catch (e) {
      errors.push(`${p}: ${(e as Error).message}`);
    }
  };

  tryRm(path.join(TAKES_ROOT, slug));
  tryRm(path.join(PUBLIC_SELECTOR, `${slug}.html`));
  tryRm(path.join(VIDEO_PROJECT_ROOT, 'public', 'takes', slug));

  for (const ext of ['.mov', '.MOV', '.mp4', '.MP4', '.m4v', '.M4V']) {
    tryRm(path.join(PUBLIC_RAW, `${slug}${ext}`));
  }

  if (errors.length) {
    return NextResponse.json({ removed, errors }, { status: 500 });
  }
  return NextResponse.json({ ok: true, removed });
}
