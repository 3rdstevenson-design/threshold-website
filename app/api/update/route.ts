import { NextRequest, NextResponse } from 'next/server';
import { updatePost, VoiceDnaViolationError, type QueuePost } from '@/lib/queue';

export async function POST(req: NextRequest) {
  try {
    const { id, caption, pillar, scheduledTime, status, approvedAt, manualPost, voiceOverride, publishError, publishAttempts } = await req.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const updates: Partial<QueuePost> = {};
    if (caption !== undefined) updates.caption = caption;
    if (pillar !== undefined) updates.pillar = pillar;
    if (scheduledTime !== undefined) updates.scheduledTime = scheduledTime;
    if (status !== undefined) updates.status = status;
    if (approvedAt !== undefined) updates.approvedAt = approvedAt;
    if (manualPost !== undefined) updates.manualPost = manualPost;
    if (voiceOverride !== undefined) updates.voiceOverride = voiceOverride;
    // Retry-publish clears failure bookkeeping; null from the client means
    // "remove the field" (undefined is dropped by JSON serialization).
    if (publishError !== undefined) updates.publishError = publishError ?? undefined;
    if (publishAttempts !== undefined) updates.publishAttempts = publishAttempts ?? undefined;
    await updatePost(id, updates);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err instanceof VoiceDnaViolationError) {
      // Caption blocked by the Voice-DNA gate. Client may resubmit with
      // voiceOverride: true to bypass explicitly.
      return NextResponse.json(
        { error: err.message, voiceViolations: err.violations },
        { status: 422 },
      );
    }
    if (err.message?.includes('not found')) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to update post' }, { status: 500 });
  }
}
