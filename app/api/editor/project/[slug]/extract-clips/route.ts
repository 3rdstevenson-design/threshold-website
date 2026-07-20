/**
 * POST /api/editor/project/[slug]/extract-clips
 *
 * For each approved proposal id, materialize a child talking-head
 * project by cutting the sub-range out of the parent long-form source,
 * subsetting analysis + diarization, reframing to 9:16, and kicking off
 * the standard talking-head pipeline on the child.
 *
 * Body:
 *   { "proposalIds": string[] }
 *
 * Stream events:
 *   stage  { name: 'cutting' | 'reframing' | 'processing' | 'done' }
 *   clip   { proposalId, childSlug, status: 'extracted' | 'failed', error? }
 *   log    { msg }
 *   done   { extractedSlugs: string[], failedIds: string[] }
 *   error  { msg }
 *
 * The parent long-form project is unchanged by this endpoint — it stays
 * in the Long-Form tab for re-extraction or reference. Only its approved
 * proposals get turned into independent short-form projects.
 */
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

import {
  checkAuth,
  validateSlug,
  TAKES_ROOT,
} from '@/lib/editor/paths';
import { readProject } from '@/lib/editor/status';
import { readPlan } from '@/lib/editor/planStore';
import { resolveSource } from '@/lib/editor/sourceResolver';
import { extractClip } from '@/lib/editor/extractClip';
import { reframeClip } from '@/lib/editor/reframe';
import { runTalkingHeadPipeline } from '@/lib/editor/talkingHeadPipeline';
import { processQueue } from '@/lib/editor/processQueue';
import type { ClipsProposalFile, ClipProposal } from '@/lib/editor/clipProposal';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 900;

type Body = {
  proposalIds?: string[];
  /**
   * New flow (inbox long-form → regular editor): extract from the CURRENT
   * edit plan's clips instead of proposalIds. Honors Lars's timeline review
   * — deleted clips are gone, slid edges are the real boundaries.
   */
  fromPlan?: boolean;
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

  const parentStatus = readProject(params.slug);
  if (!parentStatus) {
    return new Response(JSON.stringify({ error: 'project not found' }), { status: 404 });
  }
  // (Category check removed 2026-07-02: inbox long-form projects flip to
  // 'talking-head' after their plan is built — the proposal file on disk is
  // what marks a project as extractable.)

  const parentSource = resolveSource(params.slug);
  if (!parentSource) {
    return new Response(JSON.stringify({ error: 'parent source.mp4 missing' }), { status: 404 });
  }

  const proposalPath = path.join(TAKES_ROOT, params.slug, 'clips-proposal.json');
  if (!fs.existsSync(proposalPath)) {
    return new Response(
      JSON.stringify({ error: 'clips-proposal.json missing — run /process first' }),
      { status: 400 },
    );
  }
  const proposalFile = JSON.parse(fs.readFileSync(proposalPath, 'utf-8')) as ClipsProposalFile;

  let body: Body = {};
  try {
    const raw = await req.json();
    if (raw && typeof raw === 'object') body = raw as Body;
  } catch {
    body = {};
  }
  const idToProposal = new Map<string, ClipProposal>();
  for (const p of proposalFile.proposals) idToProposal.set(p.id, p);

  let proposalIds = Array.isArray(body.proposalIds)
    ? body.proposalIds.filter((x): x is string => typeof x === 'string')
    : [];

  if (body.fromPlan) {
    // Derive "proposals" from the current plan clips: survivors of Lars's
    // timeline review, with any trimmed boundaries as the real cut points.
    const plan = readPlan(params.slug);
    if (!plan || plan.clips.length === 0) {
      return new Response(
        JSON.stringify({ error: 'fromPlan requested but the plan has no clips' }),
        { status: 400 },
      );
    }
    proposalIds = [];
    for (const clip of plan.clips) {
      const base = idToProposal.get(clip.id);
      const p: ClipProposal = base
        ? { ...base, startSec: clip.sourceStart, endSec: clip.sourceEnd }
        : {
            id: clip.id,
            startSec: clip.sourceStart,
            endSec: clip.sourceEnd,
            title: `clip at ${Math.round(clip.sourceStart)}s`,
            hook: '',
            reason: 'kept on the timeline during review',
            score: 50,
          };
      idToProposal.set(clip.id, p);
      proposalIds.push(clip.id);
    }
  }

  if (proposalIds.length === 0) {
    return new Response(
      JSON.stringify({ error: 'no proposalIds provided (or pass fromPlan: true)' }),
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

      const extractedSlugs: string[] = [];
      const failedIds: string[] = [];

      try {
        for (const id of proposalIds) {
          const proposal = idToProposal.get(id);
          if (!proposal) {
            log(`SKIP: proposal ${id} not found in clips-proposal.json`);
            failedIds.push(id);
            send('clip', { proposalId: id, status: 'failed', error: 'not-found' });
            continue;
          }

          try {
            stage('cutting');
            const { childSlug, childSource, childDir } = await extractClip({
              parentSlug: params.slug,
              parentSource,
              proposal,
              onLog: log,
            });

            stage('reframing');
            await reframeClip({
              videoPath: childSource,
              outPath: path.join(childDir, 'reframe.json'),
              diarizationPath: path.join(childDir, 'diarization.json'),
              onLog: log,
            });

            // Hand off to the shared talking-head pipeline through the
            // serial queue. Calling it in-process (not via HTTP) means
            // we surface every log line in the extract stream and bail
            // out cleanly on failure — the old internal-fetch pattern
            // sometimes swallowed errors behind the auth layer.
            send('clip', { proposalId: id, childSlug, status: 'queued' });
            await processQueue.run(
              childSlug,
              async () => {
                stage('processing');
                await runTalkingHeadPipeline({
                  slug: childSlug,
                  sourceAbsPath: childSource,
                  send,
                  skipTranscribe: true,
                });
              },
              {
                onPosition: (p) => {
                  if (p.position > 0) {
                    send('queue', {
                      slug: childSlug,
                      position: p.position,
                      ahead: p.ahead,
                    });
                  }
                },
                signal: req.signal,
              },
            );

            extractedSlugs.push(childSlug);
            send('clip', { proposalId: id, childSlug, status: 'extracted' });
            log(`\u2713 Extracted ${childSlug}`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            failedIds.push(id);
            log(`\u2717 Extraction failed for ${id}: ${msg}`);
            send('clip', { proposalId: id, status: 'failed', error: msg });
          }
        }

        stage('done');
        send('done', { extractedSlugs, failedIds });
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

