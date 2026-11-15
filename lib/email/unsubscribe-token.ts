import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed unsubscribe token, so no database is needed.
 *
 * It carries the email plus the IDs of the emails still queued *after* the one it sits in. The sequence is
 * scheduled last-first (day 5, then day 2, then the thank-you), so each email's token already knows the IDs of
 * the ones that follow it, and unsubscribing from any email cancels everything still to come.
 */

export type UnsubscribePayload = { e: string; ids: string[] };

function secret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET;
  if (!s || s.length < 32) throw new Error("UNSUBSCRIBE_SECRET is not set (needs 32+ chars)");
  return s;
}

const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

export function makeToken(payload: UnsubscribePayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data)}`;
}

/** null if the token is malformed or the signature doesn't match. */
export function readToken(token: string): UnsubscribePayload | null {
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = Buffer.from(sign(data));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as UnsubscribePayload;
    if (typeof p.e !== "string" || !Array.isArray(p.ids) || !p.ids.every((i) => typeof i === "string")) return null;
    return p;
  } catch {
    return null;
  }
}
