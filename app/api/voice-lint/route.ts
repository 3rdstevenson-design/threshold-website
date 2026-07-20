import { NextRequest, NextResponse } from 'next/server';
import { lintVoiceDna, lintAndAutoFix } from '@/lib/voice/voiceDnaLint';

export const dynamic = 'force-dynamic';

/**
 * Voice-DNA lint over HTTP, for callers outside this repo (the video
 * pipeline's auto-draft script). POST { text, autoFix? } →
 * { pass, violations, autoFixable, fixedText? }.
 */
export async function POST(req: NextRequest) {
  try {
    const { text, autoFix } = await req.json();
    if (typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'text (string) is required' }, { status: 400 });
    }
    if (autoFix) {
      const { text: fixedText, result } = lintAndAutoFix(text);
      return NextResponse.json({ ...result, fixedText });
    }
    return NextResponse.json(lintVoiceDna(text));
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
