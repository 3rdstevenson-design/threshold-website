import fs from 'fs';
import path from 'path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, useR2 } from './r2';
import { lintVoiceDna, type VoiceViolation } from './voice/voiceDnaLint';

export type ContentPillar = 'clinic_case' | 'exercise' | 'philosophy' | 'story';
// 'failed' is terminal-with-retry: a publish exceeded its attempt ceiling (or
// got stuck in 'processing' past max-age) and needs a human look. Only an
// actual publish attempt or the reaper may set it — never a migration or
// startup sweep, so pre-existing 'approved' posts are never mass-flagged.
export type PostStatus = 'pending' | 'approved' | 'rejected' | 'published' | 'processing' | 'sent_to_telegram' | 'failed';
export type PostType = 'image' | 'carousel' | 'reel';

export interface QueuePost {
  id: string;
  status: PostStatus;
  type: PostType;
  pillar: ContentPillar;
  caption: string;
  // image posts
  imageUrl?: string;
  // carousel posts
  imageUrls?: string[];
  // reel posts
  videoUrl?: string;
  coverImageUrl?: string;
  scheduledTime: string;
  createdAt: string;
  approvedAt: string | null;
  publishedAt: string | null;
  metaPublishId: string | null;
  metaContainerId?: string;
  publishError?: string;
  /** Consecutive failed publish attempts. Cleared on success. Network-offline
   *  failures do NOT count — offline catch-up must never exhaust the ceiling. */
  publishAttempts?: number;
  /** When the last publish attempt started (container create / publish call).
   *  The processing-reaper ages against this, never against scheduledTime. */
  lastAttemptAt?: string;
  /** Source file size in bytes at queue time (sum of slides for carousels).
   *  Used with `notes` to dedupe: same name + same size = same content.
   *  Absent on older rows — those keep matching on name alone. */
  sourceSize?: number;
  /** Hard Voice-DNA violations recorded when an automated insert degraded to
   *  a placeholder caption instead of rejecting the post (see
   *  appendPostIfNotExists callers). Shown in the queue UI for review. */
  voiceViolations?: string[];
  /** Set when a carousel was handed off to Telegram for manual posting in the
   *  IG app (native music can't be attached via the Content Publishing API).
   *  The post is intentionally NOT published to Instagram. */
  telegramSentAt?: string;
  notes?: string;
  /** Editor project slug — the folder name under TAKES_ROOT. Set by the
   *  watch-renders auto-queue step so retention-frame extraction can find
   *  the rendered source `.mp4`. For older rows, fall back to stripping
   *  `.mp4` off `notes`. */
  slug?: string;
  /** Reel diverted to Telegram for manual posting (Lars adds music in IG) instead
   *  of auto-publishing. Set for the StoryReel/timelapse pipeline (story-* renders). */
  manualPost?: boolean;
  /** Explicit bypass of the Voice-DNA lint gate on queue writes. Set
   *  automatically for human-written sidecar captions (Lars's own words are
   *  deliberate) or manually from the dashboard when overriding a violation. */
  voiceOverride?: boolean;
}

/** Placeholder captions the dashboard uses before a real caption exists. */
const CAPTION_PLACEHOLDER_RE = /add caption before approving/i;

export class VoiceDnaViolationError extends Error {
  readonly violations: VoiceViolation[];
  constructor(violations: VoiceViolation[]) {
    super(
      `Caption failed Voice DNA lint: ${violations
        .map((v) => `[${v.category}] "${v.match}"`)
        .join('; ')}`,
    );
    this.name = 'VoiceDnaViolationError';
    this.violations = violations;
  }
}

/**
 * The Voice-DNA gate. Every caption entering the queue passes this unless the
 * post carries `voiceOverride: true`. Soft violations never block.
 */
function assertCaptionVoiceDna(caption: string | undefined, voiceOverride?: boolean): void {
  if (!caption || voiceOverride) return;
  if (CAPTION_PLACEHOLDER_RE.test(caption)) return;
  const hard = lintVoiceDna(caption).violations.filter((v) => v.hard);
  if (hard.length > 0) throw new VoiceDnaViolationError(hard);
}

const LOCAL_QUEUE_PATH = path.join(process.cwd(), 'data', 'queue.json');
// Last-known-good snapshot of the R2 queue, refreshed on every successful R2
// read. Serves READS when R2 is unreachable (Lars's work network blocks it)
// so the dashboard and the autopublish port-probe keep working offline.
// Distinct from LOCAL_QUEUE_PATH, which is the primary store only when R2 is
// not configured — the cache is never written back to R2.
const CACHE_QUEUE_PATH = path.join(process.cwd(), 'data', 'queue-cache.json');
const R2_QUEUE_KEY = 'queue/queue.json';

// ── R2 helpers ────────────────────────────────────────────────────────────────

async function readFromR2(): Promise<QueuePost[]> {
  try {
    const res = await r2.send(new GetObjectCommand({
      Bucket: R2_BUCKET(),
      Key: R2_QUEUE_KEY,
    }));
    const body = await res.Body?.transformToString();
    return body ? JSON.parse(body) : [];
  } catch (e: any) {
    if (e.name === 'NoSuchKey') return [];
    throw e;
  }
}

async function writeToR2(posts: QueuePost[]): Promise<void> {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET(),
    Key: R2_QUEUE_KEY,
    Body: JSON.stringify(posts, null, 2),
    ContentType: 'application/json',
  }));
}

