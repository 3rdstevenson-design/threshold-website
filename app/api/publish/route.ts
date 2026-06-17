import { NextRequest, NextResponse } from 'next/server';
import { readQueue, updatePost, QueuePost } from '@/lib/queue';

// Lazy import meta publisher to avoid errors when META env vars aren't set yet.
// Note: publishCarouselPost is intentionally NOT imported — carousels are no
// longer published to Instagram (see the carousel hand-off below).
async function getPublisher() {
  const { publishImagePost, createReelContainer } = await import('@/lib/meta');
  return { publishImagePost, createReelContainer };
}

export async function POST(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const posts = await readQueue();
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
  const toPublish = due.filter((p) => p.type !== 'carousel');

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
        // Leave status 'approved' so the next cron tick retries the hand-off.
        await updatePost(post.id, { publishError: err.message });
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
          });
          processing++;
        } else {
          // image
          const mediaId = await publishImagePost(post);
          await updatePost(post.id, {
            status: 'published',
            publishedAt: new Date().toISOString(),
            metaPublishId: mediaId,
          });
          published++;
        }
      } catch (err: any) {
        const msg = `Post ${post.id} (${post.type}): ${err.message}`;
        console.error(msg);
        errors.push(msg);
      }
    }
  }

  return NextResponse.json({ published, processing, handedOff, errors });
}
