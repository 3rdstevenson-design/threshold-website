/**
 * performanceCorpus.ts
 *
 * Aggregate published-reel performance signal into a compact JSON
 * structure that the editor's Claude calls (disfluency detection and
 * clip proposal) can reason over as soft context.
 *
 * Two inputs feed the corpus:
 *   1. Meta Graph API watch-time metrics (avgWatchTimeMs, videoDurationMs,
 *      replays) pulled by the /api/cron/content-performance-sync job.
 *   2. Per-reel retention curves (seconds → % viewers) parsed from
 *      manually uploaded screenshots of Instagram's Professional
 *      Dashboard — the only path to per-second data since Meta's API
 *      does not expose drop-off curves.
 *
 * The corpus is deliberately small (target < 1500 tokens when stringified)
 * so it can be injected into every editor prompt cheaply. It summarizes
 * patterns, not individual posts.
 */
import fs from 'fs';
import path from 'path';
import type { PostPerformance, RetentionFrame, RetentionPoint } from './analyticsStore';
import { readAnalytics } from './analyticsStore';

export type HookStyle =
  | 'Question hook'
  | 'Statistic or list hook'
  | 'Story hook'
  | 'Contrarian hook'
  | 'Statement hook';

export interface HookPatternStat {
  pattern: HookStyle;
  sampleSize: number;
  avgCompletionRate: number;
  /** Percentage-point delta vs the overall baseline completion rate. */
  deltaPp: number;
}

export interface LengthBucketStat {
  bucketSec: string; // e.g. "0-15", "15-30", "30-60", "60+"
  sampleSize: number;
  avgCompletionRate: number;
}

export interface DropCliff {
  secondRange: [number, number];
  medianPctDrop: number;
  sampleSize: number;
  commonCauseHypothesis?: string;
  /** Claude-vision descriptions of what was on screen on prior Reels at
   *  this cliff. Deduped, capped at 3, most-recent first. Populated only
   *  when PostPerformance.retentionFrames exists for at least one reel
   *  with a matching cliff window. */
  observedVisualContexts?: string[];
}

export interface PerformerSummary {
  mediaId: string;
  caption: string;
  hook: string;
  hookStyle: HookStyle;
  completionRate: number;
  views: number;
}

/**
 * Hand-picked viral reel from an external creator, used as few-shot
 * positive examples in the clip-proposal prompt. Built by
 * scripts/build-external-corpus.ts (yt-dlp + Deepgram + Claude annotate).
 */
export interface ExternalExample {
  /** Stable id derived from the URL. */
  id: string;
  url: string;
  platform: 'instagram' | 'tiktok' | 'youtube-shorts' | 'other';
  creator?: string;
  /** First-sentence verbatim, ≤200 chars. */
  hook: string;
  hookStyle: HookStyle;
  /** 'contrarian' | 'question' | 'statistic' | 'story' | 'stakes' | 'statement' — same taxonomy as clipProposal. */
  hookType?: string;
  views: number;
  durationSec: number;
  whyViral: string;
  /** Optional — same rubric dimensions as clipProposal. */
  dimensions?: {
    hook_strength: number;
    payoff_clarity: number;
    shareability: number;
    savability: number;
    tension: number;
  };
  addedAt: string;
}

export interface PerformanceCorpus {
  generatedAt: string;
  sampleSize: number;
  sampleSizeWithWatchTime: number;
  sampleSizeWithRetention: number;
  baseline: {
    avgCompletionRate: number;
    avgViews: number;
    avgEngagementRate: number;
  };
  hookPatterns: HookPatternStat[];
  lengthBuckets: LengthBucketStat[];
  dropCliffs?: DropCliff[];
  topPerformers: PerformerSummary[];
  bottomPerformers: PerformerSummary[];
  /** Free-text notes from retention uploads, most-recent first, capped. */
  uploadNotes: string[];
  /** Hand-picked external viral examples. Empty array if none added yet. */
  externalExamples: ExternalExample[];
}

