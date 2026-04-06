#!/usr/bin/env node
/**
 * queue-image.js — Interactive CLI to queue a single image for Instagram.
 *
 * Usage:
 *   node scripts/queue-image.js
 *   node scripts/queue-image.js --imagePath /path/to/photo.jpg --pillar story
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Inline helpers (avoid TS compilation in scripts) ──────────────────────────

function loadEnv() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join('=').trim();
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
  const ext = path.extname(filename).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
  const blob = await put(`instagram/${filename}`, fs.readFileSync(filePath), {
    access: 'public', contentType, addRandomSuffix: true,
  });
  return blob.url;
}

const PILLAR_WINDOWS = {
  exercise: { days: [2, 4, 6], slots: [{ h: 9, m: 0 }, { h: 18, m: 0 }] },
  clinic_case: { days: [1, 3], slots: [{ h: 12, m: 0 }] },
  philosophy: { days: [3, 5], slots: [{ h: 7, m: 0 }] },
  story: { days: [0, 5], slots: [{ h: 11, m: 0 }, { h: 18, m: 0 }] },
};

function suggestTimes(pillar, existing) {
  const windows = PILLAR_WINDOWS[pillar];
  const suggestions = [];
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() + 1); start.setHours(0, 0, 0, 0);
  const BUFFER = 2 * 60 * 60 * 1000;
  const hasConflict = (d) => existing.some((p) => {
    if (p.status === 'rejected' || p.status === 'published') return false;
    return Math.abs(d - new Date(p.scheduledTime)) < BUFFER;
  });
  for (let d = 0; d < 21 && suggestions.length < 3; d++) {
    const day = new Date(start); day.setDate(start.getDate() + d);
    if (!windows.days.includes(day.getDay())) continue;
    for (const s of windows.slots) {
      if (suggestions.length >= 3) break;
      const c = new Date(day); c.setHours(s.h, s.m, 0, 0);
      if (c <= now || hasConflict(c)) continue;
      suggestions.push(c);
    }
  }
  if (suggestions.length === 0) {
    for (let d = 1; suggestions.length < 3; d += 2) {
      const f = new Date(now); f.setDate(now.getDate() + d); f.setHours(9, 0, 0, 0);
      if (!hasConflict(f)) suggestions.push(f);
    }
  }
  return suggestions;
}

function fmt(date) {
  return date.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: 'America/Chicago',
  });
}

// ── CLI helpers ───────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function askMultiline(prompt) {
  console.log(prompt + ' (press Enter twice to finish):');
  return new Promise((resolve) => {
    const lines = [];
    rl.on('line', function handler(line) {
      if (line === '' && lines.length > 0 && lines[lines.length - 1] === '') {
        rl.removeListener('line', handler);
        resolve(lines.slice(0, -1).join('\n').trim());
      } else {
        lines.push(line);
      }
    });
  });
}

// ── Parse args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();
  console.log('\n📸  Instagram Image Queue\n');

  // Image path
  let imagePath = getArg('--imagePath');
  if (!imagePath) {
    imagePath = await ask('Image path (PNG or JPG): ');
  }
  imagePath = path.resolve(imagePath.trim());
  if (!fs.existsSync(imagePath)) {
    console.error(`❌  File not found: ${imagePath}`); process.exit(1);
  }
  const stat = fs.statSync(imagePath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
  console.log(`   Found: ${path.basename(imagePath)} (${sizeMB} MB)`);

  // Pillar
  const PILLARS = ['exercise', 'clinic_case', 'philosophy', 'story'];
  let pillar = getArg('--pillar');
  if (!pillar || !PILLARS.includes(pillar)) {
    console.log('\nContent pillar:');
    PILLARS.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    const pick = await ask('Pick pillar [1-4]: ');
    pillar = PILLARS[parseInt(pick.trim()) - 1] || 'story';
  }

  // Caption
  const caption = await askMultiline('\nCaption');
  if (!caption) { console.error('❌  Caption is required.'); process.exit(1); }

  // Schedule suggestions
  const existing = await readQueue();
  const suggestions = suggestTimes(pillar, existing);
  console.log('\nSuggested posting times:');
  suggestions.forEach((d, i) => console.log(`  ${i + 1}. ${fmt(d)}`));
  console.log('  4. Enter custom time (ISO format)');
  const timePick = await ask('Pick time [1-4]: ');
  let scheduledTime;
  if (timePick.trim() === '4') {
    const custom = await ask('Custom time (e.g. 2026-04-10T09:00:00-05:00): ');
    scheduledTime = new Date(custom.trim()).toISOString();
  } else {
    const idx = parseInt(timePick.trim()) - 1;
    scheduledTime = (suggestions[idx] || suggestions[0]).toISOString();
  }

  // Upload
  const notes = getArg('--notes') || undefined;
  console.log('\n⬆️   Uploading image…');
  const imageUrl = await uploadFile(imagePath, path.basename(imagePath));

  // Write queue entry
  const post = {
    id: uuidv4(),
    status: 'pending',
    type: 'image',
    pillar,
    caption,
    imageUrl,
    scheduledTime,
    createdAt: new Date().toISOString(),
    approvedAt: null,
    publishedAt: null,
    metaPublishId: null,
    ...(notes ? { notes } : {}),
  };
  const posts = await readQueue();
  posts.push(post);
  await writeQueue(posts);

  console.log(`\n✅  Queued! Post ID: ${post.id}`);
  console.log(`   Scheduled: ${fmt(new Date(scheduledTime))}`);
  console.log(`   Review at: https://dashboard.thresholdhp.com/dashboard/queue\n`);
  rl.close();
}

main().catch((err) => { console.error('❌', err.message); process.exit(1); });
