import { NextRequest, NextResponse } from 'next/server';
import { readQueue, updatePost } from '@/lib/queue';
import { publishImagePost, publishCarouselPost, publishReelPost } from '@/lib/meta';

export async function POST(req: NextRequest) {
  try {
    const { id, scheduledTime } = await req.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (!scheduledTime) return NextResponse.json({ error: 'scheduledTime is required' }, { status: 400 });

    // Read post before updating (need original media URLs + caption)
    const posts = await readQueue();
    const post = posts.find((p) => p.id === id);
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });

    // Mark approved in queue
    await updatePost(id, {
      status: 'approved',
      approvedAt: new Date().toISOString(),
      scheduledTime,
    });

    // Push to Instagram as a scheduled post (shows in app immediately)
    const schedTime = new Date(scheduledTime);
    const updatedPost = { ...post, scheduledTime };

    let metaPublishId: string;
    if (post.type === 'image') {
      metaPublishId = await publishImagePost(updatedPost, schedTime);
    } else if (post.type === 'carousel') {
      metaPublishId = await publishCarouselPost(updatedPost, schedTime);
    } else {
      metaPublishId = await publishReelPost(updatedPost, schedTime);
    }

    await updatePost(id, { metaPublishId });
    return NextResponse.json({ ok: true, metaPublishId });
  } catch (err: any) {
    // If the error came from the IG API (post was already approved in queue),
    // return a warning instead of a hard error so the UI can reflect partial state.
    if (err.message?.includes('Meta API error')) {
      return NextResponse.json({ ok: true, warning: err.message }, { status: 200 });
    }
    if (err.message?.includes('not found')) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to approve post' }, { status: 500 });
  }
}
