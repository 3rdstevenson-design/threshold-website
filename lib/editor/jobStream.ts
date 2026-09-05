/**
 * jobStream.ts — SSE response that only OBSERVES a job. Closing the tab
 * unsubscribes the observer but leaves the job running server-side.
 * Shared by /process (POST start + GET attach) and /approve.
 */
import type { NextRequest } from 'next/server';
import { subscribe, type Job } from './jobRunner';

export function observeJob(job: Job, req: NextRequest): Response {
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
