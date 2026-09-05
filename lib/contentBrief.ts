/**
 * contentBrief.ts
 *
 * The write-loop feedback artifact: composes the performance corpus,
 * analytics store, metric history, and queue pillars into one brief that
 * answers "what should the next script lean into, and what should it
 * avoid" — rendered as JSON for the dashboard page and as markdown for
 * the content-writing skills (~/Code/Social Media/content-brief.md).
 *
 * Guidance is deterministic rules over the aggregates — no LLM call —
 * so the brief is cheap, testable, and refreshes with every read.
 */
import { readAnalytics, type PostPerformance } from './analyticsStore';
import { readHistory, type HistoryStore } from './analyticsHistory';
import { assessEvergreen } from './evergreen';
import { hookHold3s, HOOK_HOLD_FLAG_PCT, SKIP_RATE_FLAG_PCT } from './retentionMath';

/** How many reels to show at each end of the skip-rate ranking. The full
 *  list is every synced reel — too long to paste into a writing prompt. */
const SKIP_RANKING_SHOWN = 8;
import {
  getPerformanceCorpus,
  type DropCliff,
  type HookPatternStat,
  type LengthBucketStat,
  type PerformerSummary,
} from './performanceCorpus';
import { readQueue } from './queue';

export interface ContentBrief {
  generatedAt: string;
  sampleSize: number;
  sampleSizeWithRetention: number;
  baseline: { avgCompletionRate: number; avgViews: number; avgEngagementRate: number };
  working: {
    hookStyles: HookPatternStat[];
    lengthBuckets: LengthBucketStat[];
    topPerformers: PerformerSummary[];
    bottomPerformers: PerformerSummary[];
  };
  fallOff: { cliffs: DropCliff[] };
  hookHoldRanking: { mediaId: string; hook: string; pct: number; flagged: boolean }[];
  /** Skip rate across every synced reel (no manual upload needed), best
   *  first. Far larger sample than hookHoldRanking. */
  skipRateRanking: { mediaId: string; hook: string; pct: number; flagged: boolean }[];
  /** Avg skip rate per hook style — which openers survive the scroll. */
  skipRateByHookStyle: { pattern: string; sampleSize: number; avgPct: number; deltaPp: number }[];
  evergreen: { mediaId: string; hook: string; ageDays: number; recentDailyRate: number }[];
  pillars: { pillar: string; sampleSize: number; avgViews: number; avgEngagementRate: number }[];
  guidance: { doMore: string[]; avoid: string[] };
}

function hookOf(caption: string): string {
  return caption.split('\n')[0].trim().slice(0, 100);
}

/** Deterministic do-more / avoid rules over the aggregates. Complete
 *  sentences, Threshold voice, no emoji. Exported for tests. */
