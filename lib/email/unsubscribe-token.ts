import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed unsubscribe token, so no database is needed.
 *
 * Resend-era tokens (2026-11-14 to 2026-11-27) carry the email plus the IDs of the Resend emails still queued *after*
 * the one they sit in, so unsubscribing from any email cancels everything still to come. Tokens in the Gmail emails
 * (src "g", since 2026-11-27) carry no IDs: the signup Sheet is the list, and its script cancels what's queued.
 */

export type UnsubscribePayload = { e: string; ids: string[]; src?: "g" };

/**
 * Signing keys, preferred first. New tokens use UNSUBSCRIBE_SECRET when it's set, otherwise a key derived from
 * RESEND_API_KEY, so the site runs on one secret (Lars, 2026-11-15). Tokens verify against either key, so adding
 * UNSUBSCRIBE_SECRET later keeps links already sent working. Rotating the Resend key does break links signed with
 * the derived key: set UNSUBSCRIBE_SECRET first and wait 30 days (CAN-SPAM's window) before rotating.
 */
function keys(): string[] {
  const out: string[] = [];
  const own = process.env.UNSUBSCRIBE_SECRET;
  if (own) {
    if (own.length < 32) throw new Error("UNSUBSCRIBE_SECRET is too short (needs 32+ chars)");
    out.push(own);
  }
  const resend = process.env.RESEND_API_KEY;
  if (resend) out.push(createHmac("sha256", resend).update("thresholdhp.com unsubscribe tokens v1").digest("base64url"));
  if (!out.length) throw new Error("No key for unsubscribe tokens: set RESEND_API_KEY (or UNSUBSCRIBE_SECRET)");
  return out;
}

const sign = (key: string, data: string) => createHmac("sha256", key).update(data).digest("base64url");

export function makeToken(payload: UnsubscribePayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(keys()[0], data)}`;
}

/** null if the token is malformed or the signature doesn't match any key. */
export function readToken(token: string): UnsubscribePayload | null {
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const given = Buffer.from(sig);
  const signed = keys().some((k) => {
    const expected = Buffer.from(sign(k, data));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!signed) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as UnsubscribePayload;
    if (typeof p.e !== "string" || !Array.isArray(p.ids) || !p.ids.every((i) => typeof i === "string")) return null;
    if (p.src !== undefined && p.src !== "g") return null;
    return p;
  } catch {
    return null;
  }
}
