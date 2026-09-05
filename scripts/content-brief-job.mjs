#!/usr/bin/env node
/**
 * content-brief-job.mjs — the 6-hourly local analytics job
 * (launchd com.threshold.content-brief). Two steps:
 *
 *   1. backfill-video-durations.mjs — fill videoDurationMs (and derive
 *      completionRate) for any reel missing it, from the local rendered
 *      videos. Must run locally; the Vercel cron can't ffprobe.
 *   2. write-content-brief.mjs — refresh ~/Code/Social Media/content-brief.md
 *      from the dashboard endpoint for the content-writing skills.
 *
 * Step 1 failing must not block step 2.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const backfill = spawnSync('npx', ['tsx', path.join(here, 'backfill-video-durations.mjs')], {
  stdio: 'inherit',
  cwd: path.resolve(here, '..'),
});
if (backfill.status !== 0) {
  console.warn('Duration backfill failed; continuing to brief write.');
}

const brief = spawnSync(process.execPath, [path.join(here, 'write-content-brief.mjs')], {
  stdio: 'inherit',
  cwd: path.resolve(here, '..'),
});
process.exit(brief.status ?? 1);
