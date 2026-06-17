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
