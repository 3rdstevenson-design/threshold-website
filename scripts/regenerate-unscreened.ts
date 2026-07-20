#!/usr/bin/env node
/**
 * regenerate-unscreened.ts
 *
 * Re-derive clips + captions for talking-head projects that were auto-processed
 * but NOT yet screened/edited, using the CURRENT (improved) auto-cut + caption
 * settings. Reads the cached analysis.json — no re-transcription, no re-render.
 * Also refreshes the filler list and caption font to the brand defaults.
 *
 * SAFETY:
 *   - Skips any project the user has hand-edited (history contains a non-auto
 *     action) — so manual edits are never clobbered.
 *   - Skips any project that's already exported (a rendered MP4 exists).
 *   - Dry-run by default. `--apply` writes, after copying edit-plan.json →
 *     edit-plan.json.bak for each project it touches.
 *
 *   npx tsx scripts/regenerate-unscreened.ts                 # dry run, all projects
 *   npx tsx scripts/regenerate-unscreened.ts --apply         # write all eligible
 *   npx tsx scripts/regenerate-unscreened.ts --apply img-6172 img-6176
 *   npx tsx scripts/regenerate-unscreened.ts --apply --force img-6195   # override the edited/exported skip (named slugs only; still backs up)
 *
 * NOTE: imports only the pure lib/editor modules + fs. It deliberately does NOT
 * import paths.ts / planStore.ts — those pull in `next/server`, which breaks a
 * standalone tsx run. TAKES_ROOT and DRAFTS_DIR are recomputed here to match
 * lib/editor/paths.ts.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  autoCutStaged,
  TALKING_HEAD_CUT_OPTIONS,
  type Word,
  type Silence,
} from '../lib/editor/autoCut';
import { chunkCaptions } from '../lib/editor/captionChunker';
import { detectRepeatStutters } from '../lib/editor/stutterDetection';
import {
  applyAction,
  validatePlan,
  DEFAULT_CAPTION_STYLE,
  type EditPlan,
} from '../lib/editor/editPlan';
import { DEFAULT_FILLER_WORDS } from '../lib/editor/fillerWords';

// Mirror lib/editor/paths.ts (without importing it — see header note).
const TAKES_ROOT = path.join(os.homedir(), 'Code', 'Social Media', 'my-video-projects', 'data', 'takes');
const DRAFTS_DIR = path.join(os.homedir(), 'Code', 'Social Media', 'Reels', 'Drafts');

// Action types the auto-pipeline emits. A plan whose history contains ONLY
// these has never been touched by hand → safe to regenerate.
const AUTO_ACTION_TYPES = new Set(['create_plan', 'auto_cut', 'generate_captions']);

type Analysis = {
  duration: number;
  words: Word[];
  silences: Silence[];
};

type Outcome =
  | {
      slug: string;
      action: 'regenerate';
      clipsBefore: number;
      clipsAfter: number;
      capsBefore: number;
      capsAfter: number;
    }
  | { slug: string; action: 'skip'; reason: string };

function readJSON<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function isUnscreened(plan: EditPlan): boolean {
  return (plan.history ?? []).every((a) => AUTO_ACTION_TYPES.has(a.type));
}

function isExported(slug: string): boolean {
  // Matches the "rendered" checks in lib/editor/status.ts.
  return [
    path.join(TAKES_ROOT, slug, 'final.mp4'),
    path.join(DRAFTS_DIR, `edits-${slug}.mp4`),
    path.join(DRAFTS_DIR, `talking-head-${slug}.mp4`),
    path.join(DRAFTS_DIR, 'talking-head.mp4'),
  ].some((p) => fs.existsSync(p));
}

function processSlug(slug: string, apply: boolean, force: boolean): Outcome {
  const dir = path.join(TAKES_ROOT, slug);
  const planPath = path.join(dir, 'edit-plan.json');
  const analysisPath = path.join(dir, 'analysis.json');

  if (!fs.existsSync(planPath)) return { slug, action: 'skip', reason: 'no edit-plan.json (not in editing)' };

  const rawPlan = readJSON<unknown>(planPath);
  if (!rawPlan || !validatePlan(rawPlan)) return { slug, action: 'skip', reason: 'invalid edit-plan.json' };
  const plan = rawPlan; // validatePlan narrows to EditPlan

  if (!force && !isUnscreened(plan)) return { slug, action: 'skip', reason: 'already edited (manual history) — use --force to override' };
  if (!force && isExported(slug)) return { slug, action: 'skip', reason: 'already exported — use --force to override' };

  const analysis = readJSON<Analysis>(analysisPath);
  if (!analysis || !Array.isArray(analysis.words) || analysis.words.length === 0) {
    return { slug, action: 'skip', reason: 'no analysis.json / no words (cannot re-derive)' };
  }

  // Re-derive exactly as the server pipeline does (silences → fillers →
  // stutters → drop-tiny), with the improved talking-head preset.
  const cut = autoCutStaged({
    duration: analysis.duration,
    words: analysis.words,
    silences: analysis.silences ?? [],
    fillerWords: DEFAULT_FILLER_WORDS,
    stutterDetector: (w) =>
      detectRepeatStutters(w, { singleWordRepeats: true, partialWordFragments: false }),
    options: TALKING_HEAD_CUT_OPTIONS,
  });
  const captions = chunkCaptions(analysis.words, cut.clips, {
    customSpellings: plan.customSpellings ?? [],
  });

  const outcome: Outcome = {
    slug,
    action: 'regenerate',
    clipsBefore: plan.clips.length,
    clipsAfter: cut.clips.length,
    capsBefore: plan.captions.length,
    capsAfter: captions.length,
  };

  if (apply) {
    fs.copyFileSync(planPath, planPath + '.bak');
    let next = applyAction(plan, { type: 'auto_cut', params: { clips: cut.clips, stats: cut.stats } });
    next = applyAction(next, { type: 'generate_captions', params: { captions } });
    // Refresh filler list + caption font to the brand defaults. Done as a
    // direct field set (not a set_caption_style action) so the plan keeps
    // reading as "unscreened" and the script stays idempotent.
    next = {
      ...next,
      fillerWords: [...DEFAULT_FILLER_WORDS],
      captionStyle: { ...(next.captionStyle ?? DEFAULT_CAPTION_STYLE), fontFamily: 'montserrat' },
    };
    fs.writeFileSync(planPath, JSON.stringify(next, null, 2));
  }

  return outcome;
}

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const force = args.includes('--force');
  const slugArgs = args.filter((a) => !a.startsWith('--'));

  if (!fs.existsSync(TAKES_ROOT)) {
    console.error(`takes dir not found: ${TAKES_ROOT}`);
    process.exit(1);
  }

  // --force overrides the edited/exported guards, so require explicit slugs —
  // never let it mass-overwrite every project's hand edits.
  if (force && slugArgs.length === 0) {
    console.error('--force requires explicit slug(s) so it cannot mass-overwrite edited projects.');
    process.exit(1);
  }

  const slugs =
    slugArgs.length > 0
      ? slugArgs
      : fs
          .readdirSync(TAKES_ROOT)
          .filter((name) => fs.statSync(path.join(TAKES_ROOT, name)).isDirectory());

  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} · ${slugs.length} project(s) under ${TAKES_ROOT}\n`);

  let regen = 0;
  let skipped = 0;
  for (const slug of [...slugs].sort()) {
    let outcome: Outcome;
    try {
      outcome = processSlug(slug, apply, force);
    } catch (e) {
      outcome = { slug, action: 'skip', reason: `error: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (outcome.action === 'regenerate') {
      regen++;
      console.log(
        `  ✓ ${slug}  clips ${outcome.clipsBefore}→${outcome.clipsAfter} · captions ${outcome.capsBefore}→${outcome.capsAfter}`,
      );
    } else {
      skipped++;
      console.log(`  · ${slug}  skip — ${outcome.reason}`);
    }
  }

  console.log(`\n${regen} ${apply ? 'regenerated' : 'would regenerate'} · ${skipped} skipped`);
  if (!apply && regen > 0) {
    console.log('Re-run with --apply to write (a .bak is saved for each project).');
  }
}

main();
