import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readDraft, updateDraftMeta } from '@/lib/slideDrafts';

const execFileAsync = promisify(execFile);
export const maxDuration = 600;

// POST /api/slides/[id]/render — render the draft's composition to final.mp4
// without queueing. Used by the dashboard's "Re-render preview" button. The
// render script writes data/slides-drafts/<id>/final.mp4 inside the Remotion
// project; the dashboard streams it back via /api/slides/[id]/video.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const plan = readDraft(params.id);
  if (!plan) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });

  updateDraftMeta(params.id, { status: 'rendering', error: undefined });

  const cwd =
    process.env.REMOTION_PROJECT_DIR ??
    path.join(os.homedir(), 'Code', 'Social Media', 'my-video-projects');

  try {
    await execFileAsync('npm', ['run', 'render:slides', '--', '--slug', params.id], {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 8 * 60 * 1000,
      env: { ...process.env },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateDraftMeta(params.id, { status: 'error', error: msg.slice(0, 500) });
    return NextResponse.json({ error: `render failed: ${msg.slice(0, 500)}` }, { status: 500 });
  }

  updateDraftMeta(params.id, {
    status: 'rendered',
    renderedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
