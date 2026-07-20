import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  readDraft,
  updateDraftMeta,
  draftPaths,
  hasRenderedMp4,
} from '@/lib/slideDrafts';
import { QueuePost, appendPost, readQueue, VoiceDnaViolationError } from '@/lib/queue';
import { lintAndAutoFix } from '@/lib/voice/voiceDnaLint';
import { suggestScheduleTimes } from '@/lib/scheduler';
import { r2, R2_BUCKET, r2PublicUrl, useR2 } from '@/lib/r2';

const execFileAsync = promisify(execFile);
export const maxDuration = 600;

async function uploadMp4(localPath: string, key: string): Promise<string> {
  const body = fs.readFileSync(localPath);
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET(),
      Key: key,
      Body: body,
      ContentType: 'video/mp4',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return r2PublicUrl(key);
}

// POST /api/slides/[id]/export — render (if needed) then upload + queue.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const plan = readDraft(params.id);
  if (!plan) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });

  const paths = draftPaths(params.id);
  const cwd =
    process.env.REMOTION_PROJECT_DIR ??
    path.join(os.homedir(), 'Code', 'Social Media', 'my-video-projects');

  // Render if not already rendered.
  if (!hasRenderedMp4(params.id)) {
    updateDraftMeta(params.id, { status: 'rendering', error: undefined });
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
  }

  if (!fs.existsSync(paths.finalMp4)) {
    updateDraftMeta(params.id, { status: 'error', error: 'final.mp4 missing after render' });
    return NextResponse.json({ error: 'final.mp4 missing after render' }, { status: 500 });
  }

  updateDraftMeta(params.id, { status: 'exporting' });

  let videoUrl: string;
  if (useR2()) {
    videoUrl = await uploadMp4(paths.finalMp4, `slides/${params.id}/final.mp4`);
  } else {
    videoUrl = `file://${paths.finalMp4}`;
  }

  const existingPosts = await readQueue();
  const [scheduled] = suggestScheduleTimes(plan.meta.pillar, existingPosts);

  const captionScript = plan.script as Record<string, unknown>;
  const rawCaption =
    typeof captionScript.caption === 'string'
      ? captionScript.caption
      : `${plan.meta.topic}\n\nBe Good. Help Someone. Learn Lots.`;
  // Mechanical Voice-DNA fixes (em dash, "!", we→I); remaining hard
  // violations surface as a 422 from the queue gate below.
  const caption = lintAndAutoFix(rawCaption).text;

  const postId = `slides-${params.id}-${Date.now()}`;
  const post: QueuePost = {
    id: postId,
    status: 'pending',
    type: 'reel',
    pillar: plan.meta.pillar,
    caption,
    videoUrl,
    scheduledTime: (scheduled ?? new Date(Date.now() + 24 * 60 * 60 * 1000)).toISOString(),
    createdAt: new Date().toISOString(),
    approvedAt: null,
    publishedAt: null,
    metaPublishId: null,
    notes: `From slides draft ${params.id}`,
  };

  try {
    await appendPost(post);
  } catch (err) {
    if (err instanceof VoiceDnaViolationError) {
      // Render output is kept on disk, so a re-export after fixing the
      // caption skips the render and only retries this queue step.
      updateDraftMeta(params.id, { status: 'error', error: err.message.slice(0, 500) });
      return NextResponse.json(
        { error: err.message, voiceViolations: err.violations },
        { status: 422 },
      );
    }
    throw err;
  }
  updateDraftMeta(params.id, {
    status: 'queued',
    exportedAt: new Date().toISOString(),
    queuePostId: postId,
  });

  return NextResponse.json({
    ok: true,
    queuePostId: postId,
    videoUrl,
    scheduledTime: post.scheduledTime,
  });
}
