/**
 * retentionMath.ts
 *
 * Pure retention-curve math, isomorphic (no Node imports) so client
 * components (retention page, editor badge) and server modules
 * (performanceCorpus, contentBrief) share the same numbers.
 */
import type { RetentionPoint } from './analyticsStore';

/** Reels holding below this percentage at 3s get flagged — the hook is
 *  losing viewers before the payoff. Skip-rate proxy: lower hold = more
 *  viewers scrolled past in the first 3 seconds. */
export const HOOK_HOLD_FLAG_PCT = 65;

/** Reels whose `reels_skip_rate` exceeds this get flagged. Skip rate is
 *  the Graph API's scalar stand-in for the per-second curve, which
 *  Instagram exposes only in its mobile app (docs/ig-insights-api.md).
 *  Percent (0–100) of viewers who scrolled away — lower is better.
 *  Calibrated on the first 43-reel corpus: the two best-performing reels
 *  sat at 46–47%, the weakest at 76%. */
export const SKIP_RATE_FLAG_PCT = 65;

/** Linear interpolation of viewer % at a given second. Null on empty. */
export function pctAtSecond(curve: RetentionPoint[], sec: number): number | null {
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

/** Percent of viewers still watching at 3 seconds (the make-or-break
 *  window). Null when the curve is empty. */
export function hookHold3s(curve: RetentionPoint[]): number | null {
  return pctAtSecond(curve, 3);
}
