#!/usr/bin/env node
/**
 * audit-r2-orphans.mjs — find (and optionally delete) R2 objects under the
 * `instagram/` prefix that no queue post references.
 *
 * Why this exists: until 2026-07-28, `app/api/local-scan/upload/route.ts` ran
 * `uploadFiles()` and `generateCarouselCaption()` concurrently in one
 * `Promise.all`. When the caption threw (exhausted Anthropic credit), the POST
 * 500'd but the slides had ALREADY landed in R2. Every retried Rescan minted a
 * fresh `instagram/<ts>-slide-NN.png` key, so the bucket accumulated thousands
 * of slide objects no post points at. See the "Carousels + quote cards silently
 * never queued" section of the project-threshold-dashboard wiki page.
 *
 * SAFETY
 *  - Only ever touches the `instagram/` prefix. `queue/` and `analytics/` are
 *    persistent state JSON and are never listed for deletion; `slides/` holds
 *    rendered slide videos and is likewise left alone.
 *  - Dry-run by default. `--apply` deletes, and re-verifies the prefix of every
 *    key immediately before issuing the delete.
 *  - Referenced-set is the union of the LIVE R2 queue plus every local queue
 *    file on disk (data/queue.json, queue-cache.json, queue-backup-*.json), so
 *    an object a backup could resurrect is never considered orphaned.
 *
 * Usage:
 *   node scripts/audit-r2-orphans.mjs            # dry-run report
 *   node scripts/audit-r2-orphans.mjs --json     # + machine-readable summary
 *   node scripts/audit-r2-orphans.mjs --apply    # delete the orphans
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env.local (this runs outside Next's env loader).
for (const line of fs.readFileSync(path.join(repoRoot, '.env.local'), 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectsCommand } =
  await import('@aws-sdk/client-s3');

const APPLY = process.argv.includes('--apply');
const JSON_OUT = process.argv.includes('--json');

const TARGET_PREFIX = 'instagram/';
const PROTECTED_PREFIXES = ['queue/', 'analytics/', 'slides/'];

const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const mb = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';
const gb = (b) => (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
const size = (b) => (b >= 1024 ** 3 ? gb(b) : mb(b));

// ── 1. List the whole bucket (so the report shows every prefix, not just ours)

async function listAll() {
  const objects = [];
  let token;
  do {
    const res = await r2.send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token }),
    );
    for (const o of res.Contents ?? []) {
      objects.push({ key: o.Key, size: o.Size ?? 0, modified: o.LastModified });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

// ── 2. Collect every referenced URL

function urlsFromPosts(posts) {
  const urls = [];
  for (const p of posts) {
    if (p.imageUrl) urls.push(p.imageUrl);
    if (Array.isArray(p.imageUrls)) urls.push(...p.imageUrls);
    if (p.videoUrl) urls.push(p.videoUrl);
    if (p.coverImageUrl) urls.push(p.coverImageUrl);
  }
  return urls.filter((u) => typeof u === 'string');
}

/** URL → bucket key. Handles the public host and any bare/absolute form. */
function keyFromUrl(url) {
  let u = url;
  if (PUBLIC_URL && u.startsWith(PUBLIC_URL + '/')) u = u.slice(PUBLIC_URL.length + 1);
  else {
    const m = u.match(/^https?:\/\/[^/]+\/(.+)$/);
    if (m) u = m[1];
  }
  return decodeURIComponent(u.split('?')[0].replace(/^\/+/, ''));
}

async function readLiveQueue() {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'queue/queue.json' }));
  return JSON.parse(await res.Body.transformToString());
}

function readLocalQueueFiles() {
  const dir = path.join(repoRoot, 'data');
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!/^queue.*\.json$/.test(f)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      const posts = Array.isArray(parsed) ? parsed : parsed.posts;
      if (Array.isArray(posts)) out.push({ file: f, posts });
    } catch {
      /* unreadable backup — ignore */
    }
  }
  return out;
}

// ── 3. Report

let objects, livePosts;
try {
  [objects, livePosts] = await Promise.all([listAll(), readLiveQueue()]);
} catch (e) {
  // The clinic/work firewall resets connections to *.r2.cloudflarestorage.com
  // (the S3 API) while leaving the public *.r2.dev CDN reachable. Nothing has
  // been deleted at this point — the delete pass runs strictly after listing.
  if (e?.code === 'ECONNRESET' || /ECONNRESET|ETIMEDOUT|EAI_AGAIN/.test(String(e?.message))) {
    console.error(
      '\nCannot reach the R2 S3 API — connection reset.\n' +
      'This network blocks *.r2.cloudflarestorage.com (the public *.r2.dev CDN is unaffected).\n' +
      'Nothing was listed, nothing was deleted. Re-run from an unblocked network.\n',
    );
    process.exit(2);
  }
  throw e;
}
const localFiles = readLocalQueueFiles();

const liveKeys = new Set(urlsFromPosts(livePosts).map(keyFromUrl));
const localKeys = new Set();
for (const { posts } of localFiles) for (const u of urlsFromPosts(posts)) localKeys.add(keyFromUrl(u));

const referenced = new Set([...liveKeys, ...localKeys]);

// Prefix census over the whole bucket.
const byPrefix = new Map();
for (const o of objects) {
  const p = o.key.includes('/') ? o.key.slice(0, o.key.indexOf('/') + 1) : '(root)';
  const cur = byPrefix.get(p) ?? { count: 0, bytes: 0 };
  cur.count += 1;
  cur.bytes += o.size;
  byPrefix.set(p, cur);
}

