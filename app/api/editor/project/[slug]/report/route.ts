/**
 * GET /api/editor/project/[slug]/report — the run's pipeline-report.json
 * (stage timings, cut counts, LLM proposed/kept, audit numbers + gate
 * decision, review reasons, warnings). 404 until a run has started.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkAuth, validateSlug } from '@/lib/editor/paths';
import { readReport } from '@/lib/editor/pipelineReport';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  const report = readReport(params.slug);
  if (!report) return NextResponse.json({ error: 'no report yet' }, { status: 404 });
  return NextResponse.json(report);
}
