#!/usr/bin/env node
/**
 * watch-drafts.mjs — Watches ~/Social Media/Reels/Drafts/ for new MP4 files
 * and AirDrops each one to your iPhone automatically.
 *
 * Setup (one-time):
 *   1. Open Shortcuts app on your Mac
 *   2. Create a new Shortcut named "AirDrop to iPhone"
 *   3. Add action: "Receive" (accepts Files as input from Nowhere or Other Apps)
 *   4. Add action: "Share" → choose AirDrop → pick your iPhone from recents
 *   5. Save the Shortcut
 *
 *   Then run: node scripts/watch-drafts.mjs
 *
 * If you haven't set up the Shortcut, the script will still show a desktop
 * notification and reveal the file in Finder so you can AirDrop manually.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawn } from 'child_process';

// Must match lib/editor/paths.ts DRAFTS_DIR — the ~/Code/Social Media tree.
const DRAFTS_DIR = path.join(os.homedir(), 'Code', 'Social Media', 'Reels', 'Drafts');
const POLL_MS = 2000;
const SETTLE_MS = 5000; // wait 5s of file stability before acting

// Track files we've already seen
const fileState = {}; // filename → { size, timer, done }

function notify(title, message) {
  const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`;
  try {
    execSync(`osascript -e '${script}'`, { stdio: 'ignore' });
  } catch {}
}

function revealInFinder(filePath) {
  try {
    execSync(`open -R "${filePath}"`, { stdio: 'ignore' });
  } catch {}
}

function tryAirDrop(filePath) {
  const filename = path.basename(filePath);

  // Try shortcuts CLI first
  try {
    execSync(`shortcuts run "AirDrop to iPhone" --input-path "${filePath}"`, {
      stdio: 'ignore',
      timeout: 10000,
    });
    console.log(`    ✓ AirDrop initiated via Shortcuts`);
    return;
  } catch {
    // Shortcut not set up — fall back to Finder reveal + notification
  }

  revealInFinder(filePath);
  notify(
    'New Draft Ready',
    `${filename} — file revealed in Finder. AirDrop manually or set up the Shortcut.`
  );
  console.log(`    ℹ️  Shortcuts not configured — file revealed in Finder`);
  console.log(`       Set up "AirDrop to iPhone" shortcut for fully automatic AirDrop`);
}

function poll() {
  if (!fs.existsSync(DRAFTS_DIR)) return;

  const files = fs.readdirSync(DRAFTS_DIR).filter(f => f.endsWith('.mp4'));

  for (const filename of files) {
    const filePath = path.join(DRAFTS_DIR, filename);
    const stat = fs.statSync(filePath);
    const size = stat.size;

    const state = fileState[filename] ??= { size: -1, timer: null, done: false };

    if (state.done) continue;

    if (size !== state.size) {
      // File still changing (being written)
      state.size = size;
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        state.done = true;
        state.timer = null;
        console.log(`\n📱 New draft ready: "${filename}"`);
        tryAirDrop(filePath);
      }, SETTLE_MS);
    }
  }
}

// Seed existing files so we don't AirDrop on startup
if (fs.existsSync(DRAFTS_DIR)) {
  for (const f of fs.readdirSync(DRAFTS_DIR).filter(f => f.endsWith('.mp4'))) {
    const filePath = path.join(DRAFTS_DIR, f);
    fileState[f] = { size: fs.statSync(filePath).size, timer: null, done: true };
  }
}

console.log(`\n📱 Drafts Watcher started`);
console.log(`   Watching: ${DRAFTS_DIR}`);
console.log(`   Renders will be AirDropped to your iPhone automatically.\n`);

setInterval(poll, POLL_MS);