const target = objects.filter((o) => o.key.startsWith(TARGET_PREFIX));
const orphans = target.filter((o) => !referenced.has(o.key));
const keptByBackupOnly = target.filter((o) => !liveKeys.has(o.key) && localKeys.has(o.key));

const sum = (arr) => arr.reduce((a, o) => a + o.size, 0);
const bucketBytes = sum(objects);
const targetBytes = sum(target);
const orphanBytes = sum(orphans);

// Break orphans down by filename shape + age.
const shape = (key) => {
  const name = key.slice(TARGET_PREFIX.length).replace(/^\d+-/, '');
  if (/^slide-\d+\.png$/i.test(name)) return 'slide-NN.png';
  if (/\.mp4$/i.test(name)) return 'video (.mp4)';
  if (/\.(png|jpe?g)$/i.test(name)) return 'other image';
  return 'other';
};
const shapes = new Map();
for (const o of orphans) {
  const s = shape(o.key);
  const cur = shapes.get(s) ?? { count: 0, bytes: 0 };
  cur.count += 1;
  cur.bytes += o.size;
  shapes.set(s, cur);
}

const dates = new Map();
for (const o of orphans) {
  const d = o.modified ? o.modified.toISOString().slice(0, 10) : 'unknown';
  const cur = dates.get(d) ?? { count: 0, bytes: 0 };
  cur.count += 1;
  cur.bytes += o.size;
  dates.set(d, cur);
}

console.log(`\nBucket: ${BUCKET}`);
console.log(`Total objects: ${objects.length.toLocaleString()}   ${size(bucketBytes)}\n`);

console.log('By prefix:');
for (const [p, v] of [...byPrefix.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  const flag = PROTECTED_PREFIXES.includes(p) ? '  ← PROTECTED, not touched' : '';
  console.log(`  ${p.padEnd(12)} ${String(v.count).padStart(6)} objects  ${size(v.bytes).padStart(10)}${flag}`);
}

console.log(`\n${TARGET_PREFIX} audit`);
console.log(`  objects:               ${target.length.toLocaleString().padStart(8)}   ${size(targetBytes)}`);
console.log(`  referenced by queue:   ${(target.length - orphans.length).toLocaleString().padStart(8)}   ${size(targetBytes - orphanBytes)}`);
console.log(`  UNREFERENCED:          ${orphans.length.toLocaleString().padStart(8)}   ${size(orphanBytes)}   (${((orphanBytes / targetBytes) * 100).toFixed(1)}% of prefix, ${((orphanBytes / bucketBytes) * 100).toFixed(1)}% of bucket)`);
console.log(`  (held only by a local queue file / backup, NOT counted as orphan: ${keptByBackupOnly.length})`);

console.log('\nUnreferenced by file shape:');
for (const [s, v] of [...shapes.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`  ${s.padEnd(16)} ${String(v.count).padStart(6)}   ${size(v.bytes).padStart(10)}`);
}

console.log('\nUnreferenced by upload date:');
for (const [d, v] of [...dates.entries()].sort()) {
  console.log(`  ${d}   ${String(v.count).padStart(6)}   ${size(v.bytes).padStart(10)}`);
}

console.log('\nSample of 10 unreferenced keys:');
for (const o of orphans.slice(0, 10)) console.log(`  ${o.key}  (${mb(o.size)})`);

console.log('\nQueue sources read:');
console.log(`  R2 queue/queue.json           ${livePosts.length} posts, ${liveKeys.size} distinct media keys`);
for (const { file, posts } of localFiles) console.log(`  data/${file.padEnd(28)} ${posts.length} posts`);

if (JSON_OUT) {
  console.log('\n--- JSON ---');
  console.log(JSON.stringify({
    bucket: BUCKET,
    totalObjects: objects.length,
    totalBytes: bucketBytes,
    prefix: TARGET_PREFIX,
    prefixObjects: target.length,
    prefixBytes: targetBytes,
    orphanObjects: orphans.length,
    orphanBytes,
  }, null, 2));
}

// ── 4. Delete (only with --apply)

if (!APPLY) {
  console.log(`\nDRY RUN — nothing deleted. Re-run with --apply to delete the ${orphans.length} unreferenced objects.\n`);
  process.exit(0);
}

const unsafe = orphans.filter(
  (o) => !o.key.startsWith(TARGET_PREFIX) || PROTECTED_PREFIXES.some((p) => o.key.startsWith(p)),
);
if (unsafe.length) {
  console.error(`\nABORT: ${unsafe.length} keys outside ${TARGET_PREFIX} in the delete set. Nothing deleted.`);
  process.exit(1);
}

// Record exactly what we removed, so a mistake is at least reconstructable.
const manifest = path.join(repoRoot, 'data', `r2-orphan-delete-manifest.json`);
fs.writeFileSync(manifest, JSON.stringify(orphans, null, 2));
console.log(`\nManifest of the delete set written to ${manifest}`);

let deleted = 0;
for (let i = 0; i < orphans.length; i += 1000) {
  const batch = orphans.slice(i, i + 1000);
  const res = await r2.send(new DeleteObjectsCommand({
    Bucket: BUCKET,
    Delete: { Objects: batch.map((o) => ({ Key: o.key })), Quiet: true },
  }));
  deleted += batch.length - (res.Errors?.length ?? 0);
  for (const e of res.Errors ?? []) console.error(`  FAILED ${e.Key}: ${e.Message}`);
  console.log(`  deleted ${Math.min(i + 1000, orphans.length)} / ${orphans.length}`);
}

console.log(`\nDone. Deleted ${deleted.toLocaleString()} objects, freed ${size(orphanBytes)}.\n`);
