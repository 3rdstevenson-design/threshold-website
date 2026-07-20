/**
 * GET /api/editor/project/[slug]/clips-proposal
 *
 * Returns the Claude-generated viral-moment proposals for a long-form
 * project. Drives the ClipProposalPanel review UI. 404 if the proposal
 * step hasn't run yet.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { checkAuth, validateSlug, TAKES_ROOT } from '@/lib/editor/paths';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!validateSlug(params.slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  }

  const proposalPath = path.join(TAKES_ROOT, params.slug, 'clips-proposal.json');
  if (!fs.existsSync(proposalPath)) {
    return NextResponse.json({ error: 'no proposals yet' }, { status: 404 });
  }
  try {
    const raw = JSON.parse(fs.readFileSync(proposalPath, 'utf-8'));
    return NextResponse.json(raw);
  } catch {
    return NextResponse.json(
      { error: 'failed to parse clips-proposal.json' },
      { status: 500 },
    );
  }
}