const DROP_CLIFF_MIN_SAMPLE = 3;
const CLIFF_PCT_THRESHOLD = 8; // min median drop to flag as a cliff
const TOP_BOTTOM_COUNT = 3;
const MAX_NOTES = 5;

export function detectHookStyle(caption: string): HookStyle {
  const firstLine = caption.split('\n')[0].trim();
  if (!firstLine) return 'Statement hook';
  if (firstLine.endsWith('?')) return 'Question hook';
  if (/^\d/.test(firstLine)) return 'Statistic or list hook';
  if (/i used to|i was |here'?s how/i.test(firstLine)) return 'Story hook';
  if (/most people|nobody|no one|stop |don'?t /i.test(firstLine)) return 'Contrarian hook';
  return 'Statement hook';
}

function hookOf(caption: string): string {
  return caption.split('\n')[0].trim().slice(0, 120);
}

function lengthBucket(durationSec: number): string {
  if (durationSec < 15) return '0-15';
  if (durationSec < 30) return '15-30';
  if (durationSec < 60) return '30-60';
  return '60+';
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pctAtSecond(curve: RetentionPoint[], sec: number): number | null {
  if (curve.length === 0) return null;
  const sorted = [...curve].sort((a, b) => a.sec - b.sec);
  if (sec <= sorted[0].sec) return sorted[0].pctViewers;
  if (sec >= sorted[sorted.length - 1].sec) return sorted[sorted.length - 1].pctViewers;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (sec >= a.sec && sec <= b.sec) {
      const t = (sec - a.sec) / (b.sec - a.sec || 1);
      return a.pctViewers + t * (b.pctViewers - a.pctViewers);
    }
  }
  return null;
}

/**
 * Scan retention curves for second-windows where the median viewer drops
 * more than CLIFF_PCT_THRESHOLD percentage points. Windows are 2s wide
 * and sampled every 1s from 0 to 30s (the Reels attention-span window).
 *
 * Exported for reuse by the retention-upload endpoint, which runs this on
 * a single post's curve to decide which seconds to extract frames at.
 */
export function findDropCliffs(curves: RetentionPoint[][]): DropCliff[] {
  if (curves.length < DROP_CLIFF_MIN_SAMPLE) return [];
  const cliffs: DropCliff[] = [];
  for (let start = 0; start <= 28; start += 1) {
    const end = start + 2;
    const drops: number[] = [];
    for (const curve of curves) {
      const a = pctAtSecond(curve, start);
      const b = pctAtSecond(curve, end);
      if (a == null || b == null) continue;
      drops.push(a - b);
    }
    if (drops.length < DROP_CLIFF_MIN_SAMPLE) continue;
    const medDrop = median(drops);
    if (medDrop >= CLIFF_PCT_THRESHOLD) {
      cliffs.push({
        secondRange: [start, end],
        medianPctDrop: Math.round(medDrop * 10) / 10,
        sampleSize: drops.length,
        commonCauseHypothesis:
          start <= 3
            ? 'opener payload too delayed — tighten first words'
            : start <= 8
              ? 'mid-hook fade — add a second hook or visual beat'
              : 'CTA or payoff not arriving fast enough',
      });
    }
  }
  // Merge overlapping cliffs into broader windows.
  const merged: DropCliff[] = [];
  for (const c of cliffs) {
    const last = merged[merged.length - 1];
    if (last && c.secondRange[0] <= last.secondRange[1]) {
      last.secondRange[1] = Math.max(last.secondRange[1], c.secondRange[1]);
      last.medianPctDrop = Math.max(last.medianPctDrop, c.medianPctDrop);
      last.sampleSize = Math.max(last.sampleSize, c.sampleSize);
    } else {
      merged.push({ ...c, secondRange: [c.secondRange[0], c.secondRange[1]] });
    }
  }
  return merged.slice(0, 4);
}

const MAX_VISUAL_CONTEXTS = 3;

/**
 * For each detected cliff, pull any RetentionFrame.description whose
 * second falls inside the cliff window, dedupe, and keep the 3 most recent.
 */
function attachVisualContexts(cliffs: DropCliff[], posts: PostPerformance[]): void {
  if (cliffs.length === 0) return;

  const sortedByRecency = [...posts].sort((a, b) =>
    (b.retentionUploadedAt ?? '').localeCompare(a.retentionUploadedAt ?? ''),
  );

  for (const cliff of cliffs) {
    const [lo, hi] = cliff.secondRange;
    const candidates: string[] = [];
    for (const p of sortedByRecency) {
      const frames = p.retentionFrames;
      if (!frames || frames.length === 0) continue;
      for (const f of frames) {
        if (f.sec >= lo && f.sec <= hi && f.description?.trim()) {
          candidates.push(f.description.trim());
        }
      }
    }
    const deduped = dedupeDescriptions(candidates).slice(0, MAX_VISUAL_CONTEXTS);
    if (deduped.length > 0) cliff.observedVisualContexts = deduped;
  }
}

/**
 * Exact + near-duplicate dedupe. Near-duplicate uses a 3-gram Jaccard
 * threshold of 0.6 — cheap, avoids pulling in a real text-similarity dep.
 */
function dedupeDescriptions(xs: string[]): string[] {
  const out: string[] = [];
  const shingleCache = new Map<string, Set<string>>();
  const shingle = (s: string): Set<string> => {
    const cached = shingleCache.get(s);
    if (cached) return cached;
    const normalized = s.toLowerCase().replace(/\s+/g, ' ').trim();
    const grams = new Set<string>();
    for (let i = 0; i + 3 <= normalized.length; i++) {
      grams.add(normalized.slice(i, i + 3));
    }
    shingleCache.set(s, grams);
    return grams;
  };
  const jaccard = (a: Set<string>, b: Set<string>): number => {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    a.forEach((g) => {
      if (b.has(g)) inter++;
    });
    return inter / (a.size + b.size - inter);
  };
  for (const x of xs) {
    const sx = shingle(x);
    const dup = out.some((y) => jaccard(sx, shingle(y)) >= 0.6);
    if (!dup) out.push(x);
  }
  return out;
}

const EXTERNAL_DIR = path.join(process.cwd(), 'data', 'viral-corpus', 'external');
const MAX_EXTERNAL_IN_PROMPT = 8;

/**
 * Read hand-picked external viral examples from disk. Safe on a missing
 * directory (returns []). Sorted by views desc, capped at 24 for sanity.
 */
export function readExternalExamples(): ExternalExample[] {
  try {
    if (!fs.existsSync(EXTERNAL_DIR)) return [];
    const files = fs.readdirSync(EXTERNAL_DIR).filter((f) => f.endsWith('.json'));
    const out: ExternalExample[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(EXTERNAL_DIR, f), 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string' && typeof parsed.url === 'string') {
          out.push(parsed as ExternalExample);
        }
      } catch {
        // Skip malformed files — the ingest script will overwrite on next run.
      }
    }
    return out.sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 24);
  } catch {
    return [];
  }
}