export function buildGuidance(input: {
  hookStyles: HookPatternStat[];
  cliffs: DropCliff[];
  hookHoldRanking: ContentBrief['hookHoldRanking'];
  skipRateByHookStyle?: ContentBrief['skipRateByHookStyle'];
  evergreen: ContentBrief['evergreen'];
  pillars: ContentBrief['pillars'];
  lengthBuckets: LengthBucketStat[];
}): { doMore: string[]; avoid: string[] } {
  const doMore: string[] = [];
  const avoid: string[] = [];

  const bestHook = input.hookStyles.find((h) => h.sampleSize >= 3 && h.deltaPp >= 3);
  if (bestHook) {
    doMore.push(
      `Lead with a ${bestHook.pattern.toLowerCase()} — it completes ${bestHook.deltaPp.toFixed(1)} points above your baseline across ${bestHook.sampleSize} reels.`,
    );
  }
  const worstHook = [...input.hookStyles]
    .reverse()
    .find((h) => h.sampleSize >= 3 && h.deltaPp <= -3);
  if (worstHook) {
    avoid.push(
      `Skip the ${worstHook.pattern.toLowerCase()} opener for now — it runs ${Math.abs(worstHook.deltaPp).toFixed(1)} points below baseline across ${worstHook.sampleSize} reels.`,
    );
  }

  const bestBucket = input.lengthBuckets.find((b) => b.sampleSize >= 3);
  if (bestBucket) {
    doMore.push(
      `Aim for the ${bestBucket.bucketSec}s length window; it holds the best completion rate (${(bestBucket.avgCompletionRate * 100).toFixed(0)}%) in your library.`,
    );
  }

  const earlyCliff = input.cliffs.find((c) => c.secondRange[0] <= 3);
  if (earlyCliff) {
    const visual = earlyCliff.observedVisualContexts?.[0];
    avoid.push(
      `Viewers bail at ${earlyCliff.secondRange[0]}-${earlyCliff.secondRange[1]}s (median ${earlyCliff.medianPctDrop}pp drop)${visual ? ` — on screen when they left: ${visual}` : ''}. Put the payoff in the first line, not after a wind-up.`,
    );
  }
  const midCliff = input.cliffs.find((c) => c.secondRange[0] > 3);
  if (midCliff) {
    avoid.push(
      `There is a recurring drop at ${midCliff.secondRange[0]}-${midCliff.secondRange[1]}s. Plan a second hook or visual change before that mark.`,
    );
  }

  const flagged = input.hookHoldRanking.filter((h) => h.flagged);
  if (flagged.length > 0) {
    avoid.push(
      `${flagged.length} recent reel(s) held under ${HOOK_HOLD_FLAG_PCT}% of viewers at 3 seconds. Study the flagged hooks in the ranking below and open with the claim instead of the setup.`,
    );
  }
  const strongest = input.hookHoldRanking.find((h) => !h.flagged);
  if (strongest) {
    doMore.push(
      `Your strongest hook held ${Math.round(strongest.pct)}% at 3 seconds: "${strongest.hook}". Reuse that shape.`,
    );
  }

  // Skip rate by hook style — the widest-sample signal in the brief, so it
  // gets a rule of its own. Negative delta = skipped less than baseline.
  const styles = input.skipRateByHookStyle ?? [];
  if (styles.length >= 2) {
    const best = styles[0];
    const worst = styles[styles.length - 1];
    if (best.deltaPp <= -3) {
      doMore.push(
        `A ${best.pattern.toLowerCase()} is skipped ${Math.abs(best.deltaPp)} points less than your average across ${best.sampleSize} reels. It survives the scroll better than anything else you open with.`,
      );
    }
    if (worst.deltaPp >= 3) {
      avoid.push(
        `A ${worst.pattern.toLowerCase()} is skipped ${worst.deltaPp} points more than your average across ${worst.sampleSize} reels. Rework those openers or lead with a different shape.`,
      );
    }
  }

  if (input.evergreen.length > 0) {
    const ex = input.evergreen[0];
    doMore.push(
      `${input.evergreen.length} post(s) are still earning views 30+ days out — evergreen topics like "${ex.hook}" deserve follow-ups.`,
    );
  }

  if (input.pillars.length >= 2) {
    const best = input.pillars[0];
    doMore.push(
      `The ${best.pillar.replace('_', ' ')} pillar is out-earning the rest (${best.avgViews} average views over ${best.sampleSize} posts).`,
    );
  }

  if (doMore.length === 0) {
    doMore.push('Not enough performance data yet to name a winning pattern. Keep publishing and syncing.');
  }
  return { doMore, avoid };
}

