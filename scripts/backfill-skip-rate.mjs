#!/usr/bin/env node
/**
 * backfill-skip-rate.mjs — one-time fixer.
 *
 * `reels_skip_rate` (percent of viewers who scrolled away) was added to
 * the sync on 2026-07-22 as the stand-in for Instagram's per-second
 * retention curve, which is mobile-app only — see docs/ig-insights-api.md.
 *
 * The nightly sync only walks the 25 most recent media, so reels older
 * than that window never pick the metric up. This script fetches
 * reels_skip_rate for every REELS row in the store that lacks one and
 * writes them back through the dashboard-owned storage (R2 when
 * configured). Idempotent; run again any time.
 *
 * Usage: node scripts/backfill-skip-rate.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env.local (the script runs outside Next's env loader).
for (const line of fs.readFileSync(path.join(repoRoot, '.env.local'), 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

// Talk to R2 directly rather than importing lib/analyticsStore.ts — Node's
// TS stripping can't resolve that module's extensionless relative imports
// (the same reason the other backfill-*.mjs scripts don't run standalone).
const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');

const R2_KEY = 'analytics/performance.json';
const LOCAL_PATH = path.join(repoRoot, 'data', 'analytics.json');

const useR2 = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET_NAME
);

const r2 = useR2
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

async function readStore() {
  if (!r2) return JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf-8'));
  const res = await r2.send(
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: R2_KEY }),
  );
  return JSON.parse(await res.Body.transformToString());
}

async function saveStore(store) {
  const body = JSON.stringify(store, null, 2);
  if (!r2) {
    fs.writeFileSync(LOCAL_PATH, body);
    return;
  }
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: R2_KEY,
      Body: body,
      ContentType: 'application/json',
    }),
  );
}

const DRY = process.argv.includes('--dry');
const token = process.env.META_ACCESS_TOKEN;
if (!token) throw new Error('META_ACCESS_TOKEN not set');

console.log(`store: ${useR2 ? `R2 ${process.env.R2_BUCKET_NAME}/${R2_KEY}` : LOCAL_PATH}`);
const store = await readStore();
const targets = store.posts.filter(
  (p) => p.mediaType === 'REELS' && typeof p.skipRate !== 'number',
);

console.log(
  `${store.posts.filter((p) => p.mediaType === 'REELS').length} reels in store, ` +
    `${targets.length} missing skipRate${DRY ? ' (dry run)' : ''}`,
);

let filled = 0;
const unavailable = [];

for (const post of targets) {
  const url = new URL(`https://graph.facebook.com/v22.0/${post.mediaId}/insights`);
  url.searchParams.set('metric', 'reels_skip_rate');
  url.searchParams.set('access_token', token);

  let json;
  try {
    const res = await fetch(url.toString());
    json = await res.json();
  } catch (err) {
    unavailable.push([post.mediaId, `fetch failed: ${err.message}`]);
    continue;
  }

  if (json.error) {
    unavailable.push([post.mediaId, json.error.message.slice(0, 90)]);
    continue;
  }

  const value = json.data?.[0]?.values?.[0]?.value;
  if (typeof value !== 'number') {
    unavailable.push([post.mediaId, 'no value returned']);
    continue;
  }

  const hook = (post.caption ?? '').split('\n')[0].trim().slice(0, 44);
  console.log(`  ${post.timestamp.slice(0, 10)}  skip=${String(value).padStart(5)}%  ${hook}`);
  if (!DRY) post.skipRate = value;
  filled++;
}

if (unavailable.length) {
  console.log(`\n${unavailable.length} unavailable:`);
  for (const [id, why] of unavailable) console.log(`  ${id}: ${why}`);
}

if (!DRY && filled > 0) {
  await saveStore(store);
  console.log(`\nWrote ${filled} skipRate values to the store.`);
} else {
  console.log(`\n${DRY ? 'Dry run — nothing written.' : 'Nothing to write.'}`);
}
