/**
 * retentionParser.ts
 *
 * Claude vision pass: extract the per-second retention curve from a
 * screenshot of Instagram's Professional Dashboard retention chart.
 *
 * Meta's Graph API does not expose per-second drop-off for Reels — you
 * can only see that in the native dashboard UI. The user takes a
 * screenshot of the bar chart and uploads it via
 * /api/analytics/retention-upload; this module hands the image to
 * Claude with a narrow schema and gets back {curve, videoDurationSec}.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { RetentionPoint } from './analyticsStore';

export interface ParsedRetention {
  curve: RetentionPoint[];
  videoDurationSec?: number;
  /** Claude's own read on what it saw (for logging). */
  notes?: string;
  raw: string;
}

const SYSTEM_PROMPT = `You extract structured data from Instagram Reels retention charts.

The user uploads a screenshot of the Instagram Professional Dashboard "Retention" view for a single Reel. It is usually a horizontal bar chart where:
  - The x-axis is time in seconds from 0 to the Reel's total duration.
  - The y-axis (or bar height) is the percentage of viewers still watching, 0 to 100.
  - The first bar (second 0) is almost always 100%.
  - The curve is monotonically non-increasing or very close to it.

Your job:
  1. Read the chart as carefully as you can.
  2. Output a retention curve: an array of {sec, pctViewers} points, one per visible bar or at roughly 1-second spacing.
  3. Output the video duration in seconds if the chart shows it.
  4. Include a very short notes field describing anything notable (e.g. "sharp drop around 3s", "nearly flat after 10s", "couldn't read last 2s clearly").

OUTPUT FORMAT: Return a single JSON object ONLY, no prose, no code fence.

{
  "curve": [{"sec": 0, "pctViewers": 100}, {"sec": 1, "pctViewers": 94}, ...],
  "videoDurationSec": 28,
  "notes": "sharp drop between 2s and 4s, plateau after 8s"
}

If the image is unreadable or is not a retention chart, return:
{"curve": [], "notes": "could not read retention chart"}

Always include sec=0 with pctViewers=100 if the chart starts there (which it almost always does). Clamp pctViewers to [0, 100]. Use integers for sec. Round pctViewers to 1 decimal place.`;

export async function parseRetentionScreenshot(input: {
  imageBase64: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  apiKey: string;
  model?: string;
  onLog?: (msg: string) => void;
}): Promise<ParsedRetention> {
  const log = input.onLog ?? (() => {});
  const anthropic = new Anthropic({ apiKey: input.apiKey });
  const model = input.model ?? 'claude-sonnet-4-6';

  log(`Running Claude vision retention parse (${model})…`);

  const res = await anthropic.messages.create({
    model,
    max_tokens: 3000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: input.mediaType,
              data: input.imageBase64,
            },
          },
          {
            type: 'text',
            text: 'Extract the retention curve from this chart.',
          },
        ],
      },
    ],
  });

  const raw = res.content[0]?.type === 'text' ? res.content[0].text.trim() : '';
  if (!raw) {
    log('Claude returned empty vision response.');
    return { curve: [], raw };
  }

  return parseVisionJson(raw);
}

export function parseVisionJson(raw: string): ParsedRetention {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return { curve: [], raw, notes: 'JSON parse failed' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { curve: [], raw, notes: 'response not an object' };
  }
  const obj = parsed as Record<string, unknown>;

  const rawCurve = Array.isArray(obj.curve) ? obj.curve : [];
  const curve: RetentionPoint[] = [];
  for (const pt of rawCurve) {
    if (!pt || typeof pt !== 'object') continue;
    const p = pt as Record<string, unknown>;
    const sec = typeof p.sec === 'number' ? Math.round(p.sec) : NaN;
    const pctViewers =
      typeof p.pctViewers === 'number'
        ? Math.max(0, Math.min(100, p.pctViewers))
        : NaN;
    if (!Number.isFinite(sec) || !Number.isFinite(pctViewers)) continue;
    curve.push({ sec, pctViewers: Math.round(pctViewers * 10) / 10 });
  }
  curve.sort((a, b) => a.sec - b.sec);

  // De-duplicate seconds, keep the higher pct at each.
  const dedup: RetentionPoint[] = [];
  for (const p of curve) {
    const last = dedup[dedup.length - 1];
    if (last && last.sec === p.sec) {
      last.pctViewers = Math.max(last.pctViewers, p.pctViewers);
    } else {
      dedup.push(p);
    }
  }

  const videoDurationSec =
    typeof obj.videoDurationSec === 'number' && obj.videoDurationSec > 0
      ? Math.round(obj.videoDurationSec)
      : undefined;
  const notes = typeof obj.notes === 'string' ? obj.notes : undefined;

  return { curve: dedup, videoDurationSec, notes, raw };
}