export async function buildContentBrief(): Promise<ContentBrief> {
  const corpus = await getPerformanceCorpus();
  const store = await readAnalytics();

  let history: HistoryStore | null = null;
  try {
    history = await readHistory();
  } catch {}

  let pillarByQueueId = new Map<string, string>();
  try {
    const queue = await readQueue();
    for (const post of queue) {
      if (post.pillar) pillarByQueueId.set(post.id, post.pillar);
    }
  } catch {}

  const reels = store.posts.filter((p) => p.mediaType === 'REELS');

  const hookHoldRanking = reels
    .filter((p) => Array.isArray(p.retentionCurve) && p.retentionCurve.length >= 2)
    .map((p) => ({ post: p, pct: hookHold3s(p.retentionCurve!) }))
    .filter((h): h is { post: PostPerformance; pct: number } => h.pct !== null)
    .sort((a, b) => b.pct - a.pct)
    .map((h) => ({
      mediaId: h.post.mediaId,
      hook: hookOf(h.post.caption),
      pct: Math.round(h.pct * 10) / 10,
      flagged: h.pct < HOOK_HOLD_FLAG_PCT,
    }));

  // Skip rate — same question as hook hold, but across every synced reel
  // rather than only the ones hand-screenshotted from the mobile app.
  const skipRateRanking = reels
    .filter((p): p is PostPerformance & { skipRate: number } => typeof p.skipRate === 'number')
    .sort((a, b) => a.skipRate - b.skipRate)
    .map((p) => ({
      mediaId: p.mediaId,
      hook: hookOf(p.caption),
      pct: Math.round(p.skipRate * 10) / 10,
      flagged: p.skipRate > SKIP_RATE_FLAG_PCT,
    }));

  const skipRateByHookStyle = (corpus.skipRate?.byHookStyle ?? []).map((s) => ({
    pattern: String(s.pattern),
    sampleSize: s.sampleSize,
    avgPct: s.avgPct,
    deltaPp: s.deltaPp,
  }));

  const evergreen = !history
    ? []
    : store.posts
        .map((p) => ({ post: p, snapshots: history!.posts[p.mediaId] ?? [] }))
        .filter(({ snapshots }) => snapshots.length >= 2)
        .map(({ post, snapshots }) => ({
          post,
          assessment: assessEvergreen(post.timestamp, snapshots),
        }))
        .filter(({ assessment }) => assessment.isEvergreen)
        .sort((a, b) => b.assessment.recentDailyRate - a.assessment.recentDailyRate)
        .map(({ post, assessment }) => ({
          mediaId: post.mediaId,
          hook: hookOf(post.caption),
          ageDays: assessment.ageDays,
          recentDailyRate: Math.round(assessment.recentDailyRate * 10) / 10,
        }));

  const byPillar: Record<string, PostPerformance[]> = {};
  for (const p of store.posts) {
    const pillar = p.queuePostId ? pillarByQueueId.get(p.queuePostId) : undefined;
    if (!pillar) continue;
    (byPillar[pillar] ??= []).push(p);
  }
  const pillars = Object.entries(byPillar)
    .map(([pillar, ps]) => ({
      pillar,
      sampleSize: ps.length,
      avgViews: Math.round(ps.reduce((s, p) => s + p.views, 0) / ps.length),
      avgEngagementRate:
        ps.reduce((s, p) => s + p.engagementRate, 0) / ps.length,
    }))
    .filter((s) => s.sampleSize >= 2)
    .sort((a, b) => b.avgViews - a.avgViews);

  const cliffs = corpus.dropCliffs ?? [];

  return {
    generatedAt: new Date().toISOString(),
    sampleSize: corpus.sampleSize,
    sampleSizeWithRetention: corpus.sampleSizeWithRetention,
    baseline: corpus.baseline,
    working: {
      hookStyles: corpus.hookPatterns,
      lengthBuckets: corpus.lengthBuckets,
      topPerformers: corpus.topPerformers,
      bottomPerformers: corpus.bottomPerformers,
    },
    fallOff: { cliffs },
    hookHoldRanking,
    skipRateRanking,
    skipRateByHookStyle,
    evergreen,
    pillars,
    guidance: buildGuidance({
      hookStyles: corpus.hookPatterns,
      cliffs,
      hookHoldRanking,
      skipRateByHookStyle,
      evergreen,
      pillars,
      lengthBuckets: corpus.lengthBuckets,
    }),
  };
}

