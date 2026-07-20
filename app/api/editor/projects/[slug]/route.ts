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

  const tryRm = (p: string) => {
    try {
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
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
