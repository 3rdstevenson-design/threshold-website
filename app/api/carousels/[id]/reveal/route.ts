import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { draftPaths, readDraft } from '@/lib/carouselDrafts';

const execFileAsync = promisify(execFile);

interface Params {
  params: { id: string };
}

export async function POST(_req: NextRequest, { params }: Params) {
  const plan = readDraft(params.id);
  if (!plan) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });

  const { dir } = draftPaths(params.id);
  try {
    await execFileAsync('open', [dir]);
    return NextResponse.json({ ok: true, path: dir });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'open failed' }, { status: 500 });
  }
}
