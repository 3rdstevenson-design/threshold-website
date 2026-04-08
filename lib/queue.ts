import fs from 'fs';
import path from 'path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, useR2 } from './r2';

export type ContentPillar = 'clinic_case' | 'exercise' | 'philosophy' | 'story';
export type PostStatus = 'pending' | 'approved' | 'rejected' | 'published';
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
  notes?: string;
}

const LOCAL_QUEUE_PATH = path.join(process.cwd(), 'data', 'queue.json');
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

// ── Public API ────────────────────────────────────────────────────────────────

export async function readQueue(): Promise<QueuePost[]> {
  return useR2() ? readFromR2() : readFromFile();
}

export async function writeQueue(posts: QueuePost[]): Promise<void> {
  if (useR2()) {
    await writeToR2(posts);
  } else {
    writeToFile(posts);
  }
}

export async function appendPost(post: QueuePost): Promise<void> {
  const posts = await readQueue();
  posts.push(post);
  await writeQueue(posts);
}

export async function updatePost(id: string, updates: Partial<QueuePost>): Promise<void> {
  const posts = await readQueue();
  const idx = posts.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Post ${id} not found`);
  posts[idx] = { ...posts[idx], ...updates };
  await writeQueue(posts);
}
