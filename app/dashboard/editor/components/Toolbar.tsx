'use client';

import { useEffect, useState } from 'react';
import { C } from './brand';
import type { AutoCutStats } from './useEditor';

/**
 * Every stage of the unified Process pipeline. The ordering matches the
 * server-side `/process` SSE stream (see app/api/editor/project/[slug]/
 * process/route.ts). `idle`, `done`, and `error` are terminal.
 */
export type ProcessStage =
  | 'idle'
  | 'queued'
  | 'preparing'
  | 'transcribing'
  | 'diarizing'
  | 'propose-clips'
  | 'silences'
  | 'fillers'
  | 'stutters'
  | 'captioning'
  | 'loading'
  | 'detecting'
  | 'polishing'
  | 'concatenating'
  | 'rendering'
  | 'auditing'
  | 'sync-auditing'
  | 'auto-correcting'
  | 'promoting'
  | 'done'
  | 'error';

/**
 * Compact audit result surfaced next to the Process button.
 * `promoted` records whether the Promote phase ran automatically; when
 * false and status === 'fail', the badge shows a "Promote anyway" escape
 * hatch. `deepgram` carries the independent Nova-3 drift numbers so the
 * user can see both Whisper and Deepgram verdicts at a glance.
 */
export type AuditSummary = {
  status: 'clean' | 'warn' | 'fail';
  maxDriftMs: number;
  meanDriftMs: number;
  failCount: number;
  warnCount: number;
  captionCount: number;
  promoted: boolean;
  deepgram?: {
    maxDriftMs: number;
    meanDriftMs: number;
    matchedCount: number;
    captionCount: number;
    autoCorrected: boolean;
    rewritten?: number;
  } | null;
};

type Props = {
  hasSelectedClip: boolean;
  onSplit: () => void;
  onDeleteClip: () => void;
  onRender: () => void;
  rendering: boolean;
  renderProgress: { pct: number; phase: string } | null;
  lastAutoCut: AutoCutStats | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;

  // Unified one-click pipeline.
  onProcess: () => void;
  processing: boolean;
  processStage: ProcessStage;
  /** Real within-stage progress (server `progress` events) + expected wall-clock. */
  processProgress?: LiveProgress | null;
  processError: string | null;
  onDismissProcessError: () => void;
  /** Aborts the running server-side job (frees the serial queue). */
  onCancelProcess?: () => void;
  canProcess: boolean;

  // Audit badge + promote-anyway escape hatch.
  auditSummary: AuditSummary | null;
  onPromoteAnyway: () => void;
  onDismissAudit: () => void;

  /**
   * Opt-in: "Preview cuts" runs the Claude disfluency detection only,
   * without rendering, so the user can approve/reject per-range before
   * committing to a full Process run.
   */
  onPreviewPolishCuts: () => void;
  previewingPolishCuts: boolean;
};

