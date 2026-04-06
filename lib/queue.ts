import fs from 'fs';
import path from 'path';

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
const BLOB_QUEUE_PATHNAME = 'queue/queue.json';

// ── Vercel Blob helpers (dynamic import so the file works without token in local dev) ──

async function readFromBlob(): Promise<QueuePost[]> {
  const { head } = await import('@vercel/blob');
  try {
    // Use head() to get the live, non-cached URL for the queue file
    const blob = await head(BLOB_QUEUE_PATHNAME);
    const res = await fetch(blob.url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return [];
    return (await res.json()) as QueuePost[];
  } catch {
    return [];
  }
}

async function writeToBlob(posts: QueuePost[]): Promise<void> {
  const { put } = await import('@vercel/blob');
  await put(BLOB_QUEUE_PATHNAME, JSON.stringify(posts, null, 2), {
    access: 'public',
    allowOverwrite: true,
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

// ── Local file fallback ──

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

// ── Public API ──

function useBlob(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

export async function readQueue(): Promise<QueuePost[]> {
  return useBlob() ? readFromBlob() : readFromFile();
}

export async function writeQueue(posts: QueuePost[]): Promise<void> {
  if (useBlob()) {
    await writeToBlob(posts);
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
