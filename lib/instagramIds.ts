/**
 * instagramIds.ts
 *
 * Instagram media-id resolution shared by the retention endpoints:
 * accepts a numeric media id, a raw shortcode, or a Reel/post URL and
 * normalizes to the numeric media pk.
 */

const SHORTCODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Decode an Instagram shortcode to the numeric media pk. Uses the standard
 * base64 alphabet (A-Z, a-z, 0-9, -, _). The pk is the first 11 chars for
 * Reels; we decode the full shortcode for safety and stringify as decimal.
 */
export function shortcodeToMediaId(shortcode: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(shortcode)) return null;
  let n = BigInt(0);
  const radix = BigInt(64);
  for (let i = 0; i < shortcode.length; i++) {
    const idx = SHORTCODE_ALPHABET.indexOf(shortcode.charAt(i));
    if (idx < 0) return null;
    n = n * radix + BigInt(idx);
  }
  return n.toString();
}

export function extractShortcode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:reel|p|reels)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

export function resolveMediaId(input: { mediaId?: string; reelUrl?: string }): string | null {
  const direct = input.mediaId?.trim();
  if (direct) {
    if (/^\d{10,}$/.test(direct)) return direct;
    // Accept a raw shortcode too.
    if (/^[A-Za-z0-9_-]{5,}$/.test(direct)) {
      const decoded = shortcodeToMediaId(direct);
      if (decoded) return decoded;
    }
  }
  const url = input.reelUrl?.trim();
  if (url) {
    const sc = extractShortcode(url);
    if (sc) return shortcodeToMediaId(sc);
    if (/^\d{10,}$/.test(url)) return url;
  }
  return null;
}
