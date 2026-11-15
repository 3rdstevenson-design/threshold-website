/**
 * Minimal Resend REST client (no SDK dependency). Server-side only.
 * Docs: https://resend.com/docs/api-reference — free plan 3,000 emails/mo, 100/day; scheduled sends up to 30 days out.
 */

// RESEND_API_BASE exists only so local tests can point at a mock; never set it in Vercel.
const API = process.env.RESEND_API_BASE || "https://api.resend.com";

export class ResendError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function key(): string {
  const k = process.env.RESEND_API_KEY;
  if (!k) throw new ResendError(0, "RESEND_API_KEY is not set");
  return k;
}

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  // Resend rate-limits per second; retry a 429 twice.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key()}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 2) {
      const wait = Number(res.headers.get("retry-after")) || 1;
      await sleep(wait * 1000);
      continue;
    }
    const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
    if (!res.ok) throw new ResendError(res.status, `${method} ${path} -> ${res.status}: ${json?.message ?? "error"}`);
    return json as T;
  }
}

export type OutgoingEmail = {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  scheduledAt?: Date;
  tags?: { name: string; value: string }[];
  idempotencyKey?: string;
  /** Base64 file content (Resend's `attachments`). */
  attachments?: { filename: string; content: string }[];
};

export async function sendEmail(e: OutgoingEmail): Promise<string> {
  const out = await call<{ id: string }>(
    "POST",
    "/emails",
    {
      from: e.from,
      to: [e.to],
      reply_to: e.replyTo,
      subject: e.subject,
      text: e.text,
      html: e.html,
      headers: e.headers,
      tags: e.tags,
      ...(e.attachments?.length ? { attachments: e.attachments } : {}),
      ...(e.scheduledAt ? { scheduled_at: e.scheduledAt.toISOString() } : {}),
    },
    e.idempotencyKey ? { "Idempotency-Key": e.idempotencyKey } : undefined,
  );
  return out.id;
}

export async function cancelEmail(id: string): Promise<void> {
  await call("POST", `/emails/${encodeURIComponent(id)}/cancel`);
}

export type Contact = { id: string; email: string; first_name?: string; unsubscribed: boolean };

/** null when the contact doesn't exist yet. */
export async function getContact(email: string): Promise<Contact | null> {
  try {
    return await call<Contact>("GET", `/contacts/${encodeURIComponent(email)}`);
  } catch (e) {
    if (e instanceof ResendError && e.status === 404) return null;
    throw e;
  }
}

export async function createContact(email: string, firstName: string, unsubscribed = false): Promise<void> {
  await call("POST", "/contacts", { email, first_name: firstName, unsubscribed });
}

export async function updateContact(email: string, fields: { first_name?: string; unsubscribed?: boolean }): Promise<void> {
  await call("PATCH", `/contacts/${encodeURIComponent(email)}`, fields);
}
