import { NextRequest, NextResponse } from 'next/server';
import { updatePost } from '@/lib/queue';

export async function POST(req: NextRequest) {
  try {
    const { id, caption, pillar, scheduledTime } = await req.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const updates: Record<string, string> = {};
    if (caption !== undefined) updates.caption = caption;
    if (pillar !== undefined) updates.pillar = pillar;
    if (scheduledTime !== undefined) updates.scheduledTime = scheduledTime;
    await updatePost(id, updates);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to update post' }, { status: 500 });
  }
}
