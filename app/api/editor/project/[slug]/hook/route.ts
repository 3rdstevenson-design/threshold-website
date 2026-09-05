/**
 * GET  /api/editor/project/[slug]/hook            → hook-proposal.json (404 if none)
 * POST /api/editor/project/[slug]/hook
 *        { regenerate: true }                      → new proposal from the current plan
 *        { choose: "<candidateId>" }               → apply that candidate as the header
 *        { clear: true }                           → drop an auto header
 */
import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { checkAuth, TAKES_ROOT, validateSlug } from '@/lib/editor/paths';
import { readPlan, writePlan } from '@/lib/editor/planStore';
import { applyAction } from '@/lib/editor/editPlan';
import { applyHookToPlan, proposeHook, type HookProposal } from '@/lib/editor/hookProposal';
import type { Word } from '@/lib/editor/autoCut';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

function hookPath(slug: string) { return path.join(TAKES_ROOT, slug, 'hook-proposal.json'); }
function readHook(slug: string): HookProposal | null {
  try { return fs.existsSync(hookPath(slug)) ? (JSON.parse(fs.readFileSync(hookPath(slug), 'utf8')) as HookProposal) : null; } catch { return null; }
}

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  const h = readHook(params.slug);
  if (!h) return NextResponse.json({ error: 'no hook proposal yet' }, { status: 404 });
  return NextResponse.json(h);
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  const slug = params.slug;
  if (!validateSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  let body: { regenerate?: unknown; choose?: unknown; clear?: unknown } = {};
  try { body = await req.json(); } catch {}

  const plan = readPlan(slug);
  if (!plan) return NextResponse.json({ error: 'no edit plan' }, { status: 404 });

  if (body.clear === true) {
    const next = applyAction(plan, { type: 'clear_header', params: {} });
    writePlan(next);
    const h = readHook(slug);
    if (h) { h.applied = false; fs.writeFileSync(hookPath(slug), JSON.stringify(h, null, 2)); }
    return NextResponse.json({ ok: true, header: null });
  }

  if (typeof body.choose === 'string') {
    const h = readHook(slug);
    if (!h) return NextResponse.json({ error: 'no hook proposal to choose from' }, { status: 404 });
    // An explicit pick overrides a user header — the user is choosing.
    const forced = { ...plan, hook: { source: 'auto' as const, proposalId: null, appliedAt: new Date().toISOString() } };
    const r = applyHookToPlan(forced, h, body.choose);
    if (!r.applied) return NextResponse.json({ error: r.skippedBecause ?? 'candidate not found' }, { status: 400 });
    writePlan(r.plan);
    h.chosenId = body.choose;
    h.applied = true;
    fs.writeFileSync(hookPath(slug), JSON.stringify(h, null, 2));
    return NextResponse.json({ ok: true, header: r.plan.header, proposal: h });
  }

  // regenerate
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  const analysisPath = path.join(TAKES_ROOT, slug, 'analysis.json');
  if (!fs.existsSync(analysisPath)) return NextResponse.json({ error: 'analysis.json missing — process the video first' }, { status: 409 });
  const words = ((JSON.parse(fs.readFileSync(analysisPath, 'utf8')) as { words?: Word[] }).words) ?? [];
  try {
    const h = await proposeHook({ words, clips: plan.clips, apiKey });
    // Regenerate never overwrites a user header by itself; it just refreshes
    // the suggestion list. Apply only when the current header is auto/empty.
    const r = applyHookToPlan(plan, h);
    h.applied = r.applied;
    if (r.skippedBecause) h.skippedBecause = r.skippedBecause;
    if (r.applied) writePlan(r.plan);
    fs.writeFileSync(hookPath(slug), JSON.stringify(h, null, 2));
    return NextResponse.json({ ok: true, proposal: h, header: r.applied ? r.plan.header : plan.header });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
