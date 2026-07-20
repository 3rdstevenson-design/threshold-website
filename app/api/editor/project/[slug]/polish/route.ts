/**
 * POST /api/editor/project/[slug]/polish
 *
 * Round-2 "Polish" pipeline. Runs STRICTLY AFTER the existing analyze +
 * edit flow has produced an edit-plan.json the user is happy with. Does
 * not modify anything the user has already done — produces a parallel
 * set of v2 artifacts.
 *
 * Pipeline (each stage emits an SSE `log` or `stage` event):
 *   1. Load analysis.json + edit-plan.json
 *   2. Claude semantic disfluency pass → extra skip ranges
 *   3. Merge w/ existing plan → polished EditPlan (clips + captions)
 *   4. Write edits-plan-v2.json to public/takes/<slug>/
 *   5. ffmpeg per-clip cut + concat demuxer → concat-v2.mp4
 *   6. Remotion render EditsReelV2 → final-v2.mp4
 *   7. Spawn audit-render.ts on the final → audit.json (Whisper drift)
 *   8. NEW — Deepgram sync-audit (independent word-level verification)
 *   9. NEW — auto-correct caption timings + re-render if drift exceeds
 *      threshold, then re-run Whisper audit for final verification
 *
 * The unified /process endpoint imports runPolishStream from this file so
 * both entrypoints share a single implementation of the polish pipeline.
 */
import { NextRequest } from 'next/server';
import { checkAuth, validateSlug } from '@/lib/editor/paths';
import { runPolishStream } from '@/lib/editor/polishPipeline';
import { processQueue } from '@/lib/editor/processQueue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 900;

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) {
    return new Response(JSON.stringify({ error: 'invalid slug' }), { status: 400 });
  }

  // Optional body: `{ approvedRangeIds: string[] }`. When provided we
  // skip the Claude detection phase and use those IDs to filter the
  // most recent `disfluency-proposal.json`. Missing body → full auto
  // flow, preserving backward compatibility with the "Preview cuts"
  // approval flow.
  let approvedRangeIds: string[] | null = null;
  try {
    const body = await req.json();
    if (body && Array.isArray(body.approvedRangeIds)) {
      approvedRangeIds = body.approvedRangeIds.filter(
        (x: unknown): x is string => typeof x === 'string',
      );
    }
  } catch {
    approvedRangeIds = null;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {}
      };
      try {
        await processQueue.run(
          params.slug,
          async () => {
            await runPolishStream({
              slug: params.slug,
              approvedRangeIds,
              send,
              signal: req.signal,
            });
          },
          {
            onPosition: (p) => {
              if (p.position > 0) {
                send('stage', { name: 'queued' });
                send('queue', { position: p.position, ahead: p.ahead });
              }
            },
            signal: req.signal,
          },
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        send('error', { msg });
      } finally {
        controller.close();
      }
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
