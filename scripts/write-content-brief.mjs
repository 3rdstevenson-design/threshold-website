#!/usr/bin/env node
/**
 * write-content-brief.mjs
 *
 * Curls the dashboard's content-brief endpoint (markdown form) and
 * atomically writes ~/Code/Social Media/content-brief.md so the
 * content-writing skills can read fresh performance guidance before
 * drafting. Run by launchd (com.threshold.content-brief) every 6 hours;
 * safe to run by hand.
 *
 * Reads DASHBOARD_PASSWORD from the repo's .env.local. Exits nonzero on
 * any failure so launchd logs show the problem.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = path.join(os.homedir(), 'Code', 'Social Media', 'content-brief.md');
const PORTS = [3000, 3001, 3002, 3003, 3004];

function readDashboardPassword() {
  const envPath = path.join(repoRoot, '.env.local');
  const raw = fs.readFileSync(envPath, 'utf-8');
  const m = raw.match(/^DASHBOARD_PASSWORD=(.*)$/m);
  if (!m) throw new Error('DASHBOARD_PASSWORD not found in .env.local');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

async function fetchBrief(key) {
  let lastErr = null;
  for (const port of PORTS) {
    try {
      const res = await fetch(
        `http://localhost:${port}/api/dashboard/content-brief?format=md`,
        { headers: { 'x-dashboard-key': key }, signal: AbortSignal.timeout(60_000) },
      );
      if (res.ok) return await res.text();
      lastErr = new Error(`port ${port}: HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('no dashboard port responded');
}

const key = readDashboardPassword();
const md = await fetchBrief(key);
if (!md.includes('# Threshold Content Brief')) {
  throw new Error('response did not look like the content brief');
}
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
const tmp = `${OUT_PATH}.tmp`;
fs.writeFileSync(tmp, md);
fs.renameSync(tmp, OUT_PATH);
console.log(`Wrote ${OUT_PATH} (${md.length} chars)`);
