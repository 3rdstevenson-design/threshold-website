import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { uploadFile, uploadFiles } from '@/lib/upload';
import { appendPost, readQueue, QueuePost, ContentPillar } from '@/lib/queue';
import { suggestScheduleTimes } from '@/lib/scheduler';

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

export async function POST(req: NextRequest) {
  try {
    const { type, filePath, slidePaths, name, captionHint } = await req.json();

    const pillar = detectPillar(name);
    const existing = await readQueue();
    const [scheduledTime] = suggestScheduleTimes(pillar, existing);

    let post: QueuePost;

    if (type === 'reel') {
      const videoUrl = await uploadFile(filePath, name);
      post = {
        id: uuidv4(),
        status: 'pending',
        type: 'reel',
        pillar,
        caption: captionHint || '✏️ Add caption before approving',
        videoUrl,
        scheduledTime: scheduledTime.toISOString(),
        createdAt: new Date().toISOString(),
        approvedAt: null,
        publishedAt: null,
        metaPublishId: null,
        notes: name,
      };
    } else {
      const imageUrls = await uploadFiles(slidePaths);
      post = {
        id: uuidv4(),
        status: 'pending',
        type: 'carousel',
        pillar,
        caption: captionHint || '✏️ Add caption before approving',
        imageUrls,
        scheduledTime: scheduledTime.toISOString(),
        createdAt: new Date().toISOString(),
        approvedAt: null,
        publishedAt: null,
        metaPublishId: null,
        notes: name,
      };
    }

    await appendPost(post);
    return NextResponse.json(post, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
