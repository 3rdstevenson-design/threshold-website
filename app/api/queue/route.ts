import { NextResponse } from 'next/server';
import { readQueueWithMeta } from '@/lib/queue';

// The queue lives in R2 and changes on every approve / caption / publish.
// Reads go through the AWS SDK, which Next can't see as a dynamic signal, so
// without these it statically caches the GET response (x-nextjs-cache: HIT).
// That cached snapshot is why freshly generated captions "disappeared" on the
// next reload — the write reached R2 but this route kept serving the stale
// list until a server restart. Force every request to read live.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET() {
  try {
    // Degrades to the last-known-good snapshot when R2 is unreachable (work
    // network). The body stays a plain array for existing consumers — the
    // offline state travels in headers. This also keeps the autopublish
    // port-probe (`curl -sf /api/queue`) succeeding offline, so the launchd
    // tick doesn't mistake "R2 blocked" for "server down".
    const { posts, source, cachedAt } = await readQueueWithMeta();
    const res = NextResponse.json(posts);
    res.headers.set('x-queue-source', source);
    if (cachedAt) res.headers.set('x-queue-cached-at', cachedAt);
    return res;
  } catch (err: any) {
    // No live store AND no snapshot — a real failure. Log and return the
    // actual reason instead of the old opaque "Failed to read queue".
    console.error(`queue read failed (no cache available): ${err?.message ?? err}`);
    return NextResponse.json(
      { error: 'Failed to read queue', detail: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
