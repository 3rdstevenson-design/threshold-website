/**
 * Minimal Telegram Bot API sender for the website: the /contact form sends each lead to Lars's
 * phone through it (see lib/contact-lead.ts).
 *
 * Requires TELEGRAM_BOT_TOKEN in the Vercel project env. Chat id defaults to Lars's personal chat
 * (8685910630), overridable via TELEGRAM_CHAT_ID. No external dependencies — uses Node's native fetch.
 */

const DEFAULT_CHAT_ID = '8685910630';

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

/** Plain text message to the configured chat. */
export async function sendMessage(text: string): Promise<void> {
  await tg('sendMessage', { text });
}
