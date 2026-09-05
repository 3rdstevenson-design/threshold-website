import * as fs from 'fs';
import * as path from 'path';
import { TAKES_ROOT, DRAFTS_DIR } from './paths';
import type { PipelineWarning, ReviewReason } from './pipelineReport';

/**
 * Pipeline stages, in order of progress:
 *   ingesting   — source.mp4 copied in, whisper/ffmpeg still running
 *   transcribed — analysis.json written; no edit plan yet
 *   editing     — edit-plan.json exists; user is actively editing
 *   rendered    — final.mp4 (or talking-head-<slug>.mp4) is on disk
 *   error       — something failed; see status.json.error
 *
 * Legacy stages (takes-pending / takes-selected / built) still appear
 * for projects that went through the old takes picker. The new editor
 * maps them all to 'transcribed' so the user can pick up and edit.
 */
export type Stage =
  | 'ingesting'
  | 'transcribed'
  | 'clips-proposed'
  | 'editing'
  | 'needs-review'
  | 'rendered'
  | 'stale'
  | 'error';

export type LegacyStage =
  | 'takes-pending'
  | 'takes-selected'
  | 'built';

/**
 * Project category — drives the editor UI (talking-head gets the full
 * timeline workspace; long-form gets the clip-review view) and the
 * processing pipeline branch. Projects without an explicit category
 * default to 'talking-head' for backward compatibility with pre-category
 * uploads.
 */
export type Category = 'talking-head' | 'long-form';

export interface ProjectStatus {
  slug: string;
  stage: Stage;
  updatedAt: string;
  sourcePath?: string;
  durationSec?: number;
  lineCount?: number;
  takeCount?: number;
  thumb?: string;
  outputPath?: string;
  hasThumb: boolean;
  error?: string | null;
  category: Category;
  /** Parent long-form slug when this project was extracted from one. */
  sourceSlug?: string;
  /** Proposal id inside the parent's clips-proposal.json. */
  sourceClipId?: string;
  /** True when clips-proposal.json exists on disk (long-form only). */
  hasClipsProposal: boolean;
  /** Non-fatal problems from the last run (LLM unavailable, hook skipped…). */
  warnings?: PipelineWarning[];
  /** Set when the unattended pipeline paused for a human decision. */
  review?: ReviewState | null;
}

export type ReviewState = {
  required: boolean;
  reasons: ReviewReason[];
  createdAt: string;
  resolvedAt?: string;
};

function derivedStage(slugDir: string, slug: string, category: Category): Stage {
  const has = (rel: string) => fs.existsSync(path.join(slugDir, rel));

  // Every candidate must be slug-scoped. A bare `talking-head.mp4` used to be
  // in this list, which flipped EVERY talking-head project to "Exported" at
  // once the moment that one file existed in Drafts/.
  const renderedCandidates = [
    path.join(slugDir, 'final.mp4'),
    path.join(DRAFTS_DIR, `edits-${slug}.mp4`),
    path.join(DRAFTS_DIR, `talking-head-${slug}.mp4`),
  ];
  const rendered = renderedCandidates.find((p) => fs.existsSync(p));
  if (rendered) {
    // A render is only "Exported" if it is newer than the plan it was built
    // from. Otherwise the badge reports yesterday's render as today's export
    // and the user has no signal that their Export click did nothing.
    const planPath = path.join(slugDir, 'edit-plan.json');
    try {
      if (fs.existsSync(planPath)) {
        const planMs = fs.statSync(planPath).mtimeMs;
        const renderMs = fs.statSync(rendered).mtimeMs;
        if (planMs > renderMs) return 'stale';
      }
    } catch {
      // stat failed — fall through and report it as rendered rather than
      // hiding a finished file behind an unreadable timestamp.
    }
    return 'rendered';
  }

  if (category === 'long-form') {
    // Long-form doesn't go through the edit-plan → render flow; its
    // terminal state is "clips-proposed" (user reviews and extracts).
    if (has('clips-proposal.json')) return 'clips-proposed';
    if (has('analysis.json')) return 'transcribed';
    return 'ingesting';
  }

  if (has('edit-plan.json')) return 'editing';
  if (has('analysis.json')) return 'transcribed';
  return 'ingesting';
}

export function readProject(slug: string): ProjectStatus | null {
  const slugDir = path.join(TAKES_ROOT, slug);
  if (!fs.existsSync(slugDir)) return null;

  const statusPath = path.join(slugDir, 'status.json');
  let stored: Partial<ProjectStatus> & { stage?: Stage | LegacyStage } = {};
  if (fs.existsSync(statusPath)) {
    try {
      stored = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
    } catch {
      // ignore
    }
  }

  // Backfill: projects created before the category field default to
  // 'talking-head' so the existing sidebar shows them on the default tab.
  const category: Category =
    stored.category === 'long-form' ? 'long-form' : 'talking-head';

  // A recorded error wins over the file-derived stage, so a job that died
  // (killed transcription, failed clip proposal, missing API key, render
  // crash, …) surfaces as "Failed" instead of masquerading as
  // "Processing…" forever. `error` is cleared at the start of every
  // (re)run and on success, so a project only sits in 'error' until it's
  // re-processed. (Previously this checked stored.stage === 'error', which
  // the catch blocks never set — so failures were invisible.)
  // Precedence: a recorded error, then a pending human decision (the
  // unattended pipeline paused on a flag), then the file-derived stage.
  const stage: Stage = stored.error
    ? 'error'
    : stored.review?.required
      ? 'needs-review'
      : derivedStage(slugDir, slug, category);
  const hasThumb = fs.existsSync(path.join(slugDir, 'thumb.jpg'));
  const hasClipsProposal = fs.existsSync(path.join(slugDir, 'clips-proposal.json'));

  let updatedAt = stored.updatedAt ?? '';
  if (!updatedAt) {
    try {
      updatedAt = fs.statSync(slugDir).mtime.toISOString();
    } catch {
      updatedAt = new Date().toISOString();
    }
  }

  return {
    slug,
    stage,
    updatedAt,
    sourcePath: stored.sourcePath,
    durationSec: stored.durationSec,
    lineCount: stored.lineCount,
    takeCount: stored.takeCount,
    thumb: stored.thumb,
    outputPath: stored.outputPath,
    hasThumb,
    error: stored.error ?? null,
    category,
    sourceSlug: stored.sourceSlug,
    sourceClipId: stored.sourceClipId,
    hasClipsProposal,
    warnings: Array.isArray(stored.warnings) ? stored.warnings : undefined,
    review: stored.review ?? null,
  };
}

export function listProjects(): ProjectStatus[] {
  if (!fs.existsSync(TAKES_ROOT)) return [];
  const entries = fs.readdirSync(TAKES_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory());
  const projects = entries
    .map((e) => readProject(e.name))
    .filter((p): p is ProjectStatus => p !== null);
  projects.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return projects;
}

export function writeStatus(slug: string, patch: Partial<ProjectStatus>): void {
  const slugDir = path.join(TAKES_ROOT, slug);
  fs.mkdirSync(slugDir, { recursive: true });
  const statusPath = path.join(slugDir, 'status.json');
  let existing: Partial<ProjectStatus> = {};
  if (fs.existsSync(statusPath)) {
    try { existing = JSON.parse(fs.readFileSync(statusPath, 'utf-8')); } catch {}
  }
  const next = { ...existing, ...patch, slug, updatedAt: new Date().toISOString() };
  fs.writeFileSync(statusPath, JSON.stringify(next, null, 2));
}