export function buildCorpus(
  posts: PostPerformance[],
  external: ExternalExample[] = [],
): PerformanceCorpus {
  const reels = posts.filter((p) => p.mediaType === 'REELS');
  const withWatchTime = reels.filter((p) => typeof p.completionRate === 'number');
  const withRetention = reels.filter(
    (p) => Array.isArray(p.retentionCurve) && p.retentionCurve!.length >= 2,
  );

  const baselineCompletion = mean(withWatchTime.map((p) => p.completionRate!));
  const baselineViews = mean(reels.map((p) => p.views));
  const baselineEngagement = mean(reels.map((p) => p.engagementRate));

  // Group by hook style; only compute for posts that have completion data.
  const byHook: Record<string, number[]> = {};
  for (const p of withWatchTime) {
    const style = detectHookStyle(p.caption);
    (byHook[style] ??= []).push(p.completionRate!);
  }
  const hookPatterns: HookPatternStat[] = Object.entries(byHook)
    .map(([pattern, rates]) => ({
      pattern: pattern as HookStyle,
      sampleSize: rates.length,
      avgCompletionRate: mean(rates),
      deltaPp: (mean(rates) - baselineCompletion) * 100,
    }))
    .sort((a, b) => b.avgCompletionRate - a.avgCompletionRate);

  // Length buckets: only meaningful when we have duration + completion.
  const byLen: Record<string, number[]> = {};
  for (const p of withWatchTime) {
    if (!p.videoDurationMs) continue;
    const bucket = lengthBucket(p.videoDurationMs / 1000);
    (byLen[bucket] ??= []).push(p.completionRate!);
  }
  const lengthBuckets: LengthBucketStat[] = Object.entries(byLen)
    .map(([bucketSec, rates]) => ({
      bucketSec,
      sampleSize: rates.length,
      avgCompletionRate: mean(rates),
    }))
    .sort((a, b) => b.avgCompletionRate - a.avgCompletionRate);

  // Drop cliffs from uploaded retention curves.
  const curves = withRetention.map((p) => p.retentionCurve!);
  const dropCliffs = findDropCliffs(curves);
  attachVisualContexts(dropCliffs, withRetention);

  // Top / bottom performers by completion rate.
  const ranked = [...withWatchTime].sort(
    (a, b) => (b.completionRate ?? 0) - (a.completionRate ?? 0),
  );
  const toSummary = (p: PostPerformance): PerformerSummary => ({
    mediaId: p.mediaId,
    caption: p.caption.slice(0, 140),
    hook: hookOf(p.caption),
    hookStyle: detectHookStyle(p.caption),
    completionRate: p.completionRate ?? 0,
    views: p.views,
  });
  const topPerformers = ranked.slice(0, TOP_BOTTOM_COUNT).map(toSummary);
  const bottomPerformers = ranked
    .slice(-TOP_BOTTOM_COUNT)
    .reverse()
    .map(toSummary);

  // Upload notes — most-recent first, trimmed.
  const notes = withRetention
    .filter((p) => p.retentionNotes && p.retentionNotes.trim())
    .sort((a, b) =>
      (b.retentionUploadedAt ?? '').localeCompare(a.retentionUploadedAt ?? ''),
    )
    .slice(0, MAX_NOTES)
    .map((p) => p.retentionNotes!.trim().slice(0, 200));

  return {
    generatedAt: new Date().toISOString(),
    sampleSize: reels.length,
    sampleSizeWithWatchTime: withWatchTime.length,
    sampleSizeWithRetention: withRetention.length,
    baseline: {
      avgCompletionRate: baselineCompletion,
      avgViews: baselineViews,
      avgEngagementRate: baselineEngagement,
    },
    hookPatterns,
    lengthBuckets,
    dropCliffs: dropCliffs.length > 0 ? dropCliffs : undefined,
    topPerformers,
    bottomPerformers,
    uploadNotes: notes,
    externalExamples: external,
  };
}

