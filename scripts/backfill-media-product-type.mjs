#!/usr/bin/env node
/**
 * backfill-media-product-type.mjs — one-time fixer.
 *
 * Meta's Graph API types reels as media_type VIDEO; the reel-ness lives
 * in media_product_type, which the sync historically never requested.
 * Every reel in analytics/performance.json therefore sat as mediaType
 * "VIDEO", invisible to the reels-only analytics (corpus, retention,
 * hook hold, content brief).
 *
 * This script pages the account's media list (id + media_product_type
 * only — no per-post insight calls), re-types matching store rows to
 * REELS, and writes the store back through the dashboard-owned storage
 * (R2 when configured). Idempotent; run again any time.
 *
 * Usage: node scripts/backfill-media-product-type.mjs [maxMedia=200]
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

const { readAnalytics, writeAnalytics } = await import('../lib/analyticsStore.ts');

const MAX = parseInt(process.argv[2] ?? '200', 10);
const igId = process.env.INSTAGRAM_ACCOUNT_ID;
const token = process.env.META_ACCESS_TOKEN;
if (!igId || !token) throw new Error('INSTAGRAM_ACCOUNT_ID / META_ACCESS_TOKEN not set');

const productTypeById = new Map();
let url = new URL(`https://graph.facebook.com/v22.0/${igId}/media`);
url.searchParams.set('fields', 'id,media_type,media_product_type');
url.searchParams.set('limit', '50');
url.searchParams.set('access_token', token);

while (url && productTypeById.size < MAX) {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Meta error: ${JSON.stringify(json.error ?? json)}`);
  }
  for (const item of json.data ?? []) {
    productTypeById.set(item.id, {
      mediaType: item.media_type,
      productType: item.media_product_type,
    });
  }
  url = json.paging?.next ? new URL(json.paging.next) : null;
}
console.log(`Fetched product types for ${productTypeById.size} media items.`);

const store = await readAnalytics();
let retyped = 0;
for (const post of store.posts) {
  const meta = productTypeById.get(post.mediaId);
  if (!meta) continue;
  const normalized = meta.productType === 'REELS' ? 'REELS' : meta.mediaType;
  if (normalized && post.mediaType !== normalized) {
    post.mediaType = normalized;
    retyped++;
  }
}
if (retyped > 0) {
  store.lastSyncedAt = new Date().toISOString();
  await writeAnalytics(store);
}
console.log(`Re-typed ${retyped} of ${store.posts.length} store rows.`);