export function Toolbar(props: Props) {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      alignItems: 'center',
      padding: '12px 20px',
      background: C.surface,
      borderTop: `1px solid ${C.border}`,
      borderBottom: `1px solid ${C.border}`,
    }}>
      <button
        onClick={props.onUndo}
        disabled={!props.canUndo}
        style={{ ...iconBtn, opacity: props.canUndo ? 1 : 0.3 }}
        title="Undo (Cmd+Z)"
      >
        ↺
      </button>
      <button
        onClick={props.onRedo}
        disabled={!props.canRedo}
        style={{ ...iconBtn, opacity: props.canRedo ? 1 : 0.3 }}
        title="Redo (Cmd+Shift+Z)"
      >
        ↻
      </button>

      <button onClick={props.onSplit} style={secondaryBtn} title="Split the clip under the playhead (S)">
        ⤴ Split at playhead
      </button>
      <button
        onClick={props.onDeleteClip}
        disabled={!props.hasSelectedClip}
        style={{ ...secondaryBtn, opacity: props.hasSelectedClip ? 1 : 0.4 }}
        title="Delete the selected clip (Delete/Backspace)"
      >
        🗑 Delete clip
      </button>

      <div style={{ flex: 1 }} />

      {props.lastAutoCut && (
        <span style={{ fontSize: 11, color: C.silver, marginRight: 10 }}>
          Removed {props.lastAutoCut.removedSeconds.toFixed(1)}s ·{' '}
          {props.lastAutoCut.silenceCuts} silence ·{' '}
          {props.lastAutoCut.fillerCuts} filler
          {props.lastAutoCut.stutterCuts != null && props.lastAutoCut.stutterCuts > 0 && (
            <> · {props.lastAutoCut.stutterCuts} stutter</>
          )}
          {props.lastAutoCut.singleWordCuts != null && props.lastAutoCut.singleWordCuts > 0 && (
            <> · {props.lastAutoCut.singleWordCuts} repeat</>
          )}
          {props.lastAutoCut.fragmentCuts != null && props.lastAutoCut.fragmentCuts > 0 && (
            <> · {props.lastAutoCut.fragmentCuts} fragment</>
          )}
          {props.lastAutoCut.droppedTinyClips != null && props.lastAutoCut.droppedTinyClips > 0 && (
            <> · {props.lastAutoCut.droppedTinyClips} tiny</>
          )}
        </span>
      )}

      <button
        onClick={props.onPreviewPolishCuts}
        disabled={!props.canProcess || props.previewingPolishCuts || props.processing}
        style={{
          ...secondaryBtn,
          opacity: !props.canProcess || props.processing ? 0.4 : 1,
          cursor: props.previewingPolishCuts ? 'wait' : 'pointer',
        }}
        title="Run the disfluency detector only. Review each proposed cut before applying."
      >
        {props.previewingPolishCuts ? 'Scanning…' : '👁 Preview cuts'}
      </button>

      <ProcessButton
        stage={props.processStage}
        progress={props.processProgress ?? null}
        error={props.processError}
        running={props.processing}
        onClick={props.onProcess}
        onDismissError={props.onDismissProcessError}
        onCancel={props.onCancelProcess}
        disabled={!props.canProcess}
      />

      {props.auditSummary && (
        <AuditBadge
          summary={props.auditSummary}
          onPromoteAnyway={props.onPromoteAnyway}
          onDismiss={props.onDismissAudit}
        />
      )}

      <ExportButton
        onClick={props.onRender}
        rendering={props.rendering}
        progress={props.renderProgress}
      />
    </div>
  );
}

/**
 * ExportButton — gold primary with a progress-fill bar that advances
 * while the render route streams `progress` SSE events (cut → concat →
 * Remotion → copy to queue dir). Label switches to the current phase
 * + percentage so the user can tell when it's genuinely stalled.
 */
function ExportButton({
  onClick,
  rendering,
  progress,
}: {
  onClick: () => void;
  rendering: boolean;
  progress: { pct: number; phase: string } | null;
}) {
  const pct = progress ? progress.pct : 0;
  const phaseLabel = progress ? EXPORT_PHASE_LABEL[progress.phase] ?? 'Rendering' : 'Rendering';
  const label = rendering
    ? `${phaseLabel}… ${pct}%`
    : progress && progress.pct === 100
      ? '✓ Exported'
      : '📤 Export';
  return (
    <button
      onClick={onClick}
      disabled={rendering}
      title={
        rendering
          ? `${phaseLabel}… ${pct}%`
          : 'Render final MP4 and drop it into the Instagram queue'
      }
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: C.gold,
        color: C.bg,
        border: 'none',
        borderRadius: 8,
        padding: '8px 14px',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.5,
        cursor: rendering ? 'wait' : 'pointer',
        opacity: rendering ? 0.85 : 1,
        minWidth: 150,
      }}
    >
      {rendering && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            width: `${pct}%`,
            background: C.purple,
            opacity: 0.85,
            transition: 'width 300ms cubic-bezier(.2,.9,.3,1)',
          }}
        />
      )}
      <span style={{ position: 'relative', zIndex: 1 }}>{label}</span>
    </button>
  );
}

