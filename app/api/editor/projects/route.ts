import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '@/lib/editor/paths';
import { listProjects } from '@/lib/editor/status';
import { sweepInterruptedJobs } from '@/lib/editor/jobPersistence';
import { activeJobs } from '@/lib/editor/jobRunner';
import { readInboxEntries } from '@/lib/editor/inbox';

export const dynamic = 'force-dynamic';

/**
 * GET /api/editor/projects
 *
 * Every project's durable status merged with the live job registry, so a
 * freshly loaded page can tell which rows have a pipeline running server-side
 * (`active`, `activeStage`, `queuePosition`) and reattach to their streams.
 * Also returns the AirDrop inbox entries that haven't become projects yet.
 */
export async function GET(req: NextRequest) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  // First editor touch after a restart: flag jobs the old process left
  // in-flight as interrupted (once per process) BEFORE listing, so nothing
  // masquerades as "Processing…" in the sidebar.
  sweepInterruptedJobs();
  const live = activeJobs();
  const projects = listProjects().map((p) => {
    const j = live[p.slug];
    return j
      ? {
          ...p,
          active: true,
          activeStage: j.stage,
          queuePosition: j.queuePosition,
          progressPct: j.progressPct,
          stageStartedAt: j.stageStartedAt,
        }
      : { ...p, active: false };
  });
  return NextResponse.json({ projects, inbox: readInboxEntries() });
}
