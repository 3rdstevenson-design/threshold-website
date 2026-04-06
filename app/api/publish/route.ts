import { NextRequest, NextResponse } from 'next/server';
import { readQueue, updatePost, QueuePost } from '@/lib/queue';

// Lazy import meta publisher to avoid errors when META env vars aren't set yet
async function getPublisher() {
  const { publishImagePost, publishCarouselPost, publishReelPost } = await import('@/lib/meta');
  return { publishImagePost, publishCarouselPost, publishReelPost };
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
    return NextResponse.json({ published: 0, errors: [] });
  }

  const { publishImagePost, publishCarouselPost, publishReelPost } = await getPublisher();

  let published = 0;
  const errors: string[] = [];

  for (const post of due) {
    try {
      let mediaId: string;
      const schedTime = new Date(post.scheduledTime);
      if (post.type === 'image') {
        mediaId = await publishImagePost(post, schedTime);
      } else if (post.type === 'carousel') {
        mediaId = await publishCarouselPost(post, schedTime);
      } else {
        mediaId = await publishReelPost(post, schedTime);
      }
      await updatePost(post.id, {
        status: 'published',
        publishedAt: new Date().toISOString(),
        metaPublishId: mediaId,
      });
      published++;
    } catch (err: any) {
      const msg = `Post ${post.id} (${post.type}): ${err.message}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  return NextResponse.json({ published, errors });
}
