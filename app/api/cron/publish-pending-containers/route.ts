import { NextRequest, NextResponse } from 'next/server';
import { readQueue, updatePost } from '@/lib/queue';
import { checkContainerStatus, publishContainer } from '@/lib/meta';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const posts = await readQueue();
  const inFlight = posts.filter(
    (p) => p.status === 'processing' && p.metaContainerId
  );

  if (inFlight.length === 0) {
    return NextResponse.json({ finalized: 0, pending: 0, errors: [] });
  }

  let finalized = 0;
  let pending = 0;
  const errors: string[] = [];

  for (const post of inFlight) {
    const containerId = post.metaContainerId!;
    try {
      const state = await checkContainerStatus(containerId);
      if (state === 'FINISHED') {
        const mediaId = await publishContainer(containerId);
        await updatePost(post.id, {
          status: 'published',
          publishedAt: new Date().toISOString(),
          metaPublishId: mediaId,
          metaContainerId: undefined,
          publishError: undefined,
        });
        finalized++;
      } else if (state === 'ERROR') {
        // Reset to approved so /api/publish will create a new container next tick
        await updatePost(post.id, {
          status: 'approved',
          metaContainerId: undefined,
          publishError: `Container ${containerId} failed processing`,
        });
        errors.push(`Post ${post.id}: container processing failed, reset to approved`);
      } else {
        pending++;
      }
    } catch (err: any) {
      const msg = `Post ${post.id}: ${err.message}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  return NextResponse.json({ finalized, pending, errors });
}
