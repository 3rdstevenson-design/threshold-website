/**
 * One-shot fixer for the loop-reel philosophy batch already sitting in the queue.
 *
 *   • Sets each reel's caption from its `<name>.caption.txt` sidecar (in Reels/Final).
 *   • Re-uploads any reel whose R2 video URL isn't reachable (the black previews).
 *
 * Only touches `story-loop-*` reels that have a sidecar, so it can't disturb
 * anything else in the queue. Reuses the dashboard's own tested helpers.
 *
 *   npx tsx scripts/fix-loop-reels.ts          # apply the fix
 *   npx tsx scripts/fix-loop-reels.ts --dry     # preview only, no writes/uploads
 *   npx tsx scripts/fix-loop-reels.ts --audit   # scheduled health check: no writes,
 *                                               # Telegram report, exit 1 on failures
 *                                               # (launchd: com.threshold.loop-audit)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// 1) Load .env.local into process.env BEFORE importing anything that reads it
//    (lib/r2 builds its S3 client at module load from process.env).
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
const DIAGNOSE = process.argv.includes('--diagnose');
const AUDIT = process.argv.includes('--audit');

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.warn('[audit] TELEGRAM_BOT_TOKEN not set — printing only'); return; }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: '8685910630', text }),
    });
  } catch (e: any) {
    console.warn(`[audit] telegram failed: ${e?.message ?? e}`);
  }
}

/** ffprobe helpers for the audit checks (silent-by-design + playability). */
function probeAudit(local: string): { audibleContent: boolean; playable: boolean } {
  let audibleContent = false;
  try {
    // Remotion always muxes a (silent) audio track, so stream PRESENCE is
    // meaningless — measure loudness instead. Genuinely silent-by-design
    // reels sit near -91dB; anything above -50dB mean is real audio.
    const vol = execSync(
      `ffmpeg -i "${local}" -af volumedetect -f null - 2>&1 | grep mean_volume || true`,
      { encoding: 'utf-8' },
    );
    const m = vol.match(/mean_volume:\s*(-?[\d.]+) dB/);
    if (m) audibleContent = parseFloat(m[1]) > -50;
  } catch { /* no audio stream at all → silent, fine */ }
  try {
    // Playability: decode the last second — catches a truncated mdat that a
    // poster+duration check misses (moov at the front is intact either way).
    execSync(`ffmpeg -v error -sseof -1 -i "${local}" -f null - 2>/dev/null`, { encoding: 'utf-8' });
    return { audibleContent, playable: true };
  } catch {
    return { audibleContent, playable: false };
  }
}

async function videoInfo(url?: string): Promise<{ ok: boolean; length: number; status: number }> {
  if (!url) return { ok: false, length: 0, status: 0 };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    clearTimeout(t);
    const length = Number(res.headers.get('content-length') || 0);
    // A 0-byte / truncated object returns 200 but won't play — treat as broken.
    return { ok: res.ok && length > 100_000, length, status: res.status };
  } catch {
    return { ok: false, length: 0, status: 0 };
  }
}

/**
 * --audit: read-only health check over every queued story-loop/timelapse
 * reel. Per item: sidecar present + Voice-DNA clean, R2 size == local size
 * (the truncated-upload tell), cover set, silent-by-design, tail decodes.
 * Telegram summary (2 sentences per failing item), exit 1 on any failure.
 */
async function runAudit(): Promise<void> {
  const { readQueue } = await import('../lib/queue');
  const { resolveDraftFile, readCaptionSidecar } = await import('../lib/transcribe');
  const { lintVoiceDna } = await import('../lib/voice/voiceDnaLint');

  const posts = await readQueue();
  const failures: string[] = [];
  let checked = 0;

  for (const p of posts) {
    const notes = p.notes;
    if (p.type !== 'reel' || !notes || !/^story-loop-/i.test(notes)) continue;
    if (p.status === 'rejected') continue;
    checked++;
    const problems: string[] = [];

    const local = resolveDraftFile(notes);
    if (!local) {
      failures.push(`${notes}: local file missing from Reels/Final. Re-render or restore it before this can publish.`);
      continue;
    }

    // 1. Sidecar present + voice-clean (hard violations only; sidecars are
    //    Lars's words so this is informational in the report, not a rewrite).
    const sidecar = readCaptionSidecar(local);
    if (!sidecar) {
      problems.push('no .caption.txt sidecar — the dashboard will try to transcribe a silent reel');
    } else {
      const hard = lintVoiceDna(sidecar).violations.filter((v) => v.hard);
      if (hard.length > 0) {
        problems.push(`sidecar has ${hard.length} Voice-DNA violation(s): ${hard.slice(0, 3).map((v) => `"${v.match}"`).join(', ')}`);
      }
    }

    // 2. R2 object size == local size (truncated-upload tell).
    const localBytes = fs.statSync(local).size;
    const info = await videoInfo(p.videoUrl);
    if (info.status !== 200) {
      problems.push(`R2 video unreachable (HTTP ${info.status})`);
    } else if (info.length !== localBytes) {
      problems.push(`R2 object truncated: ${info.length} vs ${localBytes} local bytes — run fix-loop-reels to re-upload`);
    }

    // 3. Cover/poster.
    if (!p.coverImageUrl) problems.push('no coverImageUrl — card renders black in the queue');

    // 4 + 5. Silent-by-design + the tail actually decodes.
    const av = probeAudit(local);
    if (av.audibleContent) problems.push('has audible audio — loop/timelapse reels should be silent (music added in IG)');
    if (!av.playable) problems.push('tail does not decode — file may be corrupt/truncated locally');

    if (problems.length > 0) {
      failures.push(`${notes} (${p.status}): ${problems.join('; ')}.`);
    }
  }

  const header = failures.length === 0
    ? `✅ Loop-reel audit: all ${checked} queued story-loop reels healthy (sidecar, R2 size, cover, silent, playable).`
    : `⚠️ Loop-reel audit: ${failures.length}/${checked} reels need attention.`;
  const body = failures.length ? `\n\n${failures.map((f) => `• ${f}`).join('\n')}` : '';
  console.log(header + body);
  await sendTelegram(header + body);
  if (failures.length > 0) process.exit(1);
}

