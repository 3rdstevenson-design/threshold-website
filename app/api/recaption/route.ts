import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { readQueue, updatePost, VoiceDnaViolationError } from '@/lib/queue';
import { resolveDraftFile, transcribeVideoToCaptionDetailed } from '@/lib/transcribe';
import { generateCarouselCaption } from '@/lib/caption';

export async function POST(req: NextRequest) {
  try {
    const { id, filePath: providedPath } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const posts = await readQueue();
    const post = posts.find(p => p.id === id);
    if (!post) return NextResponse.json({ error: 'post not found' }, { status: 404 });

    // Most common real-world failure: the dev server was started before the
    // API keys were added to .env.local, so they're absent from its env (env
    // is read once at boot). Without this guard the helpers just return null →
    // an opaque "Caption generation failed". Surface the real, actionable cause.
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY isn’t loaded in the running server (it IS in .env.local). Restart the dev server to pick it up.' },
        { status: 503 },
      );
    }
    if (post.type !== 'carousel' && !process.env.DEEPGRAM_API_KEY && !process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'Neither DEEPGRAM_API_KEY nor OPENAI_API_KEY is loaded in the running server (check .env.local). Restart the server to pick them up.' },
        { status: 503 },
      );
    }

    let caption: string | null = null;
    let fromSidecar = false;

    if (post.type === 'carousel') {
      const sources = post.imageUrls ?? [];
      if (sources.length === 0) {
        return NextResponse.json({ error: 'carousel has no image urls' }, { status: 404 });
      }
      caption = await generateCarouselCaption(sources);
    } else {
      let filePath: string | null =
        providedPath && fs.existsSync(providedPath) ? providedPath : null;
      if (!filePath && post.notes) filePath = resolveDraftFile(post.notes);
      if (!filePath) {
        return NextResponse.json(
          { error: 'source file not found in local drafts' },
          { status: 404 },
        );
      }
      ({ caption, fromSidecar } = await transcribeVideoToCaptionDetailed(filePath));
    }

    if (!caption) {
      return NextResponse.json(
        { error: 'Caption generation returned nothing — the transcription or caption step failed. Check the dev-server logs.' },
        { status: 422 },
      );
    }

    // Sidecar captions are Lars's own words — bypass the Voice-DNA queue gate.
    await updatePost(id, { caption, ...(fromSidecar ? { voiceOverride: true } : {}) });
    const updated = (await readQueue()).find(p => p.id === id);
    return NextResponse.json(updated ?? { id, caption });
  } catch (err: any) {
    if (err instanceof VoiceDnaViolationError) {
      return NextResponse.json(
        { error: err.message, voiceViolations: err.violations },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