const EXPORT_PHASE_LABEL: Record<string, string> = {
  starting: 'Preparing',
  cutting: 'Cutting',
  concat: 'Concatenating',
  remotion: 'Rendering',
  done: 'Done',
};

/**
 * Weight map driving the progress-fill percentage for each stage. Chosen
 * so the bar feels roughly proportional to wall-clock time, with later
 * stages giving more progress because they take longer.
 */
export const PROCESS_PROGRESS: Record<ProcessStage, number> = {
  idle: 0,
  queued: 1,
  preparing: 3,
  transcribing: 20,
  diarizing: 30,
  'propose-clips': 80,
  silences: 25,
  fillers: 28,
  stutters: 32,
  captioning: 36,
  loading: 38,
  detecting: 42,
  polishing: 48,
  concatenating: 58,
  rendering: 74,
  auditing: 84,
  'sync-auditing': 90,
  'auto-correcting': 94,
  promoting: 98,
  done: 100,
  error: 0,
};

export type LiveProgress = {
  /** 0-100 within the current stage, or null when the stage emits none. */
  pct: number | null;
  stage: string;
  /** Expected wall-clock for this stage (server estimate), or null. */
  expectedMs: number | null;
  stageStartedAt: number;
};

const STAGE_ORDER = Object.keys(PROCESS_PROGRESS) as ProcessStage[];

/** Weight of the NEXT stage after `stage`, i.e. the top of its window. */
function nextStageWeight(stage: ProcessStage): number {
  const i = STAGE_ORDER.indexOf(stage);
  const cur = PROCESS_PROGRESS[stage];
  for (let k = i + 1; k < STAGE_ORDER.length; k++) {
    const w = PROCESS_PROGRESS[STAGE_ORDER[k]];
    if (w > cur) return w;
  }
  return 100;
}

/**
 * Overall 0-100 for the bar. The static stage weight is the floor of the
 * stage's window; real `progress` events (or, failing those, an elapsed-vs-
 * expected tween that asymptotes at 90% of the window) fill it. Before this
 * the bar sat at a fixed number for the whole multi-minute transcribe.
 */
export function overallPct(stage: ProcessStage, progress: LiveProgress | null, now: number = Date.now()): number {
  const base = PROCESS_PROGRESS[stage];
  if (stage === 'idle' || stage === 'error' || stage === 'done' || stage === 'queued') return base;
  const top = nextStageWeight(stage);
  const window = Math.max(0, top - base);
  if (!progress || progress.stage !== stage) return base;
  let frac: number;
  if (progress.pct !== null) {
    frac = Math.max(0, Math.min(1, progress.pct / 100));
  } else if (progress.expectedMs && progress.expectedMs > 0) {
    const elapsed = Math.max(0, now - progress.stageStartedAt);
    // 1 - e^(-t/T): reaches ~63% at T, ~86% at 2T, never 100%.
    frac = 0.9 * (1 - Math.exp(-elapsed / progress.expectedMs));
  } else {
    return base;
  }
  return Math.round(base + window * frac);
}

/** Seconds left for the current stage, from real pct or the expected time. */
export function stageEtaSec(progress: LiveProgress | null, now: number = Date.now()): number | null {
  if (!progress) return null;
  const elapsed = Math.max(0, now - progress.stageStartedAt);
  if (progress.pct !== null && progress.pct > 3) {
    const total = elapsed / (progress.pct / 100);
    return Math.max(0, Math.round((total - elapsed) / 1000));
  }
  if (progress.expectedMs) return Math.max(0, Math.round((progress.expectedMs - elapsed) / 1000));
  return null;
}

