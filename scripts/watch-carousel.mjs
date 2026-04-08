#!/usr/bin/env node
/**
 * watch-carousel.mjs — Watches threshold-carousel/output/ for new carousel subfolders
 * and auto-queues each one as a separate Instagram carousel post.
 *
 * GROUPING: Each subfolder = one carousel. Multiple carousels can coexist in output/.
 *
 * Expected structure:
 *   output/
 *     my-carousel-name/        ← any subfolder name works
 *       slide-01.png
 *       slide-02.png
 *       ...slide-NN.png
 *       caption.txt            ← optional, pre-fills caption in dashboard
 *
 * The watcher:
 *   - Polls every 2 seconds for new subfolders
 *   - Waits 8 seconds of no new/changed files inside a subfolder before queuing it
 *   - Skips the "temp" subfolder (used by generate.sh)
 *   - Never re-queues a subfolder it has already processed
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CAROUSEL_DIR = path.resolve(ROOT, '../threshold-carousel');
const OUTPUT_DIR = path.join(CAROUSEL_DIR, 'output');
const POLL_MS = 2000;
const SETTLE_MS = 8000; // wait 8s of inactivity inside a subfolder before queuing

// ── Helpers ────────────────────────────────────────────────────────────────────

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
  if (!useR2()) return [];
  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const r2 = await getR2Client();
    const res = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: 'queue/queue.json' }));
    const body = await res.Body?.transformToString();
    return body ? JSON.parse(body) : [];
  } catch (e) {
    if (e.name === 'NoSuchKey') return [];
    return [];
  }
}

async function writeQueue(posts) {
  if (!useR2()) return;
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const r2 = await getR2Client();
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: 'queue/queue.json',
    Body: JSON.stringify(posts, null, 2),
    ContentType: 'application/json',
  }));
}

async function uploadFiles(filePaths, folderName) {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const r2 = await getR2Client();
  return Promise.all(filePaths.map(async (filePath) => {
    const filename = path.basename(filePath);
    const key = `instagram/${Date.now()}-${folderName}-${filename}`;
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: fs.readFileSync(filePath),
      ContentType: 'image/png',
    }));
    return r2PublicUrl(key);
  }));
}

const PILLAR_WINDOWS = {
  exercise:    { days: [2,4,6], slots: [{h:9,m:0},{h:18,m:0}] },
  clinic_case: { days: [1,3],   slots: [{h:12,m:0}] },
  philosophy:  { days: [3,5],   slots: [{h:7,m:0}] },
  story:       { days: [0,5],   slots: [{h:11,m:0},{h:18,m:0}] },
};

function nextSlot(pillar, existing) {
  const w = PILLAR_WINDOWS[pillar];
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate()+1); start.setHours(0,0,0,0);
  const BUF = 2*60*60*1000;
  const conflict = d => existing.some(p => {
    if (p.status==='rejected'||p.status==='published') return false;
    return Math.abs(d-new Date(p.scheduledTime)) < BUF;
  });
  for (let d=0;d<21;d++) {
    const day=new Date(start); day.setDate(start.getDate()+d);
    if (!w.days.includes(day.getDay())) continue;
    for (const s of w.slots) {
      const c=new Date(day); c.setHours(s.h,s.m,0,0);
      if (c>now && !conflict(c)) return c;
    }
  }
  const fb=new Date(now); fb.setDate(now.getDate()+1); fb.setHours(9,0,0,0); return fb;
}

function fmt(date) {
  return date.toLocaleString('en-US', {
    weekday:'short', month:'short', day:'numeric',
    hour:'numeric', minute:'2-digit', timeZoneName:'short', timeZone:'America/Chicago',
  });
}

// ── Subfolder scanning ─────────────────────────────────────────────────────────

const IGNORED_DIRS = new Set(['temp']);

function getCarouselFolders() {
  if (!fs.existsSync(OUTPUT_DIR)) return [];
  return fs.readdirSync(OUTPUT_DIR)
    .filter(name => {
      if (IGNORED_DIRS.has(name)) return false;
      return fs.statSync(path.join(OUTPUT_DIR, name)).isDirectory();
    });
}

function getSlidesInFolder(folderPath) {
  return fs.readdirSync(folderPath)
    .filter(f => /^slide-\d+\.png$/.test(f)) // slide-01.png ... not -raw.png
    .sort() // alphabetical = slide order
    .map(f => path.join(folderPath, f));
}

function getFolderSnapshot(folderPath) {
  // Returns a string representing the current state of slides in this folder
  const slides = getSlidesInFolder(folderPath);
  return slides.map(f => `${path.basename(f)}:${Math.floor(fs.statSync(f).mtimeMs/1000)}`).join('|');
}

function readCaption(folderPath) {
  const captionPath = path.join(folderPath, 'caption.txt');
  if (!fs.existsSync(captionPath)) return '✏️ Add caption before approving';
  const text = fs.readFileSync(captionPath, 'utf-8').trim();
  return text || '✏️ Add caption before approving';
}

// ── Per-folder state ───────────────────────────────────────────────────────────

// folderName → { snapshot, timer, queued }
const folderState = {};

async function queueCarousel(folderName) {
  const folderPath = path.join(OUTPUT_DIR, folderName);
  const slides = getSlidesInFolder(folderPath);

  if (slides.length === 0) {
    console.log(`    ⚠️  No slides found in ${folderName}/ — skipping`);
    return;
  }

  console.log(`\n🎠  Queuing carousel: "${folderName}" (${slides.length} slides)`);
  slides.forEach(s => console.log(`    ${path.basename(s)}`));

  const caption = readCaption(folderPath);
  if (caption.startsWith('✏️')) {
    console.log('    ⚠️  No caption.txt — add caption in dashboard before approving');
  } else {
    console.log(`    Caption: ${caption.slice(0,60)}${caption.length>60?'…':''}`);
  }

  console.log('    Uploading slides…');
  let imageUrls;
  try {
    imageUrls = await uploadFiles(slides, folderName);
  } catch (err) {
    console.error(`    ❌ Upload failed: ${err.message}`);
    folderState[folderName].queued = false; // allow retry
    return;
  }
  console.log(`    ✓ ${imageUrls.length} slides uploaded`);

  const existing = await readQueue();
  const pillar = 'exercise';
  const scheduledTime = nextSlot(pillar, existing);

  const post = {
    id: uuidv4(),
    status: 'pending',
    type: 'carousel',
    pillar,
    caption,
    imageUrls,
    scheduledTime: scheduledTime.toISOString(),
    createdAt: new Date().toISOString(),
    approvedAt: null, publishedAt: null, metaPublishId: null,
    notes: folderName,
  };

  existing.push(post);
  await writeQueue(existing);

  console.log(`    ✅ Queued! Scheduled: ${fmt(scheduledTime)}`);
  console.log(`    Review at: http://localhost:3001/dashboard/queue\n`);
}

// ── Polling ────────────────────────────────────────────────────────────────────

function poll() {
  const folders = getCarouselFolders();

  for (const folderName of folders) {
    const folderPath = path.join(OUTPUT_DIR, folderName);
    const state = folderState[folderName] ??= { snapshot: null, timer: null, queued: false };

    if (state.queued) continue; // already processed

    const snapshot = getFolderSnapshot(folderPath);
    if (snapshot === '') continue; // no slides yet — ignore empty folder

    if (snapshot !== state.snapshot) {
      // Slides changed — reset settle timer
      state.snapshot = snapshot;
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        state.queued = true;
        state.timer = null;
        queueCarousel(folderName).catch(err => {
          console.error(`❌ Error queuing ${folderName}:`, err.message);
          state.queued = false; // allow retry on error
        });
      }, SETTLE_MS);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('❌  BLOB_READ_WRITE_TOKEN not set in .env.local');
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    console.error(`❌  Output directory not found: ${OUTPUT_DIR}`);
    process.exit(1);
  }

  // Seed existing folders as already-queued so we don't re-process on restart
  const existing = getCarouselFolders();
  for (const folderName of existing) {
    const snapshot = getFolderSnapshot(path.join(OUTPUT_DIR, folderName));
    folderState[folderName] = { snapshot, timer: null, queued: true };
  }

  console.log(`\n🎠  Carousel Watcher started`);
  console.log(`    Watching: ${OUTPUT_DIR}`);
  if (existing.length > 0) {
    console.log(`    Ignoring ${existing.length} existing folder(s): ${existing.join(', ')}`);
  }
  console.log(`    Drop a new subfolder with slides to auto-queue it.\n`);

  setInterval(poll, POLL_MS);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
