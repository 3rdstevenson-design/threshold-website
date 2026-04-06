import { QueuePost } from './queue';

const BASE = 'https://graph.instagram.com/v19.0';

function igId() {
  const id = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!id) throw new Error('INSTAGRAM_ACCOUNT_ID is not set');
  return id;
}

function token() {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new Error('META_ACCESS_TOKEN is not set');
  return t;
}

async function apiPost(path: string, body: Record<string, unknown>): Promise<Record<string, string>> {
  const url = `${BASE}${path}`;
  const params = new URLSearchParams({ access_token: token(), ...Object.fromEntries(
    Object.entries(body).map(([k, v]) => [k, String(v)])
  )});
  const res = await fetch(url, { method: 'POST', body: params });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Meta API error (${path}): ${JSON.stringify(json.error || json)}`);
  }
  return json;
}

async function createMediaContainer(params: Record<string, unknown>): Promise<string> {
  const json = await apiPost(`/${igId()}/media`, params);
  if (!json.id) throw new Error('No container id returned from Meta API');
  return json.id;
}

async function publishContainer(containerId: string): Promise<string> {
  const json = await apiPost(`/${igId()}/media_publish`, { creation_id: containerId });
  if (!json.id) throw new Error('No media id returned from publish call');
  return json.id;
}

async function pollContainerStatus(containerId: string, maxMs = 180_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await fetch(
      `${BASE}/${containerId}?fields=status_code&access_token=${token()}`
    );
    const json = await res.json();
    if (json.status_code === 'FINISHED') return;
    if (json.status_code === 'ERROR') {
      throw new Error(`Reel container processing failed: ${JSON.stringify(json)}`);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error('Reel container timed out after 3 minutes');
}

// ── Public publish functions ───────────────────────────────────────────────────
// scheduledTime: when to publish. Instagram requires it to be 10+ minutes in
// the future and at most 75 days out. The post will appear as "Scheduled" in
// the Instagram app and Meta Business Suite immediately after calling these.

export async function publishImagePost(post: QueuePost, scheduledTime: Date): Promise<string> {
  if (!post.imageUrl) throw new Error('imageUrl is required for image posts');
  const containerId = await createMediaContainer({
    image_url: post.imageUrl,
    caption: post.caption,
    published: false,
    scheduled_publish_time: Math.floor(scheduledTime.getTime() / 1000),
  });
  return publishContainer(containerId);
}

export async function publishCarouselPost(post: QueuePost, scheduledTime: Date): Promise<string> {
  if (!post.imageUrls?.length) throw new Error('imageUrls is required for carousel posts');

  // Item containers have no published/scheduled_publish_time — only the parent does
  const itemIds = await Promise.all(
    post.imageUrls.map((url) =>
      createMediaContainer({ image_url: url, is_carousel_item: true })
    )
  );

  const carouselId = await createMediaContainer({
    media_type: 'CAROUSEL',
    caption: post.caption,
    children: itemIds.join(','),
    published: false,
    scheduled_publish_time: Math.floor(scheduledTime.getTime() / 1000),
  });

  return publishContainer(carouselId);
}

export async function publishReelPost(post: QueuePost, scheduledTime: Date): Promise<string> {
  if (!post.videoUrl) throw new Error('videoUrl is required for reel posts');
  const params: Record<string, unknown> = {
    media_type: 'REELS',
    video_url: post.videoUrl,
    caption: post.caption,
    published: false,
    scheduled_publish_time: Math.floor(scheduledTime.getTime() / 1000),
  };
  if (post.coverImageUrl) params.cover_url = post.coverImageUrl;

  const containerId = await createMediaContainer(params);

  // Poll until video is processed before confirming schedule
  await pollContainerStatus(containerId);

  return publishContainer(containerId);
}