/** Re-render every second while a stage is being tweened. */
export function useProgressTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export const PROCESS_LABEL: Record<ProcessStage, string> = {
  idle: '✨ Process video',
  queued: 'Waiting',
  preparing: 'Preparing',
  transcribing: 'Transcribing',
  diarizing: 'Diarizing',
  'propose-clips': 'Proposing clips',
  silences: 'Silences',
  fillers: 'Fillers',
  stutters: 'Stutters',
  captioning: 'Captions',
  loading: 'Loading',
  detecting: 'Detecting',
  polishing: 'Polishing',
  concatenating: 'Concatenating',
  rendering: 'Rendering',
  auditing: 'Auditing',
  'sync-auditing': 'Sync-audit',
  'auto-correcting': 'Correcting',
  promoting: 'Promoting',
  done: 'Done',
  error: 'Error',
};

/**
 * ProcessButton — single one-click entry point for the full pipeline
 * (transcribe → silences → fillers → stutters → captions → polish →
 * render → audit → sync-audit → auto-correct → promote). The fill bar
 * advances as `stage` progresses.
 */
function ProcessButton({
  stage,
  progress,
  error,
  running,
  onClick,
  onDismissError,
  onCancel,
  disabled,
}: {
  stage: ProcessStage;
  progress: LiveProgress | null;
  error: string | null;
  running: boolean;
  onClick: () => void;
  onDismissError: () => void;
  onCancel?: () => void;
  disabled: boolean;
}) {
  const now = useProgressTick(running);
  const pct = overallPct(stage, progress, now);
  const eta = running ? stageEtaSec(progress, now) : null;
  const baseLabel = PROCESS_LABEL[stage];
  const label = running && stage !== 'queued'
    ? `${baseLabel} · ${pct}%${eta !== null && eta > 0 ? ` · ~${eta < 60 ? `${eta}s` : `${Math.round(eta / 60)}m`}` : ''}`
    : baseLabel;
  const isIdle = stage === 'idle';
  const isError = stage === 'error';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
      <button
        onClick={onClick}
        disabled={running || disabled}
        title={
          isIdle
            ? 'One-click pipeline: transcribe → remove silences → fillers → stutters → captions → polish → render → audit → Deepgram sync-check → auto-correct → promote.'
            : `${label}…`
        }
        style={{
          position: 'relative',
          overflow: 'hidden',
          background: isIdle ? C.purple : isError ? C.bg : C.surface2,
          color: C.white,
          border: isError ? `1px solid ${C.red}` : 'none',
          borderRadius: 8,
          padding: '8px 14px',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.5,
          cursor: running ? 'wait' : disabled ? 'not-allowed' : 'pointer',
          opacity: disabled && isIdle ? 0.4 : 1,
          minWidth: 190,
          marginRight: 8,
        }}
      >
        {!isIdle && !isError && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              width: `${pct}%`,
              background: stage === 'done' ? C.green : C.purple,
              opacity: 0.85,
              transition: 'width 300ms cubic-bezier(.2,.9,.3,1)',
            }}
          />
        )}
        <span style={{ position: 'relative', zIndex: 1 }}>{label}</span>
      </button>
      {running && onCancel && (
        <button
          onClick={onCancel}
          title="Stop this job and free the queue"
          style={{
            background: 'transparent', border: `1px solid ${C.border}`, color: C.silver,
            borderRadius: 8, padding: '0 10px', fontSize: 11, cursor: 'pointer', marginRight: 8,
          }}
        >Cancel</button>
      )}
      </div>
      {(isError || isIdle) && error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            maxWidth: 320,
            padding: '4px 8px',
            background: `${C.red}22`,
            border: `1px solid ${C.red}66`,
            borderRadius: 8,
            color: C.red,
            fontSize: 10,
            lineHeight: 1.3,
          }}
        >
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {error}
          </span>
          <button
            onClick={onDismissError}
            title="Dismiss"
            style={{
              background: 'transparent',
              border: 'none',
              color: C.red,
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * AuditBadge — pill shown next to ProcessButton after an audit run.
 * Surfaces both the Whisper drift summary and (when present) Deepgram's
 * independent Nova-3 verdict. Keeps the "Promote anyway" escape hatch
 * for the rare case that the user decides the audit is wrong.
 */
function AuditBadge({
  summary,
  onPromoteAnyway,
  onDismiss,
}: {
  summary: AuditSummary;
  onPromoteAnyway: () => void;
  onDismiss: () => void;
}) {
  const { status, maxDriftMs, failCount, warnCount, promoted, deepgram } = summary;
  const color =
    status === 'clean' ? C.green : status === 'warn' ? C.gold : C.red;
  const icon = status === 'clean' ? '✓' : status === 'warn' ? '⚠' : '✗';
  const detail =
    status === 'clean'
      ? `max ${maxDriftMs}ms`
      : status === 'warn'
        ? `max ${maxDriftMs}ms · ${warnCount} warn`
        : `max ${maxDriftMs}ms · ${failCount} fail`;
  const dgDetail = deepgram
    ? ` · DG ${deepgram.maxDriftMs}ms${deepgram.autoCorrected ? ` (rewrote ${deepgram.rewritten ?? 0})` : ''}`
    : '';
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        background: `${color}22`,
        border: `1px solid ${color}66`,
        borderRadius: 8,
        color,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.3,
      }}
      title={buildAuditTooltip(summary)}
    >
      <span>
        {icon} Audit · {detail}{dgDetail}
      </span>
      {status === 'fail' && !promoted && (
        <button
          onClick={onPromoteAnyway}
          title="Force-promote v2 into v1 slots despite audit failure"
          style={{
            background: color,
            color: C.bg,
            border: 'none',
            borderRadius: 8,
            padding: '3px 8px',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.4,
            cursor: 'pointer',
          }}
        >
          Promote anyway
        </button>
      )}
      <button
        onClick={onDismiss}
        title="Dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          color,
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          padding: 0,
          marginLeft: 2,
        }}
      >
        ×
      </button>
    </div>
  );
}

