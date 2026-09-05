/**
 * registerSource.ts — turn a video file that has landed on disk into an
 * editor project. Shared by the legacy single-POST upload route and the
 * chunked upload `finish` route so both produce identical projects.
 *
 * Responsibilities:
 *   - derive a collision-free slug from the original filename
 *   - write status.json (category, sourcePath, durationSec)
 *   - probe duration + codec
 *   - seed edit-plan.json for talking-head projects
 *   - kick off a best-effort thumbnail
 *
 * The inbox watcher in my-video-projects/scripts/watch-inbox.ts performs the
 * equivalent steps in its own repo; keep the status.json fields in sync.
 */
import * as fs from 'fs';
import * as path from 'path';
import { TAKES_ROOT, VIDEO_PROJECT_ROOT, validateSlug } from './paths';
import { writeStatus, type Category } from './status';
import { probeDurationSec, probeVideoCodec, extractThumb } from './ffmpeg';
import { createPlan } from './editPlan';
import { writePlan } from './planStore';

/** Long-form threshold. Mirrors CLASSIFY_LONGFORM_MIN_SEC in the watcher. */
export const LONG_FORM_MIN_SEC = 720;

/**
 * slugify(name) + second-resolution stamp. Two uploads of the same filename
 * inside one minute used to collide (minute-resolution stamp) and the second
 * `source.mp4` write clobbered the first; now the stamp has seconds and a
 * numeric suffix is appended if the directory still exists.
 */
export function slugForUpload(name: string, now: Date = new Date()): string {
  const base = name
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const root = `${base || 'clip'}-${stamp}`;
  let slug = root;
  let n = 2;
  while (fs.existsSync(path.join(TAKES_ROOT, slug))) {
    slug = `${root}-${n++}`;
  }
  return slug;
}

export type RegisterInput = {
  slug: string;
  /** Absolute path of the file already sitting at data/takes/<slug>/source.mp4. */
  sourcePath: string;
  /** Explicit category, or null to auto-pick from duration. */
  category: Category | null;
};

export type RegisterResult = {
  slug: string;
  category: Category;
  categorySource: 'explicit' | 'auto';
  durationSec: number;
  codec: string;
};

export async function registerSource(input: RegisterInput): Promise<RegisterResult> {
  const { slug, sourcePath } = input;
  if (!validateSlug(slug)) throw new Error(`invalid slug: ${slug}`);
  const slugDir = path.join(TAKES_ROOT, slug);
  fs.mkdirSync(slugDir, { recursive: true });

  const relSource = path.relative(VIDEO_PROJECT_ROOT, sourcePath);

  let duration = 0;
  let codec = '';
  try {
    duration = await probeDurationSec(sourcePath);
    codec = await probeVideoCodec(sourcePath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeStatus(slug, {
      sourcePath: relSource,
      category: input.category ?? 'talking-head',
      error: `ffprobe failed: ${msg}`,
    });
    throw new Error(`ffprobe failed: ${msg}`);
  }

  const categorySource: 'explicit' | 'auto' = input.category ? 'explicit' : 'auto';
  const category: Category =
    input.category ?? (duration >= LONG_FORM_MIN_SEC ? 'long-form' : 'talking-head');

  writeStatus(slug, {
    sourcePath: relSource,
    category,
    durationSec: duration,
    error: null,
  });

  if (category === 'talking-head') {
    writePlan(createPlan({ slug, sourceVideo: relSource, sourceDuration: duration }));
  }

  // Best-effort thumbnail. Long-form uses a later frame so the thumb shows a
  // speaker rather than a blank intro.
  const thumbAt = category === 'long-form'
    ? Math.min(60, duration / 3)
    : Math.min(2, Math.max(0.5, duration / 3));
  extractThumb(sourcePath, path.join(slugDir, 'thumb.jpg'), thumbAt).catch(() => {});

  return { slug, category, categorySource, durationSec: duration, codec };
}
