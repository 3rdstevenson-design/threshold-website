import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
export const maxDuration = 600;

const SCRIPT_FOR_TEMPLATE: Record<string, string> = {
  framework: 'render:slides:framework-demo',
  'clinic-case': 'render:slides:clinic-demo',
  'principle-reveal': 'render:slides:principle-demo',
};

export async function POST(
  _req: NextRequest,
  { params }: { params: { name: string } },
) {
  const script = SCRIPT_FOR_TEMPLATE[params.name];
  if (!script) return NextResponse.json({ error: 'unknown template' }, { status: 404 });

  const cwd =
    process.env.REMOTION_PROJECT_DIR ??
    path.join(os.homedir(), 'Code', 'Social Media', 'my-video-projects');

  try {
    await execFileAsync('npm', ['run', script], {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 8 * 60 * 1000,
      env: { ...process.env },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `render failed: ${msg.slice(0, 500)}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