/**
 * Build a multi-line plain-English tooltip for the AuditBadge so anyone
 * (not just the engineer who wrote the pipeline) can read the summary.
 */
function buildAuditTooltip(summary: AuditSummary): string {
  const { status, maxDriftMs, meanDriftMs, failCount, warnCount, captionCount, deepgram } = summary;
  const lines: string[] = [];
  lines.push(`Audit summary — overall status: ${status.toUpperCase()}.`);
  lines.push('');
  lines.push(
    `max ${maxDriftMs}ms: largest gap between a caption start and the ` +
      `corresponding spoken word in the rendered video (Whisper-measured).`,
  );
  lines.push(`mean ${meanDriftMs}ms across ${captionCount} caption(s).`);
  if (failCount > 0) {
    lines.push(`${failCount} fail: caption(s) over the 300ms fail threshold.`);
  }
  if (warnCount > 0) {
    lines.push(`${warnCount} warn: caption(s) over the 150ms warn threshold.`);
  }
  if (deepgram) {
    lines.push('');
    lines.push(
      `DG ${deepgram.maxDriftMs}ms: same drift measurement done independently ` +
        `by Deepgram Nova-3 — a sanity check against Whisper.`,
    );
    if (deepgram.autoCorrected) {
      lines.push(
        `rewrote ${deepgram.rewritten ?? 0}: caption(s) whose timing/text was ` +
          `auto-corrected from Deepgram this run.`,
      );
    }
  }
  return lines.join('\n');
}

const primaryBtn: React.CSSProperties = {
  background: C.purple,
  color: C.white,
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.5,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  background: 'transparent',
  color: C.white,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const iconBtn: React.CSSProperties = {
  background: 'transparent',
  color: C.white,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  width: 34,
  height: 32,
  fontSize: 16,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
};