let cached: { at: number; corpus: PerformanceCorpus } | null = null;
const CACHE_MS = 60_000;

/**
 * Read the analytics store and build the corpus. Cached in-process for
 * 60s — the sync cron is the only writer, and editor routes call this
 * on every invocation.
 */
export async function getPerformanceCorpus(): Promise<PerformanceCorpus> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.corpus;
  const store = await readAnalytics();
  const external = readExternalExamples();
  const corpus = buildCorpus(store.posts, external);
  cached = { at: now, corpus };
  return corpus;
}

export function invalidateCorpusCache(): void {
  cached = null;
}

/**
 * Render the corpus as a compact prompt block for Claude. Returns null
 * when sample size is too small to be useful (< 3 reels with watch-time).
 */
export function renderCorpusForPrompt(corpus: PerformanceCorpus): string | null {
  const hasOwnData = corpus.sampleSizeWithWatchTime >= 3;
  const hasExternal = corpus.externalExamples.length > 0;
  if (!hasOwnData && !hasExternal) return null;

  const lines: string[] = [];
  lines.push(
    `PERFORMANCE CONTEXT — soft signals from prior Reels (${corpus.sampleSizeWithWatchTime} with watch-time, ${corpus.sampleSizeWithRetention} with retention curves${hasExternal ? `, plus ${corpus.externalExamples.length} hand-picked external viral examples` : ''}). These are nudges, NOT overrides — the hard constraints still apply.`,
  );

  if (!hasOwnData) {
    lines.push('');
    lines.push('(No own-history watch-time data yet. External examples only.)');
  } else {
    lines.push('');
    lines.push(
      `Baseline completion rate: ${(corpus.baseline.avgCompletionRate * 100).toFixed(1)}%.`,
    );
  }

  if (corpus.hookPatterns.length > 0) {
    lines.push('');
    lines.push('Hook-style completion:');
    for (const h of corpus.hookPatterns) {
      if (h.sampleSize < 2) continue;
      const sign = h.deltaPp >= 0 ? '+' : '';
      lines.push(
        `  • ${h.pattern} (n=${h.sampleSize}): ${(h.avgCompletionRate * 100).toFixed(0)}% (${sign}${h.deltaPp.toFixed(1)}pp vs baseline)`,
      );
    }
  }

  if (corpus.lengthBuckets.length > 0) {
    lines.push('');
    lines.push('Length-bucket completion:');
    for (const b of corpus.lengthBuckets) {
      if (b.sampleSize < 2) continue;
      lines.push(
        `  • ${b.bucketSec}s (n=${b.sampleSize}): ${(b.avgCompletionRate * 100).toFixed(0)}%`,
      );
    }
  }

  if (corpus.dropCliffs && corpus.dropCliffs.length > 0) {
    lines.push('');
    lines.push('Known drop cliffs (median viewer abandons here):');
    for (const c of corpus.dropCliffs) {
      lines.push(
        `  • ${c.secondRange[0]}s–${c.secondRange[1]}s: median ${c.medianPctDrop}pp drop (n=${c.sampleSize})${c.commonCauseHypothesis ? ` — ${c.commonCauseHypothesis}` : ''}`,
      );
      if (c.observedVisualContexts && c.observedVisualContexts.length > 0) {
        const quoted = c.observedVisualContexts
          .map((d) => `"${d.replace(/"/g, '\\"').slice(0, 120)}"`)
          .join(', ');
        lines.push(`    ↳ when viewers dropped here on prior Reels: ${quoted}`);
      }
    }
  }

  if (corpus.topPerformers.length > 0) {
    lines.push('');
    lines.push('Top performers (keep doing this):');
    for (const p of corpus.topPerformers) {
      lines.push(
        `  • ${(p.completionRate * 100).toFixed(0)}% — ${p.hookStyle}: "${p.hook.slice(0, 80)}"`,
      );
    }
  }

  if (corpus.bottomPerformers.length > 0) {
    lines.push('');
    lines.push('Bottom performers (avoid this shape):');
    for (const p of corpus.bottomPerformers) {
      lines.push(
        `  • ${(p.completionRate * 100).toFixed(0)}% — ${p.hookStyle}: "${p.hook.slice(0, 80)}"`,
      );
    }
  }

  if (corpus.uploadNotes.length > 0) {
    lines.push('');
    lines.push('Qualitative notes from retention uploads:');
    for (const n of corpus.uploadNotes) lines.push(`  • ${n}`);
  }

  if (hasExternal) {
    const shown = corpus.externalExamples.slice(0, MAX_EXTERNAL_IN_PROMPT);
    lines.push('');
    lines.push(`External viral examples (hand-picked — study the hook patterns, not the topics):`);
    for (const ex of shown) {
      const views = ex.views >= 1000 ? `${Math.round(ex.views / 1000)}K` : String(ex.views);
      lines.push(
        `  • ${views} views, ${ex.hookStyle} (${ex.durationSec}s): "${ex.hook.slice(0, 90)}" — ${ex.whyViral.slice(0, 120)}`,
      );
    }
  }

  return lines.join('\n');
}
