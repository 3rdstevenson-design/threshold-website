/**
 * preflight-queue-media.ts — daily guarantee that every post still waiting to
 * go out has media that will still be there when it does.
 *
 * WHY THIS EXISTS (2026-08-05)
 * The R2 lifecycle rule `expire-instagram-media-30d` deletes everything under
 * `instagram/` 30 days after upload, on the premise that published media is
 * transit-only. That premise is false for anything scheduled further out than a
 * month: a loop reel uploaded 07-02 and scheduled 08-05 had its object collected
 * on ~08-01, so the Telegram hand-off died on a 404 and the post burned its five
 * attempts into `failed`. `scripts/fix-loop-reels.ts` covers `story-loop-*` only;
 * the same exposure sat on 22 carousels and 6 teleprompter reels.
 *
 * WHAT IT DOES
 * For every undelivered post (pending / approved / failed / processing), checks
 * each media URL and re-uploads from the local source when it is either
 *   • already unreachable, or
 *   • on the expiring prefix and due to be collected within RENEW_WITHIN_DAYS.
 * A re-upload mints a fresh key, so the 30-day clock restarts; running daily
 * means nothing can reach its expiry unnoticed. `story-*` media lands on the
 * non-expiring `manual/` prefix (see lib/upload.ts) and never needs renewing.
 *
 * Deliberately does NOT widen `manual/` to everything: auto-published media
 * really is transit, and letting it expire after publish is what keeps the
 * bucket under the free tier. Superseded `instagram/` keys become orphans,
 * which is exactly what `scripts/audit-r2-orphans.mjs` cleans up.
 *
 *   npx tsx scripts/preflight-queue-media.ts          # heal + Telegram report
 *   npx tsx scripts/preflight-queue-media.ts --dry    # report only, no writes
 *   npx tsx scripts/preflight-queue-media.ts --quiet  # no Telegram, stdout only
 *
 * launchd: com.threshold.loop-audit (daily 08:00, alongside fix-loop-reels --audit)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Load .env.local BEFORE importing anything that reads it (lib/r2 builds its
// S3 client at module load from process.env).
const envPath = fileURLToPath(new URL('../.env.local', import.meta.url));
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

const DRY = process.argv.includes('--dry');
const QUIET = process.argv.includes('--quiet');

/** Statuses that still owe a delivery. Anything else has already gone out. */
const UNDELIVERED = new Set(['pending', 'approved', 'failed', 'processing']);

/** Mirrors the `expire-instagram-media-30d` rule in scripts/set-r2-lifecycle.mjs. */
const LIFECYCLE_PREFIX = 'instagram/';
const LIFECYCLE_DAYS = 30;
/** Renew this far ahead of collection. Must exceed the daily run interval by a
 *  wide margin so missed runs (laptop closed, travel) still can't lose an
 *  object: 14 days = 14 consecutive missed audits before anything is at risk.
 *  Also the renewal period — each object is re-uploaded about once a month,
 *  not nightly. */
const RENEW_WITHIN_DAYS = 14;
const DAY_MS = 86_400_000;

async function sendTelegram(text: string): Promise<void> {
  if (QUIET) return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.warn('[preflight] TELEGRAM_BOT_TOKEN not set — printing only'); return; }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID || '8685910630', text }),
    });
  } catch (e: any) {
    console.warn(`[preflight] telegram failed: ${e?.message ?? e}`);
  }
}

/** `https://…/instagram/1783002054177-name.mp4` → `{ prefix, uploadedAtMs }`. */
function parseKey(url: string): { prefix: string; uploadedAtMs: number | null } | null {
  const m = url.match(/\/(instagram|manual|slides)\/(\d{13})-/);
  if (!m) {
    const p = url.match(/\/(instagram|manual|slides)\//);
    return p ? { prefix: `${p[1]}/`, uploadedAtMs: null } : null;
  }
  return { prefix: `${m[1]}/`, uploadedAtMs: Number(m[2]) };
}

async function reachable(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    clearTimeout(t);
    // A 0-byte/truncated object returns 200 but won't play — treat as broken.
    return res.ok && Number(res.headers.get('content-length') || 0) > 0;
  } catch {
    return false;
  }
}

