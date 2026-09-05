import { NextRequest, NextResponse } from 'next/server';
import { readQueue, updatePost, QueuePost } from '@/lib/queue';
import { publishFailurePatch, isNetworkError } from '@/lib/publishFailure';

// Lazy import meta publisher to avoid errors when META env vars aren't set yet.
// Note: publishCarouselPost is intentionally NOT imported — carousels are no
// longer published to Instagram (see the carousel hand-off below).
async function getPublisher() {
  const { publishImagePost, createReelContainer } = await import('@/lib/meta');
  return { publishImagePost, createReelContainer };
}

// Best-effort failure bookkeeping: when the publish failed because the
// network is down, the queue write usually fails too — that must not blow up
// the rest of the tick. The post simply stays 'approved' and retries.
//
// A post reaching terminal 'failed' also pings Telegram. Before this, a dead
// post was visible ONLY in the queue UI: on 2026-08-05 a due reel exhausted its
// attempts on a 404 at 17:39 and the first Lars knew of it was noticing the post
// never went up. A scheduled delivery that dies must say so on his phone.
async function recordFailure(post: QueuePost, err: unknown) {
  const patch = publishFailurePatch(post, err);
  try {
    await updatePost(post.id, patch);
  } catch (writeErr: any) {
    console.error(`publish: could not record failure on ${post.id}: ${writeErr.message}`);
  }
  if (patch.status !== 'failed') return;
  try {
    const { sendMessage } = await import('@/lib/telegram');
    await sendMessage(
      `🚨 Post FAILED to go out: ${post.notes || post.id}\n` +
        `Type: ${post.type}${post.manualPost ? ' (manual hand-off)' : ''} · scheduled ${post.scheduledTime}\n` +
        `Last error after ${patch.publishAttempts} attempts: ${patch.publishError}\n\n` +
        `It will not retry on its own. Fix the cause, then re-approve it in the queue.`,
    );
  } catch (notifyErr: any) {
    // Never let the alert take down the tick — the status write already landed.
    console.error(`publish: could not alert on failed post ${post.id}: ${notifyErr.message}`);
  }
}

export async function POST(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Offline grace: when R2 is unreachable (work network) nothing can publish
  // anyway — report that cleanly instead of a 500 so the autopublish tick logs
  // stay readable and the launchd agent doesn't look broken. The publish
  // selection must NEVER run against a stale cache (it would double-publish
  // posts already published from another read), so this path only degrades to
  // "do nothing this tick"; the next tick with connectivity catches up.
  let posts: QueuePost[];
  try {
    posts = await readQueue();
  } catch (err: any) {
    if (isNetworkError(err)) {
      console.error(`publish: queue unreachable (offline?): ${err.message}`);
      return NextResponse.json({
        published: 0, processing: 0, handedOff: 0, offline: true, errors: [],
      });
    }
    console.error(`publish: failed to read queue: ${err.message}`);
    return NextResponse.json(
      { error: `Failed to read queue: ${err.message}` },
      { status: 500 },
    );
  }
  const now = new Date();
  const due = posts.filter(
    (p) => p.status === 'approved' && new Date(p.scheduledTime) <= now
  );

  if (due.length === 0) {
    return NextResponse.json({ published: 0, processing: 0, handedOff: 0, errors: [] });
  }

  // Carousels are NOT auto-published: Instagram's native music can only be added
  // by hand in the mobile app (no Content Publishing API parameter exists). They
  // are siphoned off here and sent to Telegram for manual posting; reels and
  // single-image posts publish to Instagram as before.
  const carousels = due.filter((p) => p.type === 'carousel');
  // No-monologue reels (timelapse / caption-overlay) are tagged manualPost: Lars adds
  // music by hand in the IG app, so they hand off to Telegram like carousels. Talking-
  // head reels carry no manualPost flag and auto-publish unchanged.
  const manualReels = due.filter((p) => p.type === 'reel' && p.manualPost === true);
  const toPublish = due.filter(
    (p) => p.type !== 'carousel' && !(p.type === 'reel' && p.manualPost === true),
  );

  let published = 0;
  let processing = 0;
  let handedOff = 0;
  const errors: string[] = [];

  // ── Carousels → Telegram hand-off (never published to Instagram) ──────────────
  if (carousels.length > 0) {
    const { sendCarouselToTelegram } = await import('@/lib/telegram');
    for (const post of carousels) {
      try {
        await sendCarouselToTelegram(post);
        await updatePost(post.id, {
          status: 'sent_to_telegram',
          telegramSentAt: new Date().toISOString(),
          publishError: undefined,
        });
        handedOff++;
      } catch (err: any) {
        const msg = `Carousel ${post.id}: ${err.message}`;
        console.error(msg);
        errors.push(msg);
        // Offline → stay 'approved', no attempt counted. Real error → retry
        // up to the ceiling, then 'failed' so it surfaces instead of silently
        // burning a tick forever.
        await recordFailure(post, err);
      }
    }
  }

  // ── Manual-post reels → Telegram hand-off (never auto-published) ──────────────
  if (manualReels.length > 0) {
    const { sendReelToTelegram } = await import('@/lib/telegram');
    for (const post of manualReels) {
      try {
        await sendReelToTelegram(post);
        await updatePost(post.id, {
          status: 'sent_to_telegram',
          telegramSentAt: new Date().toISOString(),
          publishError: undefined,
        });
        handedOff++;
      } catch (err: any) {
        const msg = `Manual reel ${post.id}: ${err.message}`;
        console.error(msg);
        errors.push(msg);
        // Same failure accounting as carousels: offline waits, real errors
        // retry up to the ceiling then go 'failed'.
        await recordFailure(post, err);
      }
    }
  }

  // ── Reels + images → Instagram (unchanged) ────────────────────────────────────
  if (toPublish.length > 0) {
    const { publishImagePost, createReelContainer } = await getPublisher();
    for (const post of toPublish) {
      try {
        if (post.type === 'reel') {
          // Step 1 only: create container and return. Step 2 (finalize) is handled
          // by /api/cron/publish-pending-containers once Meta finishes processing.
          const containerId = await createReelContainer(post);
          await updatePost(post.id, {
            status: 'processing',
            metaContainerId: containerId,
            publishError: undefined,
            // The reaper ages 'processing' posts against this, so it must be
            // stamped on every attempt.
            lastAttemptAt: new Date().toISOString(),
          });
          processing++;
        } else {
          // image
          const mediaId = await publishImagePost(post);
          await updatePost(post.id, {
            status: 'published',
            publishedAt: new Date().toISOString(),
            metaPublishId: mediaId,
            publishError: undefined,
            publishAttempts: undefined,
          });
          published++;
        }
      } catch (err: any) {
        const msg = `Post ${post.id} (${post.type}): ${err.message}`;
        console.error(msg);
        errors.push(msg);
        // Previously swallowed: the post silently stayed 'approved' with no
        // recorded error. Now every reel/image failure is written to the post
        // (offline waits; real errors retry to the ceiling, then 'failed').
        await recordFailure(post, err);
      }
    }
  }

  return NextResponse.json({ published, processing, handedOff, errors });
}
