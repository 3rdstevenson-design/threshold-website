/**
 * POST /api/editor/project/[slug]/propose-clips
 *
 * Re-run ONLY the Claude viral-moment proposal step on a long-form
 * source that's already been transcribed (analysis.json exists). Useful
 * for getting fresh proposals without re-transcribing the full 30-60 min
 * recording.
 *
 * The initial clip proposal is produced by the /process route — this
 * endpoint exists so the user can hit "Regenerate proposals" in the
 * LongFormView and try again without paying for another Whisper pass.
 *
 * Streams logs as SSE. Writes clips-proposal.json. Guards against
 * running on talking-head projects (which don't have the concept).
 */
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

import { checkAuth, validateSlug, TAKES_ROOT } from '@/lib/editor/paths';
import { readProject, writeStatus } from '@/lib/editor/status';
import { runClipProposalStage, type AnalysisJson } from '@/lib/editor/longFormPipeline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const unauth = checkAuth(_req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) {
    return new Response(JSON.stringify({ error: 'invalid slug' }), { status: 400 });
  }

  const status = readProject(params.slug);
  if (!status) {
    return new Response(JSON.stringify({ error: 'project not found' }), { status: 404 });
  }
  if (status.category !== 'long-form') {
    return new Response(
      JSON.stringify({ error: 'propose-clips only applies to long-form projects' }),
      { status: 400 },
    );
  }

  const analysisPath = path.join(TAKES_ROOT, params.slug, 'analysis.json');
  if (!fs.existsSync(analysisPath)) {
    return new Response(
      JSON.stringify({ error: 'analysis.json missing — run /process first' }),
      { status: 400 },
    );
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
      const log = (msg: string) => send('log', { msg });
      const stage = (name: string) => send('stage', { name });

      try {
        writeStatus(params.slug, { error: null });
        stage('propose-clips');
        const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf-8')) as AnalysisJson;
        await runClipProposalStage({ slug: params.slug, analysis, onLog: log });
        send('done', { ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        writeStatus(params.slug, { error: msg });
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
