/**
 * POST /api/editor/project/[slug]/polish/propose
 *
 * Detection-only phase of the Polish pipeline. Runs the Claude
 * disfluency pass and writes `disfluency-proposal.json`, then returns
 * the proposed ranges (including ones dropped by the caps — the UI may
 * still want to show them as "too long / over cap" chips).
 *
 * This endpoint does NOT cut video or touch the edit plan. The user
 * reviews the chips in `DisfluencyReviewPanel`, picks which cuts they
 * want, and hits the main Polish button — which then POSTs to the
 * regular `/polish` route with `{ approvedRangeIds: [...] }` to skip
 * re-detection and apply only those cuts.
 *
 * Why a separate endpoint: detection is where Claude gets to be
 * opinionated (and sometimes wrong). Separating it from the render
 * pipeline means the user can iterate on the proposal cheaply — no
 * 2-minute ffmpeg + Remotion round-trip per tweak.
 */
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { checkAuth, validateSlug, TAKES_ROOT } from '@/lib/editor/paths';
import { readPlan } from '@/lib/editor/planStore';
import { detectDisfluencies } from '@/lib/editor/disfluency';
import { getPerformanceCorpus, renderCorpusForPrompt } from '@/lib/performanceCorpus';
import type { Word } from '@/lib/editor/autoCut';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * GET — the proposal already on disk from the last run (no LLM call), so the
 * review panel can open on what the unattended pipeline actually saw.
 */
export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) return new Response(JSON.stringify({ error: 'invalid slug' }), { status: 400 });
  const p = path.join(TAKES_ROOT, params.slug, 'disfluency-proposal.json');
  if (!fs.existsSync(p)) return new Response(JSON.stringify({ error: 'no proposal yet' }), { status: 404 });
  return new Response(fs.readFileSync(p, 'utf8'), { headers: { 'Content-Type': 'application/json' } });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) {
    return new Response(JSON.stringify({ error: 'invalid slug' }), { status: 400 });
  }

  const plan = readPlan(params.slug);
  if (!plan) {
    return new Response(
      JSON.stringify({ error: 'no edit plan — run Analyze audio first' }),
      { status: 404 },
    );
  }
  if (plan.clips.length === 0) {
    return new Response(JSON.stringify({ error: 'plan has no clips' }), { status: 400 });
  }

  const slugDir = path.join(TAKES_ROOT, params.slug);
  const analysisPath = path.join(slugDir, 'analysis.json');
  if (!fs.existsSync(analysisPath)) {
    return new Response(
      JSON.stringify({ error: 'analysis.json missing — run Analyze first' }),
      { status: 404 },
    );
  }
  const analysisRaw = JSON.parse(fs.readFileSync(analysisPath, 'utf8')) as {
    words?: Word[];
  };
  const words = analysisRaw.words ?? [];
  if (words.length === 0) {
    return new Response(
      JSON.stringify({ error: 'analysis.json has no words — re-run Analyze' }),
      { status: 400 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 500 },
    );
  }

  const logs: string[] = [];

  // Pull performance corpus; fail-soft if analytics has no data yet.
  let performanceContext: string | undefined;
  try {
    const corpus = await getPerformanceCorpus();
    performanceContext = renderCorpusForPrompt(corpus) ?? undefined;
  } catch (e) {
    logs.push(
      `WARN: corpus unavailable (${e instanceof Error ? e.message : String(e)}) — running without performance context.`,
    );
  }

  try {
    const disfluency = await detectDisfluencies({
      words,
      clips: plan.clips,
      apiKey,
      performanceContext,
      onLog: (m) => logs.push(m),
    });

    const proposalPath = path.join(slugDir, 'disfluency-proposal.json');
    const payload = {
      generatedAt: new Date().toISOString(),
      wordCount: disfluency.wordCount,
      scopedSeconds: disfluency.scopedSeconds,
      // `proposed` includes rejected entries (with .rejected flag) so the
      // UI can show them as disabled chips. `ranges` is the kept subset.
      proposed: disfluency.proposed,
      keptIds: disfluency.ranges.map((r) => r.id),
      raw: disfluency.raw,
      logs,
    };
    fs.writeFileSync(proposalPath, JSON.stringify(payload, null, 2));

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg, logs }), { status: 500 });
  }
}