// ── Local file fallback ───────────────────────────────────────────────────────

function readFromFile(): QueuePost[] {
  try {
    if (!fs.existsSync(LOCAL_QUEUE_PATH)) return [];
    return JSON.parse(fs.readFileSync(LOCAL_QUEUE_PATH, 'utf-8')) as QueuePost[];
  } catch {
    return [];
  }
}

function writeToFile(posts: QueuePost[]): void {
  const dir = path.dirname(LOCAL_QUEUE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOCAL_QUEUE_PATH, JSON.stringify(posts, null, 2));
}

// ── Offline snapshot cache ────────────────────────────────────────────────────

type QueueCache = { cachedAt: string; posts: QueuePost[] };

function writeCache(posts: QueuePost[]): void {
  try {
    const dir = path.dirname(CACHE_QUEUE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const cache: QueueCache = { cachedAt: new Date().toISOString(), posts };
    fs.writeFileSync(CACHE_QUEUE_PATH, JSON.stringify(cache, null, 2));
  } catch {
    // Best-effort — a failed cache write must never fail a live read.
  }
}

function readCache(): QueueCache | null {
  try {
    if (!fs.existsSync(CACHE_QUEUE_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(CACHE_QUEUE_PATH, 'utf-8'));
    if (!Array.isArray(parsed?.posts)) return null;
    return parsed as QueueCache;
  } catch {
    return null;
  }
}

export type QueueReadMeta = {
  posts: QueuePost[];
  /** 'live' = authoritative store; 'cache' = R2 unreachable, serving the
   *  last-known-good snapshot (read-only view — writes still fail loudly). */
  source: 'live' | 'cache';
  cachedAt?: string;
};

/** Read the queue, degrading to the last-known-good snapshot when R2 is
 *  unreachable. Callers that must never act on stale data (all WRITE paths)
 *  use readQueue(), which still throws when the live store is unreachable. */
export async function readQueueWithMeta(): Promise<QueueReadMeta> {
  if (!useR2()) return { posts: readFromFile(), source: 'live' };
  try {
    const posts = await readFromR2();
    writeCache(posts);
    return { posts, source: 'live' };
  } catch (err) {
    const cache = readCache();
    if (cache) return { posts: cache.posts, source: 'cache', cachedAt: cache.cachedAt };
    throw err;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function readQueue(): Promise<QueuePost[]> {
  if (!useR2()) return readFromFile();
  const posts = await readFromR2();
  writeCache(posts);
  return posts;
}

export async function writeQueue(posts: QueuePost[]): Promise<void> {
  if (useR2()) {
    await writeToR2(posts);
  } else {
    writeToFile(posts);
  }
}

export async function appendPost(post: QueuePost): Promise<void> {
  assertCaptionVoiceDna(post.caption, post.voiceOverride);
  await runExclusive(async () => {
    const posts = await readQueue();
    posts.push(post);
    await writeQueue(posts);
  });
}

// Atomic upsert keyed by `notes` (+ source size when both sides have one).
// If a matching post already exists, returns it instead of appending. Size
// disambiguates distinct videos that share a filename (re-renders, carousel
// re-exports): same name + different size = different content = new post.
// Rows without sourceSize (all pre-existing entries) keep matching on name
// alone, so this never re-queues or alters anything already in the queue.
// All queue writes go through a single in-process mutex so read-then-write
// can't race with itself.
export async function appendPostIfNotExists(
  post: QueuePost,
  notesKey: string,
  sourceSize?: number,
): Promise<{ post: QueuePost; created: boolean }> {
  assertCaptionVoiceDna(post.caption, post.voiceOverride);
  return runExclusive(async () => {
    const posts = await readQueue();
    const existing = posts.find(
      (p) =>
        p.notes === notesKey &&
        (p.sourceSize === undefined || sourceSize === undefined || p.sourceSize === sourceSize),
    );
    if (existing) return { post: existing, created: false };
    posts.push(post);
    await writeQueue(posts);
    return { post, created: true };
  });
}

// In-process serialization for all queue mutations. Narrows — but does not
// eliminate — the cross-process race against R2: two serverless instances
// could still read the same snapshot concurrently. The notes-key recheck
// above catches the common case where the same file is uploaded twice by
// the same client.
let queueMutex: Promise<unknown> = Promise.resolve();
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = queueMutex.then(fn, fn);
  queueMutex = next.catch(() => {});
  return next;
}

export async function updatePost(id: string, updates: Partial<QueuePost>): Promise<void> {
  await runExclusive(async () => {
    const posts = await readQueue();
    const idx = posts.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error(`Post ${id} not found`);
    const merged = { ...posts[idx], ...updates };
    // Gate only when the caption itself is changing; status/scheduling updates
    // on an existing (possibly pre-gate) caption must not be blocked.
    if (updates.caption !== undefined && updates.caption !== posts[idx].caption) {
      assertCaptionVoiceDna(merged.caption, merged.voiceOverride);
    }
    posts[idx] = merged;
    await writeQueue(posts);
  });
}

export async function deletePost(id: string): Promise<void> {
  await runExclusive(async () => {
    const posts = await readQueue();
    const filtered = posts.filter((p) => p.id !== id);
    await writeQueue(filtered);
  });
}
