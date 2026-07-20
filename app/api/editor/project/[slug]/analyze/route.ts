/**
 * POST /api/editor/project/[slug]/analyze
 *
 * Streams logs as SSE while running the takes:ingest script to populate
 * analysis.json with whisper words + silences. Used when:
 *   - a user has just uploaded a clip and wants to auto-cut
 *   - a project's analysis.json was produced before we started emitting
 *     word-level timestamps (legacy)
 */
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  checkAuth,
  validateSlug,
  VIDEO_PROJECT_ROOT,
} from '@/lib/editor/paths';
import { resolveSource } from '@/lib/editor/sourceResolver';
import { writeStatus } from '@/lib/editor/status';
import { processQueue } from '@/lib/editor/processQueue';
import { killOnAbort } from '@/lib/editor/ffmpeg';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) {
    return new Response(JSON.stringify({ error: 'invalid slug' }), { status: 400 });
  }

  const sourcePath = resolveSource(params.slug);
  if (!sourcePath) {
    return new Response(JSON.stringify({ error: 'source video not found' }), { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      writeStatus(params.slug, { error: null });

      try {
        // Serialize through the global queue (Whisper ingest is CPU-heavy)
        // so it can't run alongside a polish/render job.
        await processQueue.run(
          params.slug,
          () =>
            new Promise<void>((resolve) => {
              send('log', { msg: `Analyzing ${params.slug}…` });
              const proc = spawn(
                'npx',
                ['tsx', 'scripts/ingest-takes.ts', path.relative(VIDEO_PROJECT_ROOT, sourcePath), '--slug', params.slug],
                { cwd: VIDEO_PROJECT_ROOT, detached: true },
              );
              const cleanup = killOnAbort(proc, req.signal);
              proc.stdout.on('data', (chunk) => {
                for (const line of chunk.toString().split(/\r?\n/)) {
                  if (line.trim()) send('log', { msg: line });
                }
              });
              proc.stderr.on('data', (chunk) => {
                for (const line of chunk.toString().split(/\r?\n/)) {
                  if (line.trim()) send('log', { msg: line });
                }
              });
              proc.on('error', (err) => {
                cleanup();
                send('error', { msg: err.message });
                writeStatus(params.slug, { error: err.message });
                resolve();
              });
              proc.on('close', (code) => {
                cleanup();
                if (code === 0) {
                  send('done', { ok: true });
                } else {
                  send('error', { msg: `analyze exited ${code}` });
                  writeStatus(params.slug, { error: `analyze exited ${code}` });
                }
                resolve();
              });
            }),
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
        // Queue abort (client disconnected while waiting). Surface anything
        // that isn't the expected abort.
        if (!(e instanceof Error && e.message === 'aborted')) {
          send('error', { msg: e instanceof Error ? e.message : String(e) });
        }
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
