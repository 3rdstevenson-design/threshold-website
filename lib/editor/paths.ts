import * as path from 'path';
import * as os from 'os';
import { NextRequest, NextResponse } from 'next/server';

export const VIDEO_PROJECT_ROOT = path.join(
  os.homedir(),
  'Code',
  'Social Media',
  'my-video-projects',
);

export const TAKES_ROOT = path.join(VIDEO_PROJECT_ROOT, 'data', 'takes');
export const PUBLIC_RAW = path.join(VIDEO_PROJECT_ROOT, 'public', 'raw');
export const PUBLIC_SELECTOR = path.join(VIDEO_PROJECT_ROOT, 'public', 'take-selector');
// Drafts + Final sit alongside each other under ~/Code/Social Media/Reels so
// every exported reel lives in ONE tree. (This previously pointed at
// ~/Social Media/Reels/Drafts — no `Code/` — a second, empty tree that made
// output detection and the cover fast-path look in the wrong place.)
export const DRAFTS_DIR = path.join(os.homedir(), 'Code', 'Social Media', 'Reels', 'Drafts');
// Final MP4 landing spot. scripts/watch-renders.mjs polls this directory and
// auto-queues any new .mp4 into the Instagram queue with a placeholder caption.
export const VIDEO_OUT_DIR = path.join(os.homedir(), 'Code', 'Social Media', 'Reels', 'Final');

export const STUDIO_PORT = 3001;

/**
 * Shared auth gate for /api/editor/*. Render + studio spawn routes must
 * never run unauthenticated. We accept either the session header or a
 * URL query (for iframe <video> requests that can't set headers).
 */
export function checkAuth(req: NextRequest): NextResponse | null {
  const fromHeader = req.headers.get('x-dashboard-key');
  const fromQuery = new URL(req.url).searchParams.get('k');
  const pwd = fromHeader ?? fromQuery;
  if (!process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json(
      { error: 'DASHBOARD_PASSWORD not configured' },
      { status: 500 },
    );
  }
  if (pwd !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

/** Guards a slug against path traversal. */
export function validateSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/i.test(slug) && !slug.includes('..');
}
