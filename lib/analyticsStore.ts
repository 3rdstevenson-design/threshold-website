import fs from 'fs';
import path from 'path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, useR2 } from './r2';

export interface RetentionPoint {
  sec: number;
  pctViewers: number;
}

export interface RetentionFrame {
  sec: number;
  frameUrl: string;
  description: string;
}

export interface PostPerformance {
  mediaId: string;
  queuePostId?: string;
  /** Editor project slug — the folder name under TAKES_ROOT. Populated by
   *  the sync cron when a QueuePost has a matching metaPublishId. Enables
   *  frame extraction from the rendered .mp4 for retention-cliff analysis. */
  slug?: string;
  /** True when the row was created via retention-upload before Meta sync
   *  had a chance to pull real metrics. The next cron run overwrites the
   *  zeroed fields without clobbering retentionCurve/Frames. */
  manualEntry?: boolean;
  caption: string;
  mediaType: 'IMAGE' | 'CAROUSEL_ALBUM' | 'REELS' | 'VIDEO';
  timestamp: string;
  syncedAt: string;
  views: number;
  likes: number;
  shares: number;
  saves: number;
  comments: number;
  engagementRate: number;
  manychatKeyword?: string;

  // Watch-time (Meta Graph API, REELS/VIDEO only).
  avgWatchTimeMs?: number;
  totalWatchTimeMs?: number;
  replays?: number;
  videoDurationMs?: number;
  /** avgWatchTimeMs / videoDurationMs, clamped to [0, 1]. */
  completionRate?: number;

  // Per-second retention, sourced from a manually uploaded screenshot
  // of Instagram's Professional Dashboard retention chart.
  retentionCurve?: RetentionPoint[];
  retentionScreenshotUrl?: string;
  retentionUploadedAt?: string;
  retentionNotes?: string;
  /** One frame per drop cliff from the rendered source video, each with
   *  a short Claude-vision description of what was on screen when viewers
   *  dropped. Computed once per retention upload, not per editor call. */
  retentionFrames?: RetentionFrame[];
}

export interface AnalyticsStore {
  lastSyncedAt: string;
  posts: PostPerformance[];
}

const LOCAL_PATH = path.join(process.cwd(), 'data', 'analytics.json');
const R2_KEY = 'analytics/performance.json';

const EMPTY: AnalyticsStore = { lastSyncedAt: '', posts: [] };

async function readFromR2(): Promise<AnalyticsStore> {
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET(), Key: R2_KEY }));
    const body = await res.Body?.transformToString();
    return body ? JSON.parse(body) : EMPTY;
  } catch (e: any) {
    if (e.name === 'NoSuchKey') return { ...EMPTY };
    throw e;
  }
}

async function writeToR2(store: AnalyticsStore): Promise<void> {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET(),
    Key: R2_KEY,
    Body: JSON.stringify(store, null, 2),
    ContentType: 'application/json',
  }));
}

function readFromFile(): AnalyticsStore {
  try {
    if (!fs.existsSync(LOCAL_PATH)) return { ...EMPTY };
    return JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf-8'));
  } catch {
    return { ...EMPTY };
  }
}

function writeToFile(store: AnalyticsStore): void {
  const dir = path.dirname(LOCAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(store, null, 2));
}

export async function readAnalytics(): Promise<AnalyticsStore> {
  return useR2() ? readFromR2() : readFromFile();
}

export async function writeAnalytics(store: AnalyticsStore): Promise<void> {
  if (useR2()) {
    await writeToR2(store);
  } else {
    writeToFile(store);
  }
}

export async function upsertPerformance(post: PostPerformance): Promise<void> {
  const store = await readAnalytics();
  const idx = store.posts.findIndex((p) => p.mediaId === post.mediaId);
  if (idx === -1) {
    store.posts.push(post);
  } else {
    // Preserve existing optional fields (retention curve, uploaded notes,
    // frame descriptions) when a sync pass writes a fresh record without
    // them. A sync that picks up real metrics also clears the manualEntry
    // flag — the row is no longer a stub.
    const existing = store.posts[idx];
    const wasManual = existing.manualEntry === true;
    const hasRealMetrics = post.views > 0 || post.likes > 0 || post.comments > 0;
    store.posts[idx] = {
      ...existing,
      ...post,
      manualEntry: wasManual && !hasRealMetrics ? true : undefined,
      slug: post.slug ?? existing.slug,
      retentionCurve: post.retentionCurve ?? existing.retentionCurve,
      retentionScreenshotUrl: post.retentionScreenshotUrl ?? existing.retentionScreenshotUrl,
      retentionUploadedAt: post.retentionUploadedAt ?? existing.retentionUploadedAt,
      retentionNotes: post.retentionNotes ?? existing.retentionNotes,
      retentionFrames: post.retentionFrames ?? existing.retentionFrames,
    };
  }
  store.lastSyncedAt = new Date().toISOString();
  await writeAnalytics(store);
}

/**
 * Insert a minimal stub PostPerformance for a mediaId that isn't in the
 * store yet — used when the user uploads a retention screenshot for a
 * Reel before Meta's sync cron has pulled real metrics for it. The next
 * sync upgrades this record with real views/likes/completionRate while
 * preserving the retention fields (see upsertPerformance merge logic).
 */
export async function upsertStubPerformance(input: {
  mediaId: string;
  caption?: string;
  timestamp?: string;
  videoDurationMs?: number;
  slug?: string;
}): Promise<PostPerformance> {
  const store = await readAnalytics();
  const existing = store.posts.find((p) => p.mediaId === input.mediaId);
  if (existing) return existing;

  const stub: PostPerformance = {
    mediaId: input.mediaId,
    slug: input.slug,
    manualEntry: true,
    caption: input.caption ?? '',
    mediaType: 'REELS',
    timestamp: input.timestamp ?? new Date().toISOString(),
    syncedAt: '',
    views: 0,
    likes: 0,
    shares: 0,
    saves: 0,
    comments: 0,
    engagementRate: 0,
    videoDurationMs: input.videoDurationMs,
  };
  store.posts.push(stub);
  store.lastSyncedAt = new Date().toISOString();
  await writeAnalytics(store);
  return stub;
}

/**
 * Merge a partial update into an existing post record without requiring
 * all sync fields. Used by the retention-upload endpoint, which only
 * knows the retention curve — not views/likes/etc.
 */
export async function mergePerformance(
  mediaId: string,
  patch: Partial<PostPerformance>,
): Promise<PostPerformance | null> {
  const store = await readAnalytics();
  const idx = store.posts.findIndex((p) => p.mediaId === mediaId);
  if (idx === -1) return null;
  store.posts[idx] = { ...store.posts[idx], ...patch };
  store.lastSyncedAt = new Date().toISOString();
  await writeAnalytics(store);
  return store.posts[idx];
}
