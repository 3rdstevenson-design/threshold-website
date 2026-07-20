import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '@/lib/editor/paths';
import { listProjects } from '@/lib/editor/status';
import { sweepInterruptedJobs } from '@/lib/editor/jobPersistence';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  // First editor touch after a restart: flag jobs the old process left
  // in-flight as interrupted (once per process) BEFORE listing, so nothing
  // masquerades as "Processing…" in the sidebar.
  sweepInterruptedJobs();
  return NextResponse.json({ projects: listProjects() });
}
