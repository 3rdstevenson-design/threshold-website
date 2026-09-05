import { NextRequest, NextResponse } from 'next/server';
import { buildContentBrief, renderBriefMarkdown } from '@/lib/contentBrief';

export const dynamic = 'force-dynamic';

/**
 * The content brief — what's working, where viewers leave, hook-hold
 * ranking, evergreen posts, pillar performance, and do-more/avoid
 * guidance. `?format=md` returns markdown (written to
 * ~/Code/Social Media/content-brief.md by scripts/write-content-brief.mjs
 * for the content-writing skills); default is JSON for the brief page.
 */
export async function GET(req: NextRequest) {
  const pwd = req.headers.get('x-dashboard-key');
  if (!process.env.DASHBOARD_PASSWORD || pwd !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const brief = await buildContentBrief();
  const { searchParams } = new URL(req.url);
  if (searchParams.get('format') === 'md') {
    return new NextResponse(renderBriefMarkdown(brief), {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    });
  }
  return NextResponse.json(brief);
}