async function main() {
  if (AUDIT) return runAudit();
  // 2) Import the dashboard's own helpers now that env is populated.
  const { readQueue, writeQueue } = await import('../lib/queue');
  const { uploadFile } = await import('../lib/upload');
  const { resolveDraftFile, readCaptionSidecar } = await import('../lib/transcribe');

  const posts = await readQueue();
  let capFixed = 0;
  let vidFixed = 0;
  let posterFixed = 0;
  let skipped = 0;
  const rows: string[] = [];

  for (const p of posts) {
    const notes = p.notes;
    if (p.type !== 'reel' || !notes || !/^story-loop-/i.test(notes)) continue;

    const local = resolveDraftFile(notes);
    if (!local) { rows.push(`  skip  ${notes}  (no local file in Reels/Final)`); skipped++; continue; }

    const caption = readCaptionSidecar(local);
    if (!caption) { rows.push(`  skip  ${notes}  (no .caption.txt sidecar)`); skipped++; continue; }

    let note = p.caption === caption ? 'caption already set' : 'caption ← sidecar';
    if (p.caption !== caption) { p.caption = caption; capFixed++; }

    const localBytes = fs.statSync(local).size;
    const info = await videoInfo(p.videoUrl);
    // "Complete" means the R2 object is the full file — not just present. R2 has
    // stored truncated uploads that pass a status/size-floor check but won't play.
    const complete = info.status === 200 && info.length === localBytes;
    if (DIAGNOSE) {
      rows.push(`  ${notes}  status=${info.status} r2=${info.length} local=${localBytes} complete=${complete}  ${p.videoUrl ?? ''}`);
      continue;
    }
    let reuploaded = false;
    if (!complete) {
      if (DRY) {
        note += `, video WOULD re-upload (r2=${info.length}/${localBytes})`;
      } else {
        p.videoUrl = await uploadFile(local, notes);
        note += ', video re-uploaded (full)';
        reuploaded = true;
      }
      vidFixed++;
    } else {
      note += ', video ok';
    }

    // Poster/cover: without one the card renders black until the browser gets a
    // slot to preload the video (only ~6 load at once from the same host). The
    // reel's first frame already has the caption burned in, so it's a good cover.
    if (!p.coverImageUrl || reuploaded) {
      if (DRY) {
        note += ', poster WOULD be set';
      } else {
        const cover = `${path.basename(notes, '.mp4')}-cover.jpg`;
        const tmp = path.join(os.tmpdir(), cover);
        execSync(`ffmpeg -y -ss 0.1 -i "${local}" -frames:v 1 -vf scale=720:-1 -q:v 3 "${tmp}" 2>/dev/null`);
        p.coverImageUrl = await uploadFile(tmp, cover);
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        note += ', poster set';
      }
      posterFixed++;
    }
    rows.push(`  fix   ${notes}  (${note})`);
  }

  if (!DRY && !DIAGNOSE) await writeQueue(posts);

  console.log(rows.join('\n') || '  (no story-loop reels with sidecars found in the queue)');
  if (!DIAGNOSE) {
    console.log(
      `\n${DRY ? '[DRY RUN — nothing written] ' : ''}captions set: ${capFixed}, ` +
      `videos ${DRY ? 'to re-upload' : 're-uploaded'}: ${vidFixed}, ` +
      `posters ${DRY ? 'to set' : 'set'}: ${posterFixed}, skipped: ${skipped}`,
    );
  }
  if (!DRY && !DIAGNOSE) console.log('Refresh the dashboard to see the updated captions and previews.');
}

main().catch((e) => { console.error(e); process.exit(1); });
