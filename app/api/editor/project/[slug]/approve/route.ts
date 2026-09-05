/**
 * POST /api/editor/project/[slug]/approve
 *
 * The human decision the unattended pipeline paused for. Clears the
 * project's review state and either:
 *   - { promoteOnly: true }  → promotes the existing final-v2.mp4 as-is
 *                              (the audit-fail case; nothing re-renders), or
 *   - default                → re-runs the polish stream with gate:'approved'
 *                              on the CURRENT plan, so retake flips, header
 *                              edits and restored cuts made during review
 *                              survive. Optional approvedRangeIds narrows the
 *                              LLM cuts to the reviewed set.
 *
 * Deliberately NOT /process: runTalkingHeadPipeline re-runs the cut stages
 * and would replace the reviewed clips wholesale.
 *
 * Streams the job's SSE like /process; the job survives a disconnect.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkAuth, validateSlug } from '@/lib/editor/paths';
import { readProject, writeStatus } from '@/lib/editor/status';
import { startJob, type Emit } from '@/lib/editor/jobRunner';
import { observeJob } from '@/lib/editor/jobStream';
import { runPolishStream } from '@/lib/editor/polishPipeline';
import { promoteV2Artifacts } from '@/lib/editor/promoteV2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 900;

type Body = { approvedRangeIds?: unknown; promoteOnly?: unknown };

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  const slug = params.slug;
  if (!validateSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  const project = readProject(slug);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let body: Body = {};
  try { body = (await req.json()) as Body; } catch { body = {}; }
  const approvedRangeIds: string[] | null = Array.isArray(body.approvedRangeIds)
    ? body.approvedRangeIds.filter((x): x is string => typeof x === 'string')
    : null;
  const promoteOnly = body.promoteOnly === true;

  const resolvedReview = project.review?.required
    ? { ...project.review, required: false, resolvedAt: new Date().toISOString() }
    : project.review ?? null;

  if (promoteOnly) {
    const r = promoteV2Artifacts(slug);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
    writeStatus(slug, { review: resolvedReview, error: null, outputPath: r.outputPath });
    return NextResponse.json({ ok: true, promoted: true, outputPath: r.outputPath, from: r.from });
  }

  writeStatus(slug, { review: resolvedReview, error: null, warnings: [] });
  const run = async (emit: Emit, signal: AbortSignal) => {
    try {
      await runPolishStream({ slug, approvedRangeIds, send: emit, signal, gate: 'approved' });
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e);
      if (signal.aborted) msg = 'Canceled. Press Approve & render to re-run.';
      writeStatus(slug, { error: msg });
      emit('error', { msg });
    }
  };
  const job = startJob(slug, run);
  return observeJob(job, req);
}
