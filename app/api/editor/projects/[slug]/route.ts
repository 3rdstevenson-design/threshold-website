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

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
