#!/usr/bin/env node
/**
 * watch-renders.js — Watches my-video-projects/out/ for new MP4 files
 * and auto-queues them to the Instagram queue with sensible defaults.
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
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VIDEO_OUT_DIR = path.resolve(ROOT, '../my-video-projects/out');
const POLL_INTERVAL_MS = 4000;

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

function writeQueueLocal(posts) {
  const dir = path.join(ROOT, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'queue.json'), JSON.stringify(posts, null, 2));
}

async function readQueue() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return readQueueLocal();
  try {
    const { head } = await import('@vercel/blob');
    const blob = await head('queue/queue.json');
    
    const res = await fetch(blob.url + '?t=' + Date.now(), { cache: 'no-store' });
    return res.ok ? await res.json() : [];
  } catch { return readQueueLocal(); }
}

async function writeQueue(posts) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) { writeQueueLocal(posts); return; }
  const { put } = await import('@vercel/blob');
  await put('queue/queue.json', JSON.stringify(posts, null, 2), {
    access: 'public', allowOverwrite: true, contentType: 'application/json', addRandomSuffix: false,
  });
}

async function uploadFile(filePath, filename) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN not set');
  const { put } = await import('@vercel/blob');
  const sizeMB = fs.statSync(filePath).size / 1024 / 1024;
  if (sizeMB > 500) console.warn(`⚠️  ${filename} is ${sizeMB.toFixed(0)}MB — Vercel Blob limit is 500MB`);
  const blob = await put(`instagram/${filename}`, fs.readFileSync(filePath), {
    access: 'public', contentType: 'video/mp4', addRandomSuffix: true,
  });
  return blob.url;
}

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

// ── Already-queued tracking (in-memory, resets on restart) ────────────────────

const queued = new Set();

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

async function autoQueue(filePath) {
  const filename = path.basename(filePath);
  const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);

  console.log(`\n🎬  New render detected: ${filename} (${sizeMB} MB)`);
  console.log('    Auto-queuing…');

  const pillar = detectPillar(filename);
  const existing = await readQueue();
  const scheduledTime = nextAvailableSlot(pillar, existing);

  console.log(`    Pillar: ${pillar}`);
  console.log(`    Scheduled: ${fmt(scheduledTime)}`);

  console.log('    Uploading to Vercel Blob…');
  const videoUrl = await uploadFile(filePath, filename);

  const post = {
    id: uuidv4(),
    status: 'pending',
    type: 'reel',
    pillar,
    caption: '✏️ Add caption before approving',
    videoUrl,
    scheduledTime: scheduledTime.toISOString(),
    createdAt: new Date().toISOString(),
    approvedAt: null,
    publishedAt: null,
    metaPublishId: null,
    notes: filename, // store filename so we can track it
  };

  const posts = await readQueue();
  posts.push(post);
  await writeQueue(posts);

  queued.add(filename);

  console.log(`    ✅ Queued! Edit caption at: http://localhost:3001/dashboard/queue`);
  console.log(`    Post ID: ${post.id}\n`);
}

// ── Watcher (polling) ─────────────────────────────────────────────────────────

let knownFiles = new Set();

function scanDir() {
  if (!fs.existsSync(VIDEO_OUT_DIR)) return;
  return fs.readdirSync(VIDEO_OUT_DIR)
    .filter((f) => f.endsWith('.mp4'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(VIDEO_OUT_DIR, f)).mtimeMs }));
}

async function poll() {
  const files = scanDir();
  if (!files) return;

  for (const { name, mtime } of files) {
    const fullPath = path.join(VIDEO_OUT_DIR, name);
    // New file = not in knownFiles set, or mtime changed significantly (re-render)
    const key = `${name}:${Math.floor(mtime / 1000)}`; // 1s precision
    if (!knownFiles.has(key) && !queued.has(name)) {
      knownFiles.add(key);
      // Small delay to ensure the file is fully written
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await autoQueue(fullPath);
      } catch (err) {
        console.error(`    ❌ Failed to queue ${name}:`, err.message);
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

  // Seed known files (don't auto-queue things already there)
  await initQueued();
  const existing = scanDir() || [];
  for (const { name, mtime } of existing) {
    knownFiles.add(`${name}:${Math.floor(mtime / 1000)}`);
    queued.add(name); // treat pre-existing files as already handled
  }

  console.log(`    Ignoring ${existing.length} existing file(s). Watching for new ones…\n`);

  setInterval(poll, POLL_INTERVAL_MS);
}

main().catch((err) => { console.error('❌', err.message); process.exit(1); });
