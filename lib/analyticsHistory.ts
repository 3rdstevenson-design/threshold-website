/**
 * analyticsHistory.ts
 *
 * Timestamped per-post metric snapshots, appended on every performance
 * sync so views-over-time and evergreen analysis accrue. Kept in a
 * SEPARATE store from analytics/performance.json — the corpus reads
 * performance.json on hot paths and history is append-mostly, read only
 * by the history API and the content brief.
 *
 * Storage mirrors analyticsStore.ts: R2 key `analytics/history.json`
 * when R2 is configured, local `data/analytics-history.json` otherwise.
 * Unlike upsertPerformance (one read-modify-write per post), snapshots
 * for a whole sync are appended with ONE read and ONE write.
 */
import fs from 'fs';
import path from 'path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, useR2 } from './r2';

export interface MetricSnapshot {
  /** ISO timestamp of the sync that captured this snapshot. */
  at: string;
  views: number;
  likes: number;
  shares: number;
  saves: number;
  comments: number;
  /** REELS only; absent when Meta doesn't return watch time. */
  avgWatchTimeMs?: number;
  /** REELS only; percent (0–100) who skipped away. Lower is better. */
  skipRate?: number;
}

export interface HistoryStore {
  updatedAt: string;
  /** mediaId → snapshots ascending by `at`. */
  posts: Record<string, MetricSnapshot[]>;
}

/** Skip appending when the post's last snapshot is younger than this. */
export const MIN_SNAPSHOT_GAP_MS = 4 * 3600_000;
/** Beyond this age, compaction keeps at most one snapshot per UTC day. */
export const COMPACT_AFTER_MS = 90 * 24 * 3600_000;
/** Hard per-post cap after compaction (oldest dropped first). */
export const MAX_SNAPSHOTS_PER_POST = 800;

const LOCAL_PATH = path.join(process.cwd(), 'data', 'analytics-history.json');
const R2_KEY = 'analytics/history.json';

const EMPTY: HistoryStore = { updatedAt: '', posts: {} };

async function readFromR2(): Promise<HistoryStore> {
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET(), Key: R2_KEY }));
    const body = await res.Body?.transformToString();
    return body ? JSON.parse(body) : { ...EMPTY, posts: {} };
  } catch (e: any) {
    if (e.name === 'NoSuchKey') return { ...EMPTY, posts: {} };
    throw e;
  }
}

async function writeToR2(store: HistoryStore): Promise<void> {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET(),
    Key: R2_KEY,
    Body: JSON.stringify(store),
    ContentType: 'application/json',
  }));
}

function readFromFile(): HistoryStore {
  try {
    if (!fs.existsSync(LOCAL_PATH)) return { ...EMPTY, posts: {} };
    return JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf-8'));
  } catch {
    return { ...EMPTY, posts: {} };
  }
}

function writeToFile(store: HistoryStore): void {
  const dir = path.dirname(LOCAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(store, null, 2));
}

export async function readHistory(): Promise<HistoryStore> {
  return useR2() ? readFromR2() : readFromFile();
}

export async function writeHistory(store: HistoryStore): Promise<void> {
  if (useR2()) {
    await writeToR2(store);
  } else {
    writeToFile(store);
  }
}

/**
 * Compact one post's snapshot list: recent snapshots (younger than
 * COMPACT_AFTER_MS) are kept as-is; older ones are thinned to the LAST
 * snapshot of each UTC day. Then the hard cap applies, dropping oldest.
 * Pure — exported for tests.
 */
export function compactSnapshots(snapshots: MetricSnapshot[], now: Date): MetricSnapshot[] {
  const cutoff = now.getTime() - COMPACT_AFTER_MS;
  const old = snapshots.filter((s) => Date.parse(s.at) < cutoff);
  const recent = snapshots.filter((s) => Date.parse(s.at) >= cutoff);
  const byDay = new Map<string, MetricSnapshot>();
  for (const s of old) {
    byDay.set(s.at.slice(0, 10), s); // ascending input → last of day wins
  }
  const compacted = [...Array.from(byDay.values()), ...recent];
  return compacted.length > MAX_SNAPSHOTS_PER_POST
    ? compacted.slice(-MAX_SNAPSHOTS_PER_POST)
    : compacted;
}

/**
 * Pure batch append against an in-memory store. A post whose last
 * snapshot is younger than MIN_SNAPSHOT_GAP_MS is deduped (skipped) —
 * overlapping runs from the Vercel cron and a manual dashboard sync
 * land as one snapshot. Mutates and returns `store`. Exported for tests.
 */
export function appendSnapshotsToStore(
  store: HistoryStore,
  records: Array<{ mediaId: string; snapshot: MetricSnapshot }>,
  now: Date,
): { appended: number; deduped: number } {
  let appended = 0;
  let deduped = 0;
  for (const { mediaId, snapshot } of records) {
    const list = store.posts[mediaId] ?? [];
    const last = list[list.length - 1];
    if (last && Date.parse(snapshot.at) - Date.parse(last.at) < MIN_SNAPSHOT_GAP_MS) {
      deduped++;
      continue;
    }
    list.push(snapshot);
    store.posts[mediaId] = compactSnapshots(list, now);
    appended++;
  }
  if (appended > 0) store.updatedAt = now.toISOString();
  return { appended, deduped };
}

/**
 * Append one snapshot per post for a completed sync. One read + one
 * write for the whole batch.
 */
export async function appendSnapshots(
  records: Array<{ mediaId: string; snapshot: MetricSnapshot }>,
  now: Date = new Date(),
): Promise<{ appended: number; deduped: number }> {
  if (records.length === 0) return { appended: 0, deduped: 0 };
  const store = await readHistory();
  const result = appendSnapshotsToStore(store, records, now);
  if (result.appended > 0) {
    await writeHistory(store);
  }
  return result;
}
