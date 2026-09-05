/**
 * POST /api/editor/project/[slug]/cancel
 *
 * Aborts the running (or queued) pipeline job for the slug. The job's own
 * AbortSignal is threaded into every spawned ffmpeg/whisper/Remotion process,
 * so cancel actually frees the serial queue instead of leaving a 45-minute
 * podcast blocking everything behind it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkAuth, validateSlug } from '@/lib/editor/paths';
import { cancelJob } from '@/lib/editor/jobRunner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  const ok = cancelJob(params.slug);
  return NextResponse.json({ ok, canceled: ok }, { status: ok ? 200 : 404 });
}