type Risk = { url: string; why: string };

/**
 * Why (if at all) this URL needs renewing now.
 *
 * The trigger is proximity to EXPIRY, not to the post's due date. Renewing on
 * "expires before this post is due" is tempting — it reads like the real
 * condition — but a post scheduled 90 days out can never satisfy it with a
 * 30-day lease, so it would re-upload every single night forever. Renewing
 * inside a rolling window achieves the same guarantee with one upload per
 * object per month: as long as this runs at least once every
 * RENEW_WITHIN_DAYS, no object can reach its expiry unrenewed, however far out
 * the post is scheduled. The due date only sharpens the message.
 */
async function assess(url: string, now: number, dueAtMs: number | null): Promise<Risk | null> {
  if (!(await reachable(url))) return { url, why: 'unreachable (already expired or never landed)' };
  const key = parseKey(url);
  if (!key || key.prefix !== LIFECYCLE_PREFIX) return null;
  if (key.uploadedAtMs === null) {
    // On the expiring prefix with no parseable timestamp — can't date it, so
    // renew rather than gamble on it outliving the post.
    return { url, why: 'on the expiring prefix with an undatable key' };
  }
  const expiresAtMs = key.uploadedAtMs + LIFECYCLE_DAYS * DAY_MS;
  const daysLeft = Math.floor((expiresAtMs - now) / DAY_MS);
  if (daysLeft > RENEW_WITHIN_DAYS) return null;
  const beforeDue = dueAtMs !== null && expiresAtMs < dueAtMs;
  return {
    url,
    why: `expires in ${daysLeft}d on the ${LIFECYCLE_PREFIX} prefix` +
      (beforeDue ? ', BEFORE this post is due — the exact 2026-08-05 failure' : ''),
  };
}

