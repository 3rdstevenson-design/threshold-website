import { NextResponse } from 'next/server';
import { scanLocalFiles, type LocalFile } from '@/lib/localScan';

// Scans the local filesystem for finished renders on each request. Like
// /api/queue, the filesystem read is invisible to Next's caching heuristics,
// so without this it serves a stale snapshot (x-nextjs-cache: HIT) and newly
// rendered reels/carousels don't appear until a restart. Force live reads.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export type { LocalFile };

export async function GET() {
  return NextResponse.json(scanLocalFiles());
}
