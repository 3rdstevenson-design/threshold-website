/**
 * GET /api/editor/project/[slug]/analysis
 *
 * Returns the raw analysis.json (whisper words + silences) so the editor
 * can run auto-cut client-side. Returns 404 if analysis hasn't been produced.
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

  const analysisPath = path.join(TAKES_ROOT, params.slug, 'analysis.json');
  if (!fs.existsSync(analysisPath)) {
    return NextResponse.json({ error: 'no analysis yet' }, { status: 404 });
  }

  try {
    const raw = JSON.parse(fs.readFileSync(analysisPath, 'utf-8'));
    return NextResponse.json({
      duration: raw.duration,
      words: raw.words ?? [],
      silences: raw.silences ?? [],
      segments: raw.segments ?? [],
      // Legacy-compat: surface a missing-words flag so the UI can offer a
      // "re-analyze" button for projects transcribed before we started
      // writing words[].
      hasWords: Array.isArray(raw.words) && raw.words.length > 0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'failed to parse analysis.json' },
      { status: 500 },
    );
  }
}
