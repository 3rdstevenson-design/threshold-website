import { NextResponse } from 'next/server';
import { listProjects } from '@/lib/editor/status';
import { activeJobs } from '@/lib/editor/jobRunner';
import { sweepInterruptedJobs } from '@/lib/editor/jobPersistence';
import { scanLocalFiles } from '@/lib/localScan';
import { readQueueWithMeta } from '@/lib/queue';
import { derivePipeline } from '@/lib/pipelineState';
import type { QueuePost } from '@/lib/queue';

// Live filesystem + R2 reads on every request (same reasoning as /api/queue
// and /api/local-scan — Next can't see these as dynamic signals).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET() {
  // Same restart sweep the editor routes run — the health view must never
  // show a dead job as "Processing in editor".
  sweepInterruptedJobs();

  const live = activeJobs();
  const projects = listProjects().map((p) => ({ ...p, active: p.slug in live }));
  const files = scanLocalFiles();

  let posts: QueuePost[] = [];
  let offline = false;
  let cachedAt: string | undefined;
  let queueUnavailable = false;
  try {
    const meta = await readQueueWithMeta();
    posts = meta.posts;
    offline = meta.source === 'cache';
    cachedAt = meta.cachedAt;
  } catch {
    // No live queue AND no snapshot: still show the editor/disk half of the
    // pipeline rather than failing the whole view.
    queueUnavailable = true;
    offline = true;
  }

  const items = derivePipeline({
    projects, files, posts, offline,
    queueUnknown: queueUnavailable,
    now: new Date(),
  });

  return NextResponse.json({
    items,
    offline,
    cachedAt,
    queueUnavailable,
    generatedAt: new Date().toISOString(),
  });
}
