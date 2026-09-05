import { describe, expect, it } from 'vitest';
import {
  appendSnapshotsToStore,
  compactSnapshots,
  MIN_SNAPSHOT_GAP_MS,
  COMPACT_AFTER_MS,
  MAX_SNAPSHOTS_PER_POST,
  type HistoryStore,
  type MetricSnapshot,
} from '../analyticsHistory';
import { assessEvergreen, EVERGREEN_MIN_AGE_DAYS } from '../evergreen';

const DAY = 24 * 3600_000;

function snap(atMs: number, views: number): MetricSnapshot {
  return { at: new Date(atMs).toISOString(), views, likes: 0, shares: 0, saves: 0, comments: 0 };
}

function emptyStore(): HistoryStore {
  return { updatedAt: '', posts: {} };
}

describe('appendSnapshotsToStore', () => {
  const now = new Date('2026-07-22T12:00:00Z');

  it('creates a per-post array on first append', () => {
    const store = emptyStore();
    const r = appendSnapshotsToStore(store, [{ mediaId: 'm1', snapshot: snap(now.getTime(), 100) }], now);
    expect(r).toEqual({ appended: 1, deduped: 0 });
    expect(store.posts['m1']).toHaveLength(1);
    expect(store.updatedAt).toBe(now.toISOString());
  });

  it('dedupes a snapshot younger than the gap, appends one older', () => {
    const store = emptyStore();
    const t0 = now.getTime();
    appendSnapshotsToStore(store, [{ mediaId: 'm1', snapshot: snap(t0, 100) }], now);
    const young = appendSnapshotsToStore(
      store,
      [{ mediaId: 'm1', snapshot: snap(t0 + MIN_SNAPSHOT_GAP_MS - 1000, 110) }],
      now,
    );
    expect(young).toEqual({ appended: 0, deduped: 1 });
    const old = appendSnapshotsToStore(
      store,
      [{ mediaId: 'm1', snapshot: snap(t0 + MIN_SNAPSHOT_GAP_MS + 1000, 120) }],
      now,
    );
    expect(old).toEqual({ appended: 1, deduped: 0 });
    expect(store.posts['m1']).toHaveLength(2);
  });
});

describe('compactSnapshots', () => {
  const now = new Date('2026-07-22T12:00:00Z');

  it('keeps recent snapshots as-is and thins old ones to one per day', () => {
    const oldDayA = now.getTime() - COMPACT_AFTER_MS - 3 * DAY;
    const snapshots = [
      snap(oldDayA, 1),
      snap(oldDayA + 3600_000, 2),      // same old UTC day — last wins
      snap(oldDayA + DAY, 3),           // next old day
      snap(now.getTime() - DAY, 4),     // recent — kept
      snap(now.getTime() - 3600_000, 5),
    ];
    const out = compactSnapshots(snapshots, now);
    expect(out.map((s) => s.views)).toEqual([2, 3, 4, 5]);
  });

  it('enforces the hard per-post cap', () => {
    const snapshots: MetricSnapshot[] = [];
    for (let i = 0; i < MAX_SNAPSHOTS_PER_POST + 50; i++) {
      snapshots.push(snap(now.getTime() - (MAX_SNAPSHOTS_PER_POST + 50 - i) * 3600_000, i));
    }
    const out = compactSnapshots(snapshots, now);
    expect(out.length).toBeLessThanOrEqual(MAX_SNAPSHOTS_PER_POST);
    // Oldest dropped, newest kept.
    expect(out[out.length - 1].views).toBe(MAX_SNAPSHOTS_PER_POST + 49);
  });
});

describe('assessEvergreen', () => {
  const now = new Date('2026-07-22T12:00:00Z');

  function series(publishedMs: number, dailyViews: number[], startOffsetDays = 0): MetricSnapshot[] {
    // One snapshot per day; views accumulate.
    let total = 0;
    return dailyViews.map((v, i) => {
      total += v;
      return snap(publishedMs + (startOffsetDays + i) * DAY, total);
    });
  }

  it('flags a 30d+ post whose recent rate is at least 10% of launch rate', () => {
    const published = now.getTime() - 40 * DAY;
    // Launch week: 100/day. Recent week: ~20/day (well above 10%).
    const snapshots = [
      ...series(published, [100, 100, 100, 100, 100, 100, 100]),
      ...series(published, [20, 20, 20, 20, 20, 20, 20], 33),
    ];
    const a = assessEvergreen(new Date(published).toISOString(), snapshots, now);
    expect(a.ageDays).toBeGreaterThanOrEqual(EVERGREEN_MIN_AGE_DAYS);
    expect(a.isEvergreen).toBe(true);
    expect(a.ratio).toBeGreaterThan(0.1);
  });

  it('rejects a decayed post', () => {
    const published = now.getTime() - 40 * DAY;
    const snapshots = [
      ...series(published, [1000, 1000, 1000, 1000, 1000, 1000, 1000]),
      ...series(published, [1, 0, 0, 1, 0, 0, 0], 33), // ~0.3/day vs 1000/day
    ];
    const a = assessEvergreen(new Date(published).toISOString(), snapshots, now);
    expect(a.isEvergreen).toBe(false);
  });

  it('rejects any post younger than 30 days', () => {
    const published = now.getTime() - 10 * DAY;
    const snapshots = series(published, [100, 100, 100, 100, 100, 100, 100]);
    const a = assessEvergreen(new Date(published).toISOString(), snapshots, now);
    expect(a.isEvergreen).toBe(false);
  });

  it('falls back to any recent growth when history started after launch', () => {
    const published = now.getTime() - 60 * DAY;
    // Snapshotting began at day 50 — no launch-week data at all.
    const snapshots = series(published, [5, 5, 5, 5, 5, 5, 5], 53);
    const a = assessEvergreen(new Date(published).toISOString(), snapshots, now);
    expect(a.firstWeekDailyRate).toBe(0);
    expect(a.isEvergreen).toBe(true);
  });
});
