#!/usr/bin/env node
/**
 * watch-renders.js — Watches ~/Code/Social Media/Reels/Final/ for new
 * MP4 files and auto-queues them to the Instagram queue with sensible
 * defaults.
 *
 * Run from threshold-website:
 *   node scripts/watch-renders.js
 *
 * Or from my-video-projects:
 *   npm run watch
 *
 * Posts land in the dashboard as "pending" with a placeholder caption.
 * Edit the caption in the dashboard before approving.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VIDEO_OUT_DIR = path.join(os.homedir(), 'Code', 'Social Media', 'Reels', 'Final');
const POLL_INTERVAL_MS = 4000;
// The always-on dashboard is the SINGLE writer of the queue. watch-renders
// hands new reels to it instead of writing the queue itself (see autoQueue).
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';

// ── Helpers (same as other queue scripts) ──────────────────────────────────────

function loadEnv() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  }
}

function readQueueLocal() {
  const p = path.join(ROOT, 'data', 'queue.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return []; }
}

function useR2() {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME && process.env.R2_PUBLIC_URL);
}

function r2PublicUrl(key) {
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

async function getR2Client() {
  const { S3Client } = await import('@aws-sdk/client-s3');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

async function readQueue() {
  if (!useR2()) return readQueueLocal();
  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const r2 = await getR2Client();
    const res = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: 'queue/queue.json' }));
    const body = await res.Body?.transformToString();
    return body ? JSON.parse(body) : [];
  } catch (e) {
    if (e.name === 'NoSuchKey') return [];
    return readQueueLocal();
  }
}

// NOTE: watch-renders no longer writes the queue or uploads to R2 directly.
// The dashboard's /api/local-scan/upload endpoint owns all of that now, so
// there is exactly one writer of the queue (see autoQueue).

// ── Pillar auto-detection ──────────────────────────────────────────────────────

const PILLAR_KEYWORDS = {
  exercise:    ['exercise', 'movement', 'workout', 'reel', 'stretch', 'mobility', 'train', 'vertical', 'square', 'landscape'],
  clinic_case: ['case', 'clinic', 'patient', 'injury', 'pain', 'rehab'],
  philosophy:  ['philosophy', 'belief', 'mindset', 'spiral', 'framework', 'verbiage', 'dog'],
  story:       ['story', 'personal', 'journey', 'intro', 'baad'],
};

function detectPillar(filename) {
  const lower = filename.toLowerCase();
  for (const [pillar, keywords] of Object.entries(PILLAR_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) return pillar;
  }
  return 'exercise';
}

// ── Scheduling ─────────────────────────────────────────────────────────────────

const PILLAR_WINDOWS = {
  exercise:    { days: [2, 4, 6], slots: [{ h: 9, m: 0 }, { h: 18, m: 0 }] },
  clinic_case: { days: [1, 3],    slots: [{ h: 12, m: 0 }] },
  philosophy:  { days: [3, 5],    slots: [{ h: 7, m: 0 }] },
  story:       { days: [0, 5],    slots: [{ h: 11, m: 0 }, { h: 18, m: 0 }] },
};

function nextAvailableSlot(pillar, existing) {
  const windows = PILLAR_WINDOWS[pillar];
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() + 1); start.setHours(0, 0, 0, 0);
  const BUFFER = 2 * 60 * 60 * 1000;
  const hasConflict = (d) => existing.some((p) => {
    if (p.status === 'rejected' || p.status === 'published') return false;
    return Math.abs(d - new Date(p.scheduledTime)) < BUFFER;
  });
  for (let d = 0; d < 21; d++) {
    const day = new Date(start); day.setDate(start.getDate() + d);
    if (!windows.days.includes(day.getDay())) continue;
    for (const s of windows.slots) {
      const c = new Date(day); c.setHours(s.h, s.m, 0, 0);
      if (c > now && !hasConflict(c)) return c;
    }
  }
  // Fallback: tomorrow 9am
  const fallback = new Date(now); fallback.setDate(now.getDate() + 1); fallback.setHours(9, 0, 0, 0);
  return fallback;
}

function fmt(date) {
  return date.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: 'America/Chicago',
  });
}

// ── Already-handled tracking (persisted across restarts) ──────────────────────
//
// Two sets, both persisted to data/watch-renders-state.json:
//   queued     — filenames successfully handed to the dashboard
//   knownFiles — name:mtime keys seen on disk (mtime change = re-render = new)
// Persisting them is what lets a restart distinguish "file I already handled"
// from "file that landed while I was down". Before this, startup seeded EVERY
// pre-existing file as handled, so anything that arrived during downtime was
// silently never queued.

const STATE_PATH = path.join(ROOT, 'data', 'watch-renders-state.json');
const MAX_STATE_ENTRIES = 1000;
// Bumped when the scan filter widens. On 2026-07-26 it went from the
// case-sensitive `.endsWith('.mp4')` to /\.(mp4|mov)$/i, which made 26
// long-standing .MP4 files in Final/ visible for the first time. Those are
// years-old renders, not a backlog, so a version bump marks them handled once
// instead of flooding the queue on the first poll after the upgrade.
const FILTER_VERSION = 2;

const queued = new Set();

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    if (!Array.isArray(parsed?.known) || !Array.isArray(parsed?.queued)) return null;
    return parsed;
  } catch {
    return null; // no state file yet (first run) or unreadable
  }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const state = {
      filterVersion: FILTER_VERSION,
      known: [...knownFiles].slice(-MAX_STATE_ENTRIES),
      queued: [...queued].slice(-MAX_STATE_ENTRIES),
    };
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error(`    ⚠️  could not persist watcher state: ${err.message}`);
  }
}

async function initQueued() {
  const posts = await readQueue();
  // Track filenames that are already in the queue by checking blob URL basenames
  for (const p of posts) {
    if (p.videoUrl) {
      // Extract original filename hint from notes or url
      if (p.notes) queued.add(p.notes);
    }
  }
}

// ── Auto-queue a single file ───────────────────────────────────────────────────

// Hand the file to the always-on dashboard, which is the SINGLE writer of the
// queue. This removes the cross-process race where watch-renders and the
// dashboard both read-modify-wrote the shared queue.json and clobbered each
// other (e.g. wiping freshly-generated captions). The dashboard endpoint does
// the R2 upload, caption generation, pillar/scheduling, and the
// mutex-serialized queue write — and dedupes by filename, so re-sends are
// harmless no-ops.
async function autoQueue(filePath) {
  const filename = path.basename(filePath);
  const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);

  console.log(`\n🎬  New render detected: ${filename} (${sizeMB} MB)`);
  console.log(`    Handing off to the dashboard at ${DASHBOARD_URL}…`);

  const res = await fetch(`${DASHBOARD_URL}/api/local-scan/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'reel', filePath, name: filename }),
    // Caption generation (Whisper + Claude) runs server-side; give it room.
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`dashboard upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const post = await res.json();
  queued.add(filename);
  saveState();

  console.log(`    ✅ Queued via dashboard. Edit caption at: ${DASHBOARD_URL}/dashboard/queue`);
  console.log(`    Post ID: ${post.id}\n`);
}

// ── Watcher (polling) ─────────────────────────────────────────────────────────

let knownFiles = new Set();
// filename -> size at the previous poll. A file whose size is still moving is
// mid-write, and queueing it uploads a truncated object to R2.
const lastSize = new Map();
// filename -> { count, nextAttempt }. Bounds retries for uploads that keep
// failing so one bad file can't spin the watcher.
const failures = new Map();
const MAX_QUEUE_ATTEMPTS = 5;
const QUEUE_RETRY_BASE_MS = 30_000;

function scanDir() {
  if (!fs.existsSync(VIDEO_OUT_DIR)) return;
  return fs.readdirSync(VIDEO_OUT_DIR)
    // Match the dashboard scanner (lib/localScan.ts:33) exactly. The old
    // case-sensitive `.endsWith('.mp4')` skipped every .MP4 and .mov in the
    // folder, so those never auto-queued and only appeared on a manual rescan.
    .filter((f) => /\.(mp4|mov)$/i.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(VIDEO_OUT_DIR, f));
      return { name: f, mtime: st.mtimeMs, size: st.size };
    });
}

async function poll() {
  const files = scanDir();
  if (!files) return;

  // Drop bookkeeping for files that have left the folder (rejected, moved).
  const present = new Set(files.map((f) => f.name));
  for (const n of [...lastSize.keys()]) if (!present.has(n)) lastSize.delete(n);
  for (const n of [...failures.keys()]) if (!present.has(n)) failures.delete(n);

  for (const { name, mtime, size } of files) {
    const fullPath = path.join(VIDEO_OUT_DIR, name);

    // Still serving a backoff from a previous failed upload.
    const failure = failures.get(name);
    if (failure && Date.now() < failure.nextAttempt) continue;

    // Settle gate: the size must hold steady across two consecutive polls
    // before we touch the file. A render that writes in place grows while the
    // watcher is looking at it, and each poll used to fire a fresh upload —
    // that is what produced 34 truncated duplicate posts on 2026-07-26 (one
    // per poll, at 786KB, 2MB, 3.4MB … up to the real size). render-loop-reel
    // now renames atomically into Final/, but this covers every other writer.
    const previousSize = lastSize.get(name);
    lastSize.set(name, size);
    if (size === 0 || previousSize !== size) continue;

    // New file = not in knownFiles set, or mtime changed significantly (re-render)
    const key = `${name}:${Math.floor(mtime / 1000)}`; // 1s precision
    // Re-render of an already-handled name (fresh mtime key): hand it to the
    // dashboard again — the upload endpoint dedupes on name+size, so an
    // unchanged file is a no-op while genuinely new content gets a new post.
    if (!knownFiles.has(key) && queued.has(name)) queued.delete(name);
    if (!knownFiles.has(key) && !queued.has(name)) {
      knownFiles.add(key);
      // Small delay to ensure the file is fully written
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await autoQueue(fullPath);
        failures.delete(name);
      } catch (err) {
        // Retry with backoff, then give up. Deleting the key unconditionally
        // meant a permanently-failing upload (e.g. the caption API returning
        // 500) re-fired every poll forever: on 2026-07-26 that produced a
        // 16MB log and a runaway ffmpeg/Deepgram spawn loop off ONE file.
        const n = (failures.get(name)?.count ?? 0) + 1;
        if (n >= MAX_QUEUE_ATTEMPTS) {
          console.error(
            `    ❌ Giving up on ${name} after ${n} attempts: ${err.message}\n` +
            `       Fix the cause, then touch the file to retry.`,
          );
          failures.set(name, { count: n, nextAttempt: Infinity });
        } else {
          const delayMs = QUEUE_RETRY_BASE_MS * 2 ** (n - 1);
          console.error(
            `    ❌ Failed to queue ${name} (attempt ${n}/${MAX_QUEUE_ATTEMPTS}): ${err.message}\n` +
            `       Retrying in ${Math.round(delayMs / 1000)}s.`,
          );
          failures.set(name, { count: n, nextAttempt: Date.now() + delayMs });
          knownFiles.delete(key);
        }
      }
    } else {
      knownFiles.add(key);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();

  if (!fs.existsSync(VIDEO_OUT_DIR)) {
    console.error(`❌  Watch directory not found: ${VIDEO_OUT_DIR}`);
    process.exit(1);
  }

  console.log(`\n👁️   Watching for new renders in:`);
  console.log(`    ${VIDEO_OUT_DIR}`);
  console.log(`    Polling every ${POLL_INTERVAL_MS / 1000}s — Ctrl+C to stop\n`);

  // Seed handled files. Restarts load the persisted state, so a file that
  // landed while the watcher was DOWN is not in it and gets queued by the
  // first poll. Only the very first run (no state file yet) falls back to
  // treating everything already on disk as handled — otherwise years of old,
  // long-deleted-from-queue renders would flood in.
  await initQueued();
  const state = loadState();
  if (state) {
    for (const k of state.known) knownFiles.add(k);
    for (const n of state.queued) queued.add(n);

    // Files the previous filter could never see are pre-existing, not new.
    if ((state.filterVersion ?? 1) < FILTER_VERSION) {
      let migrated = 0;
      for (const { name, mtime } of scanDir() || []) {
        if (/\.mp4$/.test(name)) continue; // the old filter already covered these
        if (queued.has(name)) continue;
        knownFiles.add(`${name}:${Math.floor(mtime / 1000)}`);
        queued.add(name);
        migrated++;
      }
      saveState();
      console.log(`    Filter upgrade: marked ${migrated} pre-existing non-.mp4 file(s) as handled.`);
    }

    const existing = scanDir() || [];
    const backlog = existing.filter(
      ({ name, mtime }) => !knownFiles.has(`${name}:${Math.floor(mtime / 1000)}`) && !queued.has(name),
    );
    console.log(
      `    Restored state (${queued.size} handled). ` +
        `${backlog.length} file(s) arrived while down — queueing on first poll…\n`,
    );
  } else {
    const existing = scanDir() || [];
    for (const { name, mtime } of existing) {
      knownFiles.add(`${name}:${Math.floor(mtime / 1000)}`);
      queued.add(name); // first run ever: treat pre-existing files as already handled
    }
    saveState();
    console.log(`    First run: ignoring ${existing.length} existing file(s). Watching for new ones…\n`);
  }

  setInterval(poll, POLL_INTERVAL_MS);
}

main().catch((err) => { console.error('❌', err.message); process.exit(1); });
