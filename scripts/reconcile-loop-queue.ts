/**
 * One-shot reconciler for the truncated duplicate loop-reel posts.
 *
 * On 2026-07-26 render-loop-reel.mjs wrote Remotion output straight into
 * Reels/Final/ while watch-renders.mjs polled that folder every 4s and
 * re-queued on any mtime change. Every poll during a render uploaded the
 * half-written mp4 as a NEW post, so 8 reels produced 42 queue entries — 34 of
 * them truncated (786KB, 2MB, 3.4MB … climbing toward the real size). Only the
 * final post per reel holds a complete R2 object.
 *
 * Both causes are fixed now (atomic rename + a settle gate). This cleans up
 * what the bug already produced.
 *
 * Safety: a post is only removed when its filename is one of the affected
 * reels AND its recorded sourceSize disagrees with the file on disk. Posts from
 * earlier sessions cannot match either condition. Deletion goes through
 * deletePost(), NOT /api/delete — that route also calls moveToRejected(), which
 * would rename the one real mp4 out of Final/ and break every sibling post.
 *
 *   npx tsx scripts/reconcile-loop-queue.ts                       # dry run, no writes
 *   npx tsx scripts/reconcile-loop-queue.ts --apply               # delete duplicates only
 *   npx tsx scripts/reconcile-loop-queue.ts --apply --reschedule  # also re-slot survivors
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env.local BEFORE importing lib/queue — lib/r2 builds its S3 client at
// module load from process.env (same ordering requirement as fix-loop-reels.ts).
const envPath = fileURLToPath(new URL('../.env.local', import.meta.url));
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

const APPLY = process.argv.includes('--apply');
// Rescheduling is opt-in: removing the duplicates leaves the survivors on their
// original dates, which is what you want when the schedule is set by hand.
const RESCHEDULE = process.argv.includes('--reschedule');
const FINAL = path.join(os.homedir(), 'Code', 'Social Media', 'Reels', 'Final');

/** The reels the duplicate bug touched: the 2026-07-26 auto-draft batch. */
const AFFECTED = /^story-loop-.*-2026072612\d{2}\.mp4$/i;

function diskSize(name: string): number | null {
  try {
    return fs.statSync(path.join(FINAL, name)).size;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const { readQueue, deletePost, updatePost } = await import('../lib/queue');
  const posts = await readQueue();
  console.log(`Queue: ${posts.length} posts\n`);

  const affected = posts.filter((p) => p.notes && AFFECTED.test(p.notes));
  const byName = new Map<string, typeof affected>();
  for (const p of affected) {
    const list = byName.get(p.notes!) ?? [];
    list.push(p);
    byName.set(p.notes!, list);
  }

  const doomed: typeof affected = [];
  const keepers: typeof affected = [];

  for (const [name, group] of Array.from(byName.entries()).sort()) {
    const size = diskSize(name);
    if (size === null) {
      console.log(`⚠️  ${name}: NOT on disk — skipping all ${group.length} post(s), nothing removed`);
      continue;
    }
    const good = group.filter((p) => p.sourceSize === size);
    const bad = group.filter((p) => p.sourceSize !== size);
    // Never leave a reel with no post. If nothing matches disk, keep the group
    // intact and report it rather than deleting the reel out of the queue.
    if (good.length === 0) {
      console.log(`⚠️  ${name}: no post matches disk (${size.toLocaleString()}) — keeping all ${group.length}`);
      continue;
    }
    keepers.push(...good);
    doomed.push(...bad);
    console.log(
      `${name}\n    disk ${size.toLocaleString()} · keep ${good.length} · remove ${bad.length}` +
        (bad.length ? ` (${bad.map((p) => (p.sourceSize ?? 0).toLocaleString()).join(', ')})` : ''),
    );
  }

  // Reschedule: pool every slot the affected posts held and hand the earliest
  // ones to the survivors, so no slot is left holding a deleted post. Take at
  // most one slot per calendar day — the raw pool was sized for 42 posts, so
  // the earliest 8 slots would otherwise stack 3 reels onto a single day.
  const seenDays = new Set<string>();
  const slots = affected
    .map((p) => p.scheduledTime)
    .filter((t): t is string => !!t)
    .sort()
    .filter((t) => {
      const day = t.slice(0, 10);
      if (seenDays.has(day)) return false;
      seenDays.add(day);
      return true;
    });
  const ordered = [...keepers].sort((a, b) => (a.scheduledTime ?? '').localeCompare(b.scheduledTime ?? ''));
  const moves = RESCHEDULE
    ? ordered
        .map((p, i) => ({ post: p, from: p.scheduledTime, to: slots[i] }))
        .filter((m) => m.to && m.to !== m.from)
    : [];

  console.log(`\n── Summary ──`);
  console.log(`  remove        : ${doomed.length}`);
  console.log(`  keep          : ${keepers.length}`);
  console.log(`  untouched     : ${posts.length - affected.length}`);
  console.log(`  reschedule    : ${moves.length}${RESCHEDULE ? '' : ' (skipped — pass --reschedule to enable)'}`);
  console.log(`  queue after   : ${posts.length - doomed.length}`);

  if (moves.length) {
    console.log(`\n── Reschedule ──`);
    for (const m of moves) {
      console.log(`  ${m.post.notes}\n      ${String(m.from).slice(0, 16)}  →  ${String(m.to).slice(0, 16)}`);
    }
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to execute.`);
    return;
  }

  for (const p of doomed) {
    await deletePost(p.id);
    console.log(`  deleted ${p.id.slice(0, 8)} ${p.notes} (${(p.sourceSize ?? 0).toLocaleString()})`);
  }
  for (const m of moves) {
    await updatePost(m.post.id, { scheduledTime: m.to });
    console.log(`  rescheduled ${m.post.notes} → ${String(m.to).slice(0, 16)}`);
  }
  console.log(`\n✅ Done. ${doomed.length} removed, ${moves.length} rescheduled.`);
}

main().catch((err) => {
  console.error('❌', err?.message ?? err);
  process.exit(1);
});
