/**
 * Telegram hand-off for carousels.
 *
 * Instagram's native music can only be added inside the mobile app, and the
 * Content Publishing API has no parameter for it — so a carousel that should
 * carry music can't be auto-published. Instead we deliver the finished slides
 * + caption to Lars's phone via Telegram; he posts them by hand in the IG app
 * (picking native music there).
 *
 * Slides are passed to Telegram as their public R2 URLs — Telegram fetches them
 * server-side, exactly as Meta does when publishing, so there's no file
 * download or multipart upload to manage.
 *
 * Requires TELEGRAM_BOT_TOKEN in env. NOTE: /api/publish runs on Vercel, so the
 * token must be set in the Vercel project env (not only .env.local). Chat id
 * defaults to Lars's personal chat (8685910630), overridable via
 * TELEGRAM_CHAT_ID. No external dependencies — uses Node's native fetch.
 */
import type { QueuePost } from './queue';

const DEFAULT_CHAT_ID = '8685910630';
const MAX_ALBUM = 10; // Telegram sendMediaGroup accepts 2–10 items per album.

function botToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  return t;
}

function chatId(): string {
  return process.env.TELEGRAM_CHAT_ID || DEFAULT_CHAT_ID;
}

/** Call a Telegram Bot API method as JSON. Throws on any non-ok response. */
async function tg(method: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId(), ...payload }),
  });
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; description?: string }
    | null;
  if (!res.ok || !json?.ok) {
    throw new Error(
      `Telegram ${method} failed (${res.status}): ${json?.description ?? 'unknown error'}`,
    );
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Plain text message to the configured chat. */
export async function sendMessage(text: string): Promise<void> {
  await tg('sendMessage', { text });
}

/**
 * Hand a carousel off to Telegram for manual posting:
 *   1. the slides as photo album(s)  (sendMediaGroup, ≤10 per album)
 *   2. a short header note
 *   3. the full caption alone, for one-tap copy-paste
 *
 * Throws on any failure so the caller can record `publishError` and let the
 * post stay `approved` for a retry on the next cron tick.
 */
export async function sendCarouselToTelegram(post: QueuePost): Promise<void> {
  const urls = post.imageUrls ?? [];
  if (urls.length === 0) {
    throw new Error('carousel has no imageUrls to send');
  }

  // 1. slides
  if (urls.length === 1) {
    await tg('sendPhoto', { photo: urls[0] });
  } else {
    for (const group of chunk(urls, MAX_ALBUM)) {
      await tg('sendMediaGroup', {
        media: group.map((url) => ({ type: 'photo', media: url })),
      });
    }
  }

  // 2. header note
  const title = post.notes || 'carousel';
  await sendMessage(
    `📲 Carousel due: ${title}\n` +
      `Save the slides above, open Instagram, add your music, then paste the caption below 👇`,
  );

  // 3. caption alone (clean copy-paste)
  await sendMessage(post.caption || '(no caption set)');
}

/**
 * Hand a reel off to Telegram for manual posting. Lars adds trending audio in the IG
 * app (the Content Publishing API can't attach native music), so no-monologue reels
 * (timelapse / caption-overlay, tagged `manualPost`) are delivered here instead of
 * auto-published. Sends the video, a short note, then the caption for one-tap copy.
 *
 * Throws on any failure so /api/publish can record `publishError` and leave the post
 * `approved` for a retry on the next cron tick.
 */
export async function sendReelToTelegram(post: QueuePost): Promise<void> {
  if (!post.videoUrl) throw new Error('reel has no videoUrl to send');

  // sendVideo-by-URL caps at ~20MB and rejects larger R2 objects with the misleading
  // "wrong type of the web page content". Reels run ~30-35MB, so download the bytes
  // and upload them as multipart instead — bot uploads allow up to 50MB.
  const res = await fetch(post.videoUrl);
  if (!res.ok) throw new Error(`fetch reel failed (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  if (bytes.byteLength > 49 * 1024 * 1024) {
    // Over the bot-upload ceiling — hand off the direct download link instead.
    await sendMessage(
      `🎞️ Reel due: ${post.notes || 'reel'}\n` +
        `Download, add your trending audio in Instagram, then paste the caption below 👇\n${post.videoUrl}`,
    );
  } else {
    // Send as a DOCUMENT, not sendVideo: Telegram re-encodes / letterboxes a 9:16
    // video in its player (black bars), wrecking the full-frame look. A document
    // delivers the exact rendered 1080×1920 bytes — "Save to Gallery" gives the
    // pristine reel to post, no re-encode.
    const form = new FormData();
    form.append('chat_id', chatId());
    form.append('document', new Blob([bytes], { type: 'video/mp4' }), post.notes || 'reel.mp4');
    const up = await fetch(`https://api.telegram.org/bot${botToken()}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    const j = (await up.json().catch(() => null)) as
      | { ok?: boolean; description?: string }
      | null;
    if (!up.ok || !j?.ok) {
      throw new Error(`Telegram sendDocument failed (${up.status}): ${j?.description ?? 'unknown error'}`);
    }
    await sendMessage(
      `🎞️ Reel due: ${post.notes || 'reel'}\n` +
        `Save the video to your camera roll, open Instagram, add your trending audio, then paste the caption below 👇`,
    );
  }
  await sendMessage(post.caption || '(no caption set)');
}
