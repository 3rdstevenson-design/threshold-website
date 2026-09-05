/**
 * evergreen.ts
 *
 * Pure evergreen assessment from metric-history snapshots. A post is
 * "evergreen" when it is still earning meaningful views 30+ days after
 * publish — the algorithm increasingly resurfaces older content, so
 * longevity is a distinct quality signal from the launch spike.
 *
 * Derived at read time, never persisted, so tuning the constants below
 * re-flags everything on the next page load.
 */
import type { MetricSnapshot } from './analyticsHistory';

/** Minimum age before a post can qualify. */
export const EVERGREEN_MIN_AGE_DAYS = 30;
/** Recent daily view rate must be at least this fraction of the
 *  first-week daily rate. */
export const EVERGREEN_RATE_RATIO = 0.10;
/** Window (days) for both the launch rate and the trailing rate. */
export const RATE_WINDOW_DAYS = 7;

export interface EvergreenAssessment {
  isEvergreen: boolean;
  ageDays: number;
  /** Views/day over the first RATE_WINDOW_DAYS after publish; 0 when
   *  history doesn't reach back that far (snapshotting started late). */
  firstWeekDailyRate: number;
  /** Views/day over the trailing RATE_WINDOW_DAYS. */
  recentDailyRate: number;
  /** recentDailyRate / firstWeekDailyRate; 0 when the launch rate is
   *  unknown. */
  ratio: number;
}

const DAY_MS = 24 * 3600_000;

/** Views/day across the snapshots inside [fromMs, toMs], from deltas. */
function dailyRate(snapshots: MetricSnapshot[], fromMs: number, toMs: number): number | null {
  const inWindow = snapshots.filter((s) => {
    const t = Date.parse(s.at);
    return t >= fromMs && t <= toMs;
  });
  if (inWindow.length < 2) return null;
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  const spanMs = Date.parse(last.at) - Date.parse(first.at);
  if (spanMs <= 0) return null;
  const delta = Math.max(0, last.views - first.views);
  return delta / (spanMs / DAY_MS);
}

export function assessEvergreen(
  publishedAt: string,
  snapshots: MetricSnapshot[],
  now: Date = new Date(),
): EvergreenAssessment {
  const publishedMs = Date.parse(publishedAt);
  const ageDays = Number.isFinite(publishedMs)
    ? Math.floor((now.getTime() - publishedMs) / DAY_MS)
    : 0;

  const firstWeek = Number.isFinite(publishedMs)
    ? dailyRate(snapshots, publishedMs, publishedMs + RATE_WINDOW_DAYS * DAY_MS)
    : null;
  const recent = dailyRate(
    snapshots,
    now.getTime() - RATE_WINDOW_DAYS * DAY_MS,
    now.getTime(),
  );

  const firstWeekDailyRate = firstWeek ?? 0;
  const recentDailyRate = recent ?? 0;
  const ratio = firstWeek && firstWeek > 0 ? recentDailyRate / firstWeek : 0;

  let isEvergreen = false;
  if (ageDays >= EVERGREEN_MIN_AGE_DAYS) {
    if (firstWeek !== null && firstWeek > 0) {
      isEvergreen = recentDailyRate >= EVERGREEN_RATE_RATIO * firstWeek;
    } else {
      // History started after the launch window — fall back to "any
      // recent growth at all" so late-adopted posts can still qualify.
      isEvergreen = recentDailyRate > 0;
    }
  }

  return { isEvergreen, ageDays, firstWeekDailyRate, recentDailyRate, ratio };
}
