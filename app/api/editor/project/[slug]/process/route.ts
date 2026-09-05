/**
 * POST /api/editor/project/[slug]/process
 *
 * Unified one-click pipeline entry point. Branches on status.category:
 *
 *   talking-head → runTalkingHeadPipeline (transcribe → silences →
 *                   fillers → stutters → captions → polish)
 *   long-form    → runLongFormPipeline    (transcribe → diarize →
 *                   propose-clips)
 *
 * Concurrency: every job goes through a shared SERIAL queue (processQueue)
 * so multiple uploads don't saturate the GPU + CPU at once. Clients see
 * a `stage: 'queued'` event with their position while waiting, followed
 * by the normal pipeline stages once the mutex is acquired.
 *
 * Body (all optional):
 *   {
 *     approvedRangeIds?: string[] | null  // passed to polish; null = full auto
 *     skipTranscribe?: boolean            // reuse existing analysis.json
 *   }
 */
import { NextRequest } from 'next/server';

import {
  checkAuth,
  validateSlug,
} from '@/lib/editor/paths';
import { resolveSource } from '@/lib/editor/sourceResolver';
import { readProject, writeStatus } from '@/lib/editor/status';
import { runLongFormPipeline } from '@/lib/editor/longFormPipeline';
import { runTalkingHeadPipeline } from '@/lib/editor/talkingHeadPipeline';
import { getJob, startJob, subscribe, type Emit, type Job } from '@/lib/editor/jobRunner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 900;

type Body = {
  approvedRangeIds?: string[] | null;
  skipTranscribe?: boolean;
};

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) {
    return new Response(JSON.stringify({ error: 'invalid slug' }), { status: 400 });
  }

  const source = resolveSource(params.slug);
  if (!source) {
    return new Response(JSON.stringify({ error: 'source video not found' }), { status: 404 });
  }

  let body: Body = {};
  try {
    const raw = await req.json();
    if (raw && typeof raw === 'object') body = raw as Body;
  } catch {
    body = {};
  }
  const approvedRangeIds: string[] | null = Array.isArray(body.approvedRangeIds)
    ? body.approvedRangeIds.filter((x): x is string => typeof x === 'string')
    : null;
  const skipTranscribe = body.skipTranscribe === true;

  const projectStatus = readProject(params.slug);
  const category = projectStatus?.category ?? 'talking-head';
  const slug = params.slug;

  // Clear any prior error immediately so a retry stops showing "Failed" in
  // the sidebar the instant the user re-runs (status surfaces 'error'
  // whenever the error field is set — see lib/editor/status.ts).
  writeStatus(slug, { error: null, warnings: [] });

  // The actual pipeline, DECOUPLED from this request. It runs on the server
  // event loop via the job runner and survives a client disconnect: it
  // threads the JOB's signal (never req.signal) into ffmpeg/whisper, and
  // emits its own terminal 'done'/'error' so observers' streams close.
  const run = async (emit: Emit, signal: AbortSignal) => {
    try {
      if (category === 'long-form') {
        await runLongFormPipeline({
          slug,
          sourceAbsPath: source,
          send: emit,
          skipTranscribe,
          signal,
        });
        emit('done', { ok: true, category: 'long-form' });
      } else {
        await runTalkingHeadPipeline({
          slug,
          sourceAbsPath: source,
          send: emit,
          skipTranscribe,
          approvedRangeIds,
          signal,
        });
      }
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e);
      if (signal.aborted) msg = 'Canceled. Press Process to re-run.';
      // The spawned ingest writes its own, more specific error into
      // status.json (e.g. "Deepgram 408: SLOW_UPLOAD…") right before it
      // exits nonzero. Don't clobber that detail with a generic wrapper —
      // it's the difference between a diagnosable failure and
      // "ingest exited 1".
      const existing = readProject(slug)?.error;
      if (existing && msg.startsWith('ingest exited') && !msg.includes(existing)) {
        msg = `${msg} — ${existing}`;
      }
      writeStatus(slug, { error: msg });
      emit('error', { msg });
    }
  };

  const job = startJob(slug, run);
  return observe(job, req);
}

/**
 * GET /api/editor/project/[slug]/process — attach-only.
 *
 * Re-subscribes a freshly loaded page (or a backgrounded phone) to a job
 * that is already running, replaying the buffered events so the log, stage
 * and progress reappear. Never starts a job: POST is idempotent only while a
 * job is unsettled, and a settled one lingers 30s, so reusing POST for
 * reattach would kick off a brand-new full pipeline on a finished project.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) {
    return new Response(JSON.stringify({ error: 'invalid slug' }), { status: 400 });
  }
  const job = getJob(params.slug);
  if (!job) {
    return new Response(JSON.stringify({ active: false }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return observe(job, req);
}

/** SSE response that only OBSERVES `job`. Closing the tab unsubscribes us but
 *  leaves the job running server-side. */
function observe(job: Job, req: NextRequest): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsub: () => void = () => {};
      const close = () => {
        if (closed) return;
        closed = true;
        unsub();
        try { controller.close(); } catch {}
      };
      const onEvent = (e: { event: string; data: unknown }) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`),
          );
        } catch {}
        if (e.event === 'done' || e.event === 'error') close();
      };
      unsub = subscribe(job, onEvent);
      // A job that already finished replays its terminal event above and is
      // now closed; guard the case where the buffer rolled past it.
      if (job.settled) close();
      // Client disconnected (tab closed / navigated away): stop observing,
      // but DO NOT abort the job.
      req.signal.addEventListener('abort', close, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