async function main(): Promise<void> {
  const { readQueue, updatePost } = await import('../lib/queue');
  const { uploadFile } = await import('../lib/upload');
  const { resolveDraftFile } = await import('../lib/transcribe');
  const { scanLocalFiles } = await import('../lib/localScan');

  const now = Date.now();
  const posts = await readQueue();
  const undelivered = posts.filter((p) => UNDELIVERED.has(p.status));
  const local = scanLocalFiles();

  const healed: string[] = [];
  const unhealable: string[] = [];
  const failedPosts: string[] = [];
  let checked = 0;

  for (const p of undelivered) {
    const label = `${p.notes || p.id} (${p.type}, ${p.status}, due ${String(p.scheduledTime).slice(0, 10)})`;
    if (p.status === 'failed') failedPosts.push(label);

    const urls = [p.videoUrl, p.imageUrl, ...(p.imageUrls ?? []), p.coverImageUrl].filter(
      (u): u is string => typeof u === 'string' && u.length > 0,
    );
    if (urls.length === 0) {
      unhealable.push(`${label}: no media URL on the post at all`);
      continue;
    }
    checked++;

    const dueMs = Date.parse(String(p.scheduledTime));
    const dueAtMs = Number.isFinite(dueMs) ? dueMs : null;
    const risks: Risk[] = [];
    for (const u of urls) {
      const r = await assess(u, now, dueAtMs);
      if (r) risks.push(r);
    }
    if (risks.length === 0) continue;

    const why = risks[0].why;
    if (DRY) {
      healed.push(`${label}: WOULD renew ${risks.length}/${urls.length} object(s) — ${why}`);
      continue;
    }

    try {
      const patch = await rebuild(p, { resolveDraftFile, scanLocal: local, uploadFile });
      if (!patch) {
        unhealable.push(`${label}: ${why}, and no local source to re-upload from`);
        continue;
      }
      await updatePost(p.id, patch);
      healed.push(`${label}: renewed ${Object.keys(patch).join(', ')} — ${why}`);
    } catch (e: any) {
      unhealable.push(`${label}: ${why}, and the re-upload failed (${e?.message ?? e})`);
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const lines: string[] = [];
  const bad = unhealable.length + failedPosts.length;
  lines.push(
    bad === 0 && healed.length === 0
      ? `✅ Queue media preflight: all ${checked} undelivered posts have media that outlives their schedule.`
      : `${bad > 0 ? '⚠️' : '🔧'} Queue media preflight: ${checked} undelivered posts checked, ` +
        `${healed.length} renewed, ${unhealable.length} need a human, ${failedPosts.length} sitting in failed.`,
  );
  if (failedPosts.length) lines.push(`\nFAILED — will not retry on their own:\n${failedPosts.map((s) => `• ${s}`).join('\n')}`);
  if (unhealable.length) lines.push(`\nCOULD NOT REPAIR:\n${unhealable.map((s) => `• ${s}`).join('\n')}`);
  if (healed.length) lines.push(`\n${DRY ? 'WOULD RENEW' : 'RENEWED'}:\n${healed.map((s) => `• ${s}`).join('\n')}`);

  const report = lines.join('\n');
  console.log(report);
  // Quiet on a clean run: a daily "nothing to do" ping trains Lars to ignore
  // the channel, which is exactly how the 08-05 miss stayed invisible.
  if (bad > 0 || healed.length > 0) await sendTelegram(report);
  if (bad > 0) process.exit(1);
}

/**
 * Re-upload a post's media from its local source and return the URL patch.
 * Returns null when no local source can be resolved — better to report a post
 * as unrepairable than to leave it pointing at media that is about to vanish.
 */
async function rebuild(
  p: any,
  deps: {
    resolveDraftFile: (name: string) => string | null;
    scanLocal: Array<{ id: string; type: string; name: string; slidePaths?: string[] }>;
    uploadFile: (filePath: string, filename: string) => Promise<string>;
  },
): Promise<Record<string, unknown> | null> {
  const { resolveDraftFile, scanLocal, uploadFile } = deps;
  const name: string = p.notes ?? '';

  if (p.type === 'reel') {
    const file = name ? resolveDraftFile(name) : null;
    if (!file) return null;
    const patch: Record<string, unknown> = { videoUrl: await uploadFile(file, name) };
    // Regenerate the poster too: the old cover shares the dead prefix, and the
    // queue card renders black without one.
    try {
      const cover = `${path.basename(name, path.extname(name))}-cover.jpg`;
      const tmp = path.join(os.tmpdir(), cover);
      execSync(`ffmpeg -y -ss 0.1 -i "${file}" -frames:v 1 -vf scale=720:-1 -q:v 3 "${tmp}" 2>/dev/null`);
      patch.coverImageUrl = await uploadFile(tmp, cover);
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // A cover is cosmetic; a playable video is not. Keep the video renewal.
    }
    return patch;
  }

  if (p.type === 'carousel') {
    const entry = scanLocal.find((f) => f.type === 'carousel' && f.name === name);
    const slides = entry?.slidePaths ?? [];
    if (slides.length === 0) return null;
    // Slide count must match, or re-uploading would silently change the post.
    const existing = (p.imageUrls ?? []).length;
    if (existing > 0 && slides.length !== existing) {
      throw new Error(`local folder has ${slides.length} slides but the post references ${existing}`);
    }
    const urls: string[] = [];
    for (const s of slides) urls.push(await uploadFile(s, path.basename(s)));
    return { imageUrls: urls };
  }

  if (p.type === 'image') {
    const file = name ? resolveDraftFile(name) : null;
    if (!file) return null;
    return { imageUrl: await uploadFile(file, name) };
  }

  return null;
}

// A watchdog that dies quietly is worse than no watchdog — it reads as "all
// clear" every morning. Any crash (R2 unreachable, bad creds, tsx failure)
// announces itself on the same channel as the findings.
main().catch(async (e) => {
  console.error(e);
  await sendTelegram(
    `🚨 Queue media preflight CRASHED — nothing was checked today.\n${e?.message ?? e}\n\n` +
      `Run it by hand: cd ~/Code/Development/threshold-dashboard && npx tsx scripts/preflight-queue-media.ts`,
  );
  process.exit(1);
});
