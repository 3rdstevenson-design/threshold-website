import { NextRequest, NextResponse } from 'next/server';
import { deletePost, readQueue } from '@/lib/queue';
import { moveToRejected } from '@/lib/localDrafts';

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const posts = await readQueue();
    const post = posts.find((p) => p.id === id);

    let moved: { moved: boolean; from?: string; to?: string } = { moved: false };
    if (post) {
      try {
        moved = moveToRejected(post.type, post.notes);
      } catch (e) {
        console.error('[delete] moveToRejected failed:', e);
      }
    }

    await deletePost(id);
    return NextResponse.json({ ok: true, moved });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
