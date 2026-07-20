/**
 * retentionFrames.ts
 *
 * For each drop-cliff detected in a Reel's retention curve, extract a
 * single frame from the local rendered `.mp4` at the second viewers began
 * dropping, upload the JPEG to R2, and ask Claude (vision) to describe
 * what's on screen in 1-2 sentences.
 *
 * Why once-per-upload, not once-per-editor-call:
 *   - Vision tokens are expensive per call; editor prompts run frequently.
 *   - What's on screen at a given cliff is static — it doesn't change
 *     until the user re-renders the Reel. Cache it on the PostPerformance
 *     record and let the editor read text descriptions only.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { PutObjectCommand } from '@aws-sdk/client-s3';

import { extractThumb } from './editor/ffmpeg';
import { r2, R2_BUCKET, r2PublicUrl, useR2 } from './r2';
import type { RetentionFrame } from './analyticsStore';

export interface Cliff {
  secondRange: [number, number];
}

const FRAME_SYSTEM_PROMPT = `You describe a single frame from an Instagram Reel.
This frame was captured at the exact second viewers began dropping off.
In 1-2 short sentences, describe what's visually happening: what's on
screen, the energy level, any distractions or low-momentum beats. No
preamble. No diagnosis — just observation. No more than 40 words.`;

export async function extractFramesForCliffs(input: {
  mediaId: string;
  slug?: string;
  videoAbsPath: string;
  cliffs: Cliff[];
  apiKey: string;
  model?: string;
  onLog?: (msg: string) => void;
}): Promise<RetentionFrame[]> {
  const log = input.onLog ?? (() => {});
  if (input.cliffs.length === 0) return [];
  if (!fs.existsSync(input.videoAbsPath)) {
    log(`Video not found at ${input.videoAbsPath}, skipping frame extraction.`);
    return [];
  }
  if (!useR2()) {
    log('R2 not configured — cannot store retention frames.');
    return [];
  }

  const anthropic = new Anthropic({ apiKey: input.apiKey });
  const model = input.model ?? 'claude-sonnet-4-6';

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `retention-frames-${input.mediaId}-`));
  const frames: RetentionFrame[] = [];

  try {
    for (const cliff of input.cliffs) {
      const atSec = cliff.secondRange[0];
      const framePath = path.join(tmpDir, `${atSec}.jpg`);
      try {
        await extractThumb(input.videoAbsPath, framePath, atSec, 480);
      } catch (e) {
        log(`Frame extract failed at ${atSec}s: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      const bytes = fs.readFileSync(framePath);

      const key = `analytics/retention-frames/${input.mediaId}/${atSec}.jpg`;
      try {
        await r2.send(new PutObjectCommand({
          Bucket: R2_BUCKET(),
          Key: key,
          Body: bytes,
          ContentType: 'image/jpeg',
        }));
      } catch (e) {
        log(`R2 upload failed for ${key}: ${e instanceof Error ? e.message : e}`);
        continue;
      }

      let description = '';
      try {
        const res = await anthropic.messages.create({
          model,
          max_tokens: 150,
          system: FRAME_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: bytes.toString('base64'),
                  },
                },
                { type: 'text', text: `Describe this frame (captured at ${atSec}s).` },
              ],
            },
          ],
        });
        description = res.content[0]?.type === 'text' ? res.content[0].text.trim() : '';
      } catch (e) {
        log(`Claude vision failed at ${atSec}s: ${e instanceof Error ? e.message : e}`);
      }

      frames.push({
        sec: atSec,
        frameUrl: r2PublicUrl(key),
        description,
      });
      log(`Frame ${atSec}s: "${description.slice(0, 80)}${description.length > 80 ? '…' : ''}"`);
    }
  } finally {
    try {
      for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir, f));
      fs.rmdirSync(tmpDir);
    } catch {}
  }

  return frames;
}