export function renderBriefMarkdown(brief: ContentBrief): string {
  const lines: string[] = [];
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  lines.push('# Threshold Content Brief');
  lines.push('');
  lines.push(
    `Generated ${brief.generatedAt}. Based on ${brief.sampleSize} published reels, ${brief.sampleSizeWithRetention} with retention curves. Baseline: ${pct(brief.baseline.avgCompletionRate)} completion, ${Math.round(brief.baseline.avgViews)} average views.`,
  );

  lines.push('');
  lines.push('## Do more of this');
  for (const g of brief.guidance.doMore) lines.push(`- ${g}`);

  if (brief.guidance.avoid.length > 0) {
    lines.push('');
    lines.push('## Avoid');
    for (const g of brief.guidance.avoid) lines.push(`- ${g}`);
  }

  if (brief.working.hookStyles.length > 0) {
    lines.push('');
    lines.push('## Hook styles by completion rate');
    for (const h of brief.working.hookStyles) {
      if (h.sampleSize < 2) continue;
      const sign = h.deltaPp >= 0 ? '+' : '';
      lines.push(
        `- ${h.pattern} (n=${h.sampleSize}): ${pct(h.avgCompletionRate)} (${sign}${h.deltaPp.toFixed(1)}pp vs baseline)`,
      );
    }
  }

  if (brief.fallOff.cliffs.length > 0) {
    lines.push('');
    lines.push('## Where viewers leave');
    for (const c of brief.fallOff.cliffs) {
      lines.push(
        `- ${c.secondRange[0]}s to ${c.secondRange[1]}s: median ${c.medianPctDrop}pp drop (n=${c.sampleSize})${c.commonCauseHypothesis ? ` — ${c.commonCauseHypothesis}` : ''}`,
      );
      for (const v of c.observedVisualContexts ?? []) {
        lines.push(`  - On screen when viewers left: ${v}`);
      }
    }
  }

  if (brief.hookHoldRanking.length > 0) {
    lines.push('');
    lines.push(`## Hook hold at 3 seconds (flagged below ${HOOK_HOLD_FLAG_PCT}%)`);
    lines.push(
      `Hand-uploaded retention curves, n=${brief.hookHoldRanking.length}. Higher is better.`,
    );
    for (const h of brief.hookHoldRanking) {
      lines.push(`- ${h.pct}%${h.flagged ? ' [FLAGGED]' : ''} — "${h.hook}"`);
    }
  }

  if (brief.skipRateByHookStyle.length > 0) {
    lines.push('');
    lines.push('## Skip rate by hook style');
    lines.push(
      'Percent who scrolled away, averaged per opener shape. Lower is better; the delta is versus your all-reel average. This is the widest-sample signal here — use it to pick the shape of the opening line.',
    );
    for (const s of brief.skipRateByHookStyle) {
      const d = `${s.deltaPp >= 0 ? '+' : ''}${s.deltaPp}pp`;
      lines.push(`- ${s.pattern}: ${s.avgPct}% (${d} vs average, n=${s.sampleSize})`);
    }
  }

  if (brief.skipRateRanking.length > 0) {
    const flagged = brief.skipRateRanking.filter((s) => s.flagged).length;
    const best = brief.skipRateRanking.slice(0, SKIP_RANKING_SHOWN);
    const worst = brief.skipRateRanking.slice(-SKIP_RANKING_SHOWN).reverse();
    lines.push('');
    lines.push(`## Skip rate by reel (flagged above ${SKIP_RATE_FLAG_PCT}%)`);
    lines.push(
      `Every synced reel, n=${brief.skipRateRanking.length}, ${flagged} flagged. Showing the ${SKIP_RANKING_SHOWN} least- and most-skipped.`,
    );
    lines.push('');
    lines.push('Least skipped — these openers held:');
    for (const s of best) lines.push(`- ${s.pct}% — "${s.hook}"`);
    lines.push('');
    lines.push('Most skipped — study what these openers did wrong:');
    for (const s of worst) lines.push(`- ${s.pct}% [FLAGGED] — "${s.hook}"`);
  }

  if (brief.evergreen.length > 0) {
    lines.push('');
    lines.push('## Still earning views (evergreen)');
    for (const e of brief.evergreen) {
      lines.push(`- "${e.hook}" — ${e.ageDays} days old, ${e.recentDailyRate} views/day this week`);
    }
  }

  if (brief.pillars.length > 0) {
    lines.push('');
    lines.push('## Pillar performance');
    for (const p of brief.pillars) {
      lines.push(
        `- ${p.pillar.replace('_', ' ')} (n=${p.sampleSize}): ${p.avgViews} avg views, ${pct(p.avgEngagementRate)} engagement`,
      );
    }
  }

  if (brief.working.topPerformers.length > 0) {
    lines.push('');
    lines.push('## Top performers');
    for (const t of brief.working.topPerformers) {
      lines.push(`- ${pct(t.completionRate)} completion, ${t.views} views — ${t.hookStyle}: "${t.hook}"`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
