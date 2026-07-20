import * as fs from 'fs';
import * as path from 'path';
import { TAKES_ROOT, DRAFTS_DIR } from './paths';

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
  | 'rendered'
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
}

function derivedStage(slugDir: string, slug: string, category: Category): Stage {
  const has = (rel: string) => fs.existsSync(path.join(slugDir, rel));

  const renderedCandidates = [
    path.join(slugDir, 'final.mp4'),
    path.join(DRAFTS_DIR, `edits-${slug}.mp4`),
    path.join(DRAFTS_DIR, `talking-head-${slug}.mp4`),
    path.join(DRAFTS_DIR, 'talking-head.mp4'),
  ];
  if (renderedCandidates.some((p) => fs.existsSync(p))) return 'rendered';

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
  const stage = stored.error ? 'error' : derivedStage(slugDir, slug, category);
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
