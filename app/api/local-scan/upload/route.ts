import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { uploadFile, uploadFiles } from '@/lib/upload';
import {
  appendPostIfNotExists,
  readQueue,
  QueuePost,
  ContentPillar,
  VoiceDnaViolationError,
} from '@/lib/queue';
import { suggestScheduleTimes } from '@/lib/scheduler';
import { transcribeVideoToCaptionDetailed } from '@/lib/transcribe';
import { generateCarouselCaption } from '@/lib/caption';

// Coalesce concurrent uploads for the same filename within this process so
// we don't waste work (R2 upload + Whisper transcription) on duplicates.
// The notes-key recheck in appendPostIfNotExists is the fallback for cases
// this Map can't cover (separate processes, restarts mid-flight).
const inflight = new Map<string, Promise<{ post: QueuePost; created: boolean }>>();

const PILLAR_KEYWORDS: Record<ContentPillar, string[]> = {
  exercise:    ['exercise', 'movement', 'workout', 'reel', 'stretch', 'mobility', 'train', 'vertical', 'square', 'landscape'],
  clinic_case: ['case', 'clinic', 'patient', 'injury', 'pain', 'rehab'],
  philosophy:  ['philosophy', 'belief', 'mindset', 'spiral', 'framework', 'verbiage', 'dog'],
  story:       ['story', 'personal', 'journey', 'intro', 'baad'],
};

function detectPillar(name: string): ContentPillar {
  const lower = name.toLowerCase();
  for (const [pillar, keywords] of Object.entries(PILLAR_KEYWORDS) as [ContentPillar, string[]][]) {
    if (keywords.some(k => lower.includes(k))) return pillar;
  }
  return 'exercise';
}

async function transcribeAndCaption(
  filePath: string,
  captionHint?: string,
): Promise<{ caption: string; fromSidecar: boolean }> {
  const { caption, fromSidecar } = await transcribeVideoToCaptionDetailed(filePath, captionHint);
  return {
    caption: caption || captionHint || '✏️ Add caption before approving',
    fromSidecar,
  };
}

/** Total source bytes: the video file for reels, the summed slides for
 *  carousels. Combined with the filename this is the dedupe identity — same
 *  name + same size = same content; a re-render/re-export (different size)
 *  is NEW content and gets a fresh post + fresh caption. */
function sourceSizeOf(type: 'reel' | 'carousel', filePath: string, slidePaths?: string[]): number | undefined {
  try {
    if (type === 'reel') return fs.statSync(filePath).size;
    if (slidePaths?.length) {
      return slidePaths.reduce((sum, p) => sum + fs.statSync(p).size, 0);
    }
  } catch {
    // Unreadable source — fall back to name-only dedupe rather than failing.
  }
  return undefined;
}

async function buildAndAppend(
  type: 'reel' | 'carousel',
  filePath: string,
  slidePaths: string[] | undefined,
  name: string,
  captionHint: string | undefined,
): Promise<{ post: QueuePost; created: boolean }> {
  const sourceSize = sourceSizeOf(type, filePath, slidePaths);
  const existingQueue = await readQueue();
  // Rows without sourceSize (everything queued before this field existed)
  // keep matching on name alone — never re-queue or touch existing entries.
  const duplicate = existingQueue.find(
    (p) =>
      p.notes === name &&
      (p.sourceSize === undefined || sourceSize === undefined || p.sourceSize === sourceSize),
  );
  if (duplicate) return { post: duplicate, created: false };

  const pillar = detectPillar(name);
  const [scheduledTime] = suggestScheduleTimes(pillar, existingQueue);

  let post: QueuePost;
  if (type === 'reel') {
    const [videoUrl, { caption, fromSidecar }] = await Promise.all([
      uploadFile(filePath, name),
      transcribeAndCaption(filePath, captionHint),
    ]);
    post = {
      id: uuidv4(),
      status: 'pending',
      type: 'reel',
      pillar,
      caption,
      // Human-written sidecar captions bypass the Voice-DNA queue gate —
      // Lars's own words are deliberate (the sidecar reader warn-logs lint hits).
      ...(fromSidecar ? { voiceOverride: true } : {}),
      videoUrl,
      ...(sourceSize !== undefined ? { sourceSize } : {}),
      scheduledTime: scheduledTime.toISOString(),
      createdAt: new Date().toISOString(),
      approvedAt: null,
      publishedAt: null,
      metaPublishId: null,
      notes: name,
      // No-monologue reels from the StoryReel pipeline (timelapse / caption-overlay)
      // are named story-*. Tag them for manual posting so they hand off to Telegram
      // (Lars adds trending audio in IG) instead of auto-publishing silent.
      ...(/^story-/i.test(name) ? { manualPost: true } : {}),
    };
  } else {
    const [imageUrls, carouselCaption] = await Promise.all([
      uploadFiles(slidePaths!),
      generateCarouselCaption(slidePaths!, captionHint),
    ]);
    post = {
      id: uuidv4(),
      status: 'pending',
      type: 'carousel',
      pillar,
      caption: carouselCaption || captionHint || '✏️ Add caption before approving',
      imageUrls,
      ...(sourceSize !== undefined ? { sourceSize } : {}),
      scheduledTime: scheduledTime.toISOString(),
      createdAt: new Date().toISOString(),
      approvedAt: null,
      publishedAt: null,
      metaPublishId: null,
      notes: name,
    };
  }

  try {
    return await appendPostIfNotExists(post, name, sourceSize);
  } catch (err) {
    // Voice-DNA gate degrade: an auto-generated caption with a hard lint
    // violation must not reject the whole insert — that 500 made the watcher
    // retry forever and the reel silently never queued. Queue it with the
    // placeholder caption (which passes the gate) and keep the violations on
    // the post so the queue UI can show what needs a human rewrite.
    if (err instanceof VoiceDnaViolationError) {
      const degraded: QueuePost = {
        ...post,
        caption: '✏️ Add caption before approving',
        voiceViolations: err.violations.map((v) => `[${v.category}] "${v.match}"`),
      };
      return appendPostIfNotExists(degraded, name, sourceSize);
    }
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { type, filePath, slidePaths, name, captionHint } = await req.json();
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

    let task = inflight.get(name);
    if (!task) {
      task = buildAndAppend(type, filePath, slidePaths, name, captionHint)
        .finally(() => inflight.delete(name));
      inflight.set(name, task);
    }

    const { post, created } = await task;
    return NextResponse.json(post, { status: created ? 201 : 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
