import { NextRequest, NextResponse } from 'next/server';
import { updatePost } from '@/lib/queue';

export async function POST(req: NextRequest) {
  try {
    const { id, scheduledTime } = await req.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const updates: Record<string, string> = { status: 'approved', approvedAt: new Date().toISOString() };
    if (scheduledTime) updates.scheduledTime = scheduledTime;
    await updatePost(id, updates);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to approve post' }, { status: 500 });
  }
}
