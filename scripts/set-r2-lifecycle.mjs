/**
 * Apply a 30-day expiration lifecycle rule to the R2 bucket so transient
 * Instagram publish-transit objects auto-delete and storage stays under the
 * 10 GB free tier. Uses the S3-compatible R2 credentials already in .env.local.
 *
 * SCOPE: the rule targets ONLY the `instagram/` prefix (the bulky media that
 * uploadFile() writes — see lib/upload.ts). The `queue/` and `analytics/`
 * prefixes hold persistent JSON state (queue.ts / analyticsStore.ts) and MUST
 * NOT be expired — do not widen this to an empty prefix.
 *
 * NOTE: This was applied via the Cloudflare dashboard UI on 2026-06-08 because
 * the R2 S3 API host (*.r2.cloudflarestorage.com) is blocked by SNI-based
 * filtering on some networks (TLS handshake reset). If re-running this fails
 * with ECONNRESET, set the rule in the dashboard: bucket → Settings →
 * Object Lifecycle Rules → Add.
 *
 * Run:  node scripts/set-r2-lifecycle.mjs
 * Verify only (no write):  node scripts/set-r2-lifecycle.mjs --verify
 */
import fs from 'fs';
import path from 'path';
import {
  S3Client,
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';

// Minimal .env.local loader (no dotenv dependency needed).
const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const Bucket = env.R2_BUCKET_NAME;
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

const verifyOnly = process.argv.includes('--verify');

async function show() {
  try {
    const cur = await r2.send(new GetBucketLifecycleConfigurationCommand({ Bucket }));
    console.log('Current lifecycle rules:', JSON.stringify(cur.Rules, null, 2));
  } catch (e) {
    if (e.name === 'NoSuchLifecycleConfiguration') console.log('Current lifecycle rules: (none)');
    else throw e;
  }
}

if (verifyOnly) {
  await show();
  process.exit(0);
}

console.log(`Bucket: ${Bucket}`);
console.log('Before —');
await show();

await r2.send(new PutBucketLifecycleConfigurationCommand({
  Bucket,
  LifecycleConfiguration: {
    Rules: [
      {
        ID: 'expire-instagram-media-30d',
        Status: 'Enabled',
        Filter: { Prefix: 'instagram/' }, // transient publish media ONLY — not queue/ or analytics/
        Expiration: { Days: 30 },
        // Clean up any aborted multipart uploads too.
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
      },
    ],
  },
}));

console.log('\nApplied. After —');
await show();
console.log('\n✅ 30-day expiration rule active on', Bucket);
