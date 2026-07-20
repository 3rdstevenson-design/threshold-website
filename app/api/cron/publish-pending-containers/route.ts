import { NextRequest, NextResponse } from 'next/server';
import { readQueue, updatePost, QueuePost } from '@/lib/queue';
import { checkContainerStatus, publishContainer } from '@/lib/meta';
import { publishFailurePatch, isNetworkError } from '@/lib/publishFailure';

// A reel container normally finishes processing in a few minutes. A post
// still 'processing' after this long is stuck (dead container, expired
// token mid-flight, lost response) — reap it back to 'approved' for a fresh
// container, or to 'failed' once it exhausts the attempt ceiling.
const MAX_PROCESSING_AGE_MS = 45 * 60 * 1000;

function processingAgeMs(post: QueuePost, now: Date): number {
  const since = post.lastAttemptAt ?? post.approvedAt ?? post.createdAt;
  const t = new Date(since).getTime();
  if (Number.isNaN(t)) return Infinity;
  return now.getTime() - t;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Same offline grace as /api/publish: nothing to finalize if the queue is
  // unreachable; never reap based on a stale cache.
  let posts: QueuePost[];
  try {
    posts = await readQueue();
  } catch (err: any) {
    if (isNetworkError(err)) {
      console.error(`finalize: queue unreachable (offline?): ${err.message}`);
      return NextResponse.json({ finalized: 0, pending: 0, reaped: 0, offline: true, errors: [] });
    }
    console.error(`finalize: failed to read queue: ${err.message}`);
    return NextResponse.json(
      { error: `Failed to read queue: ${err.message}` },
      { status: 500 },
    );
  }

  // ALL processing posts — including ones with no container id, which the old
  // filter skipped entirely, leaving them stuck 'processing' forever.
  const inFlight = posts.filter((p) => p.status === 'processing');

  if (inFlight.length === 0) {
    return NextResponse.json({ finalized: 0, pending: 0, reaped: 0, errors: [] });
  }

  const now = new Date();
  let finalized = 0;
  let pending = 0;
  let reaped = 0;
  const errors: string[] = [];

  // Reap a stuck/failed processing post: back to 'approved' (with the
  // container cleared so /api/publish creates a fresh one next tick), or to
  // 'failed' once attempts hit the ceiling. Never touches 'approved' posts —
  // this only ever runs against status === 'processing'.
  async function reap(post: QueuePost, reason: string) {
    await updatePost(post.id, publishFailurePatch(post, new Error(reason), {
      extraOnRetry: { metaContainerId: undefined },
    }));
    reaped++;
    errors.push(`Post ${post.id}: ${reason}`);
  }

  for (const post of inFlight) {
    try {
      if (!post.metaContainerId) {
        await reap(post, 'stuck in processing with no Meta container id');
        continue;
      }
      const containerId = post.metaContainerId;
      const state = await checkContainerStatus(containerId);
      if (state === 'FINISHED') {
        const mediaId = await publishContainer(containerId);
        await updatePost(post.id, {
          status: 'published',
          publishedAt: new Date().toISOString(),
          metaPublishId: mediaId,
          metaContainerId: undefined,
          publishError: undefined,
          publishAttempts: undefined,
        });
        finalized++;
      } else if (state === 'ERROR') {
        await reap(post, `container ${containerId} failed processing`);
      } else {
        // Genuinely in progress — but not forever. Past max-age the container
        // is presumed dead and the post is reaped for a fresh attempt.
        if (processingAgeMs(post, now) > MAX_PROCESSING_AGE_MS) {
          await reap(
            post,
            `stuck in processing for over ${Math.round(MAX_PROCESSING_AGE_MS / 60000)} minutes (container ${containerId})`,
          );
        } else {
          pending++;
        }
      }
    } catch (err: any) {
      // Network blips (offline) land here and deliberately do NOT reap —
      // age-based reaping only counts time, not unreachable ticks.
      const msg = `Post ${post.id}: ${err.message}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  return NextResponse.json({ finalized, pending, reaped, errors });
}
