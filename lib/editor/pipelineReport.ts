/**
 * pipelineReport.ts — per-project accuracy + timing telemetry.
 *
 * Every pipeline run writes data/takes/<slug>/pipeline-report.json as it goes
 * (partial on crash), so there is one place to answer: how long did each
 * stage take, what did the cut stages remove, what did the LLM propose vs.
 * keep, what did the audit measure, did it promote, and why did it pause.
 * Nothing aggregated this before — 28 audit.json files and 0 trendlines.
 *
 * `readStageHistory()` feeds the client-side ETA tween: the median
 * ms-per-source-second per stage across the last N reports.
 */
import * as fs from 'fs';
import * as path from 'path';
import { TAKES_ROOT } from './paths';

export const PIPELINE_VERSION = 5;

export type PipelineWarning = { stage: string; code: string; message: string; at?: string };

export type ReviewReason = {
  code: 'retake-flagged' | 'disfluency-long-rejected' | 'audit-fail' | 'hook-lint' | 'hook-low-score';
  detail: string;
  count?: number;
};

export type PipelineReport = {
  slug: string;
  runId: string;
  pipelineVersion: number;
  startedAt: string;
  finishedAt?: string;
  source: { durationSec?: number; codec?: string };
  transcript?: { wordCount: number; meanConfidence: number | null };
  stages: Record<string, { startedAt: string; ms?: number }>;
  cuts?: {
    silences?: number;
    fillers?: number;
    stutters?: number;
    retakes?: { groups: number; flagged: number; cut: number };
    secondsRemoved?: number;
  };
  disfluency?: {
    model: string | null;
    proposed: number;
    kept: number;
    rejectedByKind?: Record<string, number>;
    error?: string;
  };
  hook?: {
    model: string | null;
    candidates: number;
    chosen: string | null;
    type: string | null;
    score: number | null;
    applied: boolean;
    skippedBecause?: string;
  };
  audit?: {
    deepgramPre?: { maxDriftMs: number; meanDriftMs: number; matchedCount: number; captionCount: number } | null;
    deepgramPost?: { maxDriftMs: number; meanDriftMs: number; matchedCount: number; captionCount: number } | null;
    whisper?: { status: string; meanDriftMs?: number; maxDriftMs?: number } | null;
    gate?: { verdict: 'pass' | 'fail' | 'skipped'; by: 'deepgram' | 'whisper' | 'none'; reason: string };
  };
  review?: { paused: boolean; reasons: ReviewReason[] };
  promoted?: boolean;
  warnings: PipelineWarning[];
  error?: string;
};

export function reportPath(slug: string): string {
  return path.join(TAKES_ROOT, slug, 'pipeline-report.json');
}

export function readReport(slug: string): PipelineReport | null {
  try {
    const p = reportPath(slug);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as PipelineReport;
  } catch {
    return null;
  }
}

export class ReportWriter {
  readonly report: PipelineReport;
  private openStage: string | null = null;

  constructor(slug: string, source: PipelineReport['source'] = {}) {
    this.report = {
      slug,
      runId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      pipelineVersion: PIPELINE_VERSION,
      startedAt: new Date().toISOString(),
      source,
      stages: {},
      warnings: [],
    };
    this.flush();
  }

  /** Close the previous stage (recording ms) and open `name`. */
  stage(name: string): void {
    this.endStage();
    this.report.stages[name] = { startedAt: new Date().toISOString() };
    this.openStage = name;
    this.flush();
  }

  endStage(): void {
    if (!this.openStage) return;
    const st = this.report.stages[this.openStage];
    if (st && st.ms === undefined) st.ms = Date.now() - Date.parse(st.startedAt);
    this.openStage = null;
  }

  set<K extends keyof PipelineReport>(key: K, value: PipelineReport[K]): void {
    this.report[key] = value;
    this.flush();
  }

  merge<K extends 'cuts' | 'disfluency' | 'hook' | 'audit' | 'source'>(key: K, patch: Partial<NonNullable<PipelineReport[K]>>): void {
    this.report[key] = { ...(this.report[key] ?? {}), ...patch } as PipelineReport[K];
    this.flush();
  }

  warn(w: PipelineWarning): void {
    this.report.warnings.push({ ...w, at: new Date().toISOString() });
    this.flush();
  }

  finish(patch: Partial<PipelineReport> = {}): void {
    this.endStage();
    Object.assign(this.report, patch, { finishedAt: new Date().toISOString() });
    this.flush();
  }

  flush(): void {
    try {
      const p = reportPath(this.report.slug);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(`${p}.tmp`, JSON.stringify(this.report, null, 2));
      fs.renameSync(`${p}.tmp`, p);
    } catch {
      /* telemetry must never fail the pipeline */
    }
  }
}

/**
 * Per-stage ms-per-source-second samples from the newest `limit` reports.
 * Consumed by progressParse.expectedStageMs for the client ETA tween.
 */
export function readStageHistory(limit = 10): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  try {
    if (!fs.existsSync(TAKES_ROOT)) return out;
    const files = fs.readdirSync(TAKES_ROOT)
      .map((d) => reportPath(d))
      .filter((p) => fs.existsSync(p))
      .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);
    for (const { p } of files) {
      try {
        const r = JSON.parse(fs.readFileSync(p, 'utf-8')) as PipelineReport;
        const sec = r.source?.durationSec ?? 0;
        if (!(sec > 0)) continue;
        for (const [name, st] of Object.entries(r.stages ?? {})) {
          if (typeof st.ms === 'number' && st.ms > 0) (out[name] ??= []).push(st.ms / sec);
        }
      } catch { /* skip bad file */ }
    }
  } catch { /* ignore */ }
  return out;
}
