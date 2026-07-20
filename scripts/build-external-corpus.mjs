#!/usr/bin/env node
/**
 * build-external-corpus.mjs
 *
 * Parse data/viral-corpus/external-seeds.md into structured JSON entries
 * under data/viral-corpus/external/<id>.json. Each entry conforms to
 * the ExternalExample interface in lib/performanceCorpus.ts and gets
 * injected into the clip-proposal prompt as a few-shot viral example.
 *
 * Seeds are hand-curated: you paste the URL, hook verbatim, views,
 * duration, and a one-line why-viral. Keeping this manual (rather than
 * yt-dlp + auto-transcribe) yields higher-signal examples — the "why"
 * is the whole point, and a human spotting the pattern beats an LLM
 * guessing from metadata.
 *
 * Usage:
 *   node scripts/build-external-corpus.mjs
 *   node scripts/build-external-corpus.mjs --check   # validate only, no writes
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SEEDS_PATH = path.join(PROJECT_ROOT, 'data', 'viral-corpus', 'external-seeds.md');
const OUT_DIR = path.join(PROJECT_ROOT, 'data', 'viral-corpus', 'external');

const argv = new Set(process.argv.slice(2));
const CHECK_ONLY = argv.has('--check');

const VALID_PLATFORMS = new Set(['instagram', 'tiktok', 'youtube-shorts', 'other']);
const VALID_HOOK_STYLES = new Set([
  'Question hook',
  'Statistic or list hook',
  'Story hook',
  'Contrarian hook',
  'Statement hook',
]);
const VALID_HOOK_TYPES = new Set([
  'contrarian',
  'question',
  'statistic',
  'story',
  'stakes',
  'statement',
]);
const PLACEHOLDER_URL = 'https://www.example.com/placeholder-delete-me';

function stableId(url) {
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 8);
  return `ext_${hash}`;
}

function parseSeeds(raw) {
  const seeds = [];
  const blocks = raw.split(/\n(?=##\s+https?:\/\/)/);
  for (const block of blocks) {
    const urlMatch = block.match(/^##\s+(https?:\/\/\S+)/);
    if (!urlMatch) continue;
    const url = urlMatch[1].trim();
    const body = block.slice(urlMatch[0].length);
    const fields = {};
    for (const line of body.split('\n')) {
      const m = line.match(/^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/);
      if (!m) continue;
      fields[m[1].toLowerCase()] = m[2].trim();
    }
    seeds.push({ url, fields });
  }
  return seeds;
}

function stripQuotes(s) {
  if (!s) return s;
  return s.replace(/^["'](.*)["']$/s, '$1').trim();
}

function validateSeed(seed) {
  const { url, fields } = seed;
  const errors = [];
  if (url === PLACEHOLDER_URL) {
    return { skip: true, reason: 'placeholder seed — delete me from seeds file when adding real entries' };
  }
  const platform = (fields.platform ?? '').toLowerCase();
  if (!VALID_PLATFORMS.has(platform)) {
    errors.push(`platform must be one of ${[...VALID_PLATFORMS].join(', ')} (got "${fields.platform ?? ''}")`);
  }
  const hook = stripQuotes(fields.hook ?? '');
  if (!hook) errors.push('hook is required');
  const hookStyle = fields.hookstyle ?? '';
  if (!VALID_HOOK_STYLES.has(hookStyle)) {
    errors.push(`hookstyle must be one of ${[...VALID_HOOK_STYLES].join(' | ')} (got "${hookStyle}")`);
  }
  const hookType = (fields.hooktype ?? '').toLowerCase();
  if (hookType && !VALID_HOOK_TYPES.has(hookType)) {
    errors.push(`hooktype if present must be one of ${[...VALID_HOOK_TYPES].join(' | ')} (got "${fields.hooktype}")`);
  }
  const views = Number(fields.views);
  if (!Number.isFinite(views) || views < 0) errors.push('views must be a non-negative number');
  const durationSec = Number(fields.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0) errors.push('duration must be a positive number of seconds');
  const whyViral = fields.whyviral ?? '';
  if (!whyViral) errors.push('whyViral is required');

  if (errors.length > 0) return { errors };

  return {
    entry: {
      id: stableId(url),
      url,
      platform,
      creator: fields.creator || undefined,
      hook: hook.slice(0, 200),
      hookStyle,
      hookType: hookType || undefined,
      views: Math.round(views),
      durationSec: Math.round(durationSec),
      whyViral: whyViral.slice(0, 400),
      pillar: fields.pillar || undefined,
      addedAt: new Date().toISOString(),
    },
  };
}

function main() {
  if (!fs.existsSync(SEEDS_PATH)) {
    console.error(`Seeds file not found: ${path.relative(PROJECT_ROOT, SEEDS_PATH)}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(SEEDS_PATH, 'utf-8');
  const seeds = parseSeeds(raw);

  if (seeds.length === 0) {
    console.error('No seeds found. Each seed is a `## <url>` heading followed by labeled fields.');
    process.exit(1);
  }

  console.log(`Found ${seeds.length} seed(s). ${CHECK_ONLY ? 'Validating only (--check).' : 'Writing entries…'}`);

  if (!CHECK_ONLY) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  let written = 0;
  let skipped = 0;
  const errors = [];

  for (const seed of seeds) {
    const result = validateSeed(seed);
    if (result.skip) {
      console.log(`  · skip ${seed.url} — ${result.reason}`);
      skipped++;
      continue;
    }
    if (result.errors) {
      errors.push({ url: seed.url, errors: result.errors });
      console.error(`  ✗ ${seed.url}`);
      for (const e of result.errors) console.error(`      - ${e}`);
      continue;
    }
    const outPath = path.join(OUT_DIR, `${result.entry.id}.json`);
    if (!CHECK_ONLY) {
      fs.writeFileSync(outPath, JSON.stringify(result.entry, null, 2));
    }
    console.log(`  ✓ ${result.entry.id}  ${result.entry.views.toLocaleString()} views  ${result.entry.hookStyle}  "${result.entry.hook.slice(0, 60)}${result.entry.hook.length > 60 ? '…' : ''}"`);
    written++;
  }

  console.log('');
  console.log(`${written} written, ${skipped} skipped, ${errors.length} error(s).`);
  console.log(`Output: ${path.relative(PROJECT_ROOT, OUT_DIR)}/`);

  if (errors.length > 0) {
    console.log('');
    console.log('Fix the errors above and re-run.');
    process.exit(1);
  }
}

main();
