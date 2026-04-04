#!/usr/bin/env node
/**
 * queue-carousel.js — Interactive CLI to queue a carousel for Instagram.
 * Includes an edit loop: review slides → make edits → regenerate → repeat until ready.
 *
 * Usage:
 *   node scripts/queue-carousel.js
 *   node scripts/queue-carousel.js --slides s1.png,s2.png --pillar exercise
 *
 * Designed to be called from threshold-carousel/generate.sh after slide generation.
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CAROUSEL_DIR = path.resolve(ROOT, '../threshold-carousel');
const CAROUSEL_OUTPUT = path.join(CAROUSEL_DIR, 'output');

// ── Shared helpers ─────────────────────────────────────────────────────────────

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
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: 'queue/queue.json' });
    if (blobs.length === 0) return [];
    const res = await fetch(blobs[0].url + '?t=' + Date.now());
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

async function uploadFiles(filePaths) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN not set');
  const { put } = await import('@vercel/blob');
  return Promise.all(filePaths.map(async (filePath) => {
    const filename = path.basename(filePath);
    const blob = await put(`instagram/${filename}`, fs.readFileSync(filePath), {
      access: 'public', contentType: 'image/png', addRandomSuffix: true,
    });
    return blob.url;
  }));
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

// ── Slide detection ────────────────────────────────────────────────────────────

function findLatestSlides() {
  if (!fs.existsSync(CAROUSEL_OUTPUT)) return [];
  const pngs = fs.readdirSync(CAROUSEL_OUTPUT)
    .filter((f) => f.endsWith('.png'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(CAROUSEL_OUTPUT, f)).mtimeMs }))
    .sort((a, b) => a.name.localeCompare(b.name)); // alphabetical = slide order
  return pngs.map((f) => path.join(CAROUSEL_OUTPUT, f.name));
}

function openSlidesInPreview(slides) {
  try {
    execSync(`open ${slides.map((s) => `"${s}"`).join(' ')}`);
  } catch {
    console.log('   (Could not open slides automatically — check output/ directory)');
  }
}

// ── CLI helpers ────────────────────────────────────────────────────────────────

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

const args = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

// ── Edit loop ──────────────────────────────────────────────────────────────────

async function runEditLoop(slides) {
  while (true) {
    openSlidesInPreview(slides);
    console.log(`\n   ${slides.length} slides open in Preview.`);
    console.log('─'.repeat(50));
    const action = await ask('Ready to schedule? (y = yes / e = make edits / n = cancel): ');
    const a = action.trim().toLowerCase();

    if (a === 'n') {
      console.log('\n   Cancelled — nothing queued.\n');
      rl.close();
      process.exit(0);
    }

    if (a === 'y') {
      return slides; // proceed to scheduling
    }

    if (a === 'e') {
      // Ask what to change
      const changeDesc = await ask('\nWhat would you like to change? ');
      const editFile = '/tmp/carousel-edit.txt';
      fs.writeFileSync(editFile, changeDesc.trim());
      console.log(`\n   Edit note saved to ${editFile}`);

      // Open slide-templates.sh in $EDITOR or nano
      const editor = process.env.EDITOR || 'nano';
      const templateFile = path.join(CAROUSEL_DIR, 'slide-templates.sh');
      if (fs.existsSync(templateFile)) {
        console.log(`\n   Opening ${path.basename(templateFile)} in ${editor}…`);
        console.log('   Save and close the editor when done.\n');
        spawnSync(editor, [templateFile], { stdio: 'inherit' });
      } else {
        console.log(`\n   ⚠️  slide-templates.sh not found at ${templateFile}`);
        console.log('   Make your edits manually, then continue.\n');
      }

      // Offer to regenerate
      const regen = await ask('Re-generate slides now? (y/n): ');
      if (regen.trim().toLowerCase() === 'y') {
        const generateScript = path.join(CAROUSEL_DIR, 'generate.sh');
        if (fs.existsSync(generateScript)) {
          console.log('\n   Running generate.sh… (this may take a minute)\n');
          try {
            execSync(`cd "${CAROUSEL_DIR}" && bash generate.sh --no-queue`, {
              stdio: 'inherit',
              env: { ...process.env },
            });
            // Refresh slide list after regen
            slides = findLatestSlides();
            console.log(`\n   ✓ Regenerated ${slides.length} slides.`);
          } catch (err) {
            console.error('\n   ❌  generate.sh failed:', err.message);
          }
        } else {
          console.log('   ⚠️  generate.sh not found — skipping regeneration.');
        }
      }
      // Loop again to re-review
    } else {
      console.log('   Please enter y, e, or n.');
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();
  console.log('\n🎠  Instagram Carousel Queue\n');

  // Resolve slides
  let slides;
  const slidesArg = getArg('--slides');
  if (slidesArg) {
    slides = slidesArg.split(',').map((s) => path.resolve(s.trim()));
  } else {
    slides = findLatestSlides();
    if (slides.length === 0) {
      console.error(`❌  No slides found in ${CAROUSEL_OUTPUT}`);
      console.error('   Run ./generate.sh first, or pass --slides s1.png,s2.png');
      process.exit(1);
    }
    console.log(`   Found ${slides.length} slides in output/`);
  }

  // Validate all files exist
  for (const s of slides) {
    if (!fs.existsSync(s)) {
      console.error(`❌  Slide not found: ${s}`); process.exit(1);
    }
  }

  // Edit loop — returns final slides when user says "y"
  slides = await runEditLoop(slides);

  // Pillar
  const PILLARS = ['exercise', 'clinic_case', 'philosophy', 'story'];
  let pillar = getArg('--pillar');
  if (!pillar || !PILLARS.includes(pillar)) {
    console.log('\nContent pillar (carousels default to exercise):');
    PILLARS.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    const pick = await ask('Pick pillar [1-4, Enter for exercise]: ');
    pillar = pick.trim() === '' ? 'exercise' : (PILLARS[parseInt(pick.trim()) - 1] || 'exercise');
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

  // Upload all slides
  console.log(`\n⬆️   Uploading ${slides.length} slides…`);
  const imageUrls = await uploadFiles(slides);
  console.log(`   Uploaded ${imageUrls.length} slides.`);

  // Write queue entry
  const notes = getArg('--notes') || undefined;
  const post = {
    id: uuidv4(),
    status: 'pending',
    type: 'carousel',
    pillar,
    caption,
    imageUrls,
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
  console.log(`   ${slides.length} slides | Scheduled: ${fmt(new Date(scheduledTime))}`);
  console.log(`   Review at: https://dashboard.thresholdhp.com/dashboard/queue\n`);
  rl.close();
}

main().catch((err) => { console.error('❌', err.message); process.exit(1); });
