/**
 * LongFormView — the workspace shown when a long-form project is
 * selected. Replaces the talking-head stack (Toolbar + VideoPreview +
 * Timeline + side panel) with:
 *
 *   ┌───────────────────────────────────────────────────────────┐
 *   │ Left: horizontal source preview with proposal markers on  │
 *   │       the seek bar (click a marker to jump there)         │
 *   ├───────────────────────────────────────────────────────────┤
 *   │ Right: ClipProposalPanel with checkbox rows + Extract     │
 *   └───────────────────────────────────────────────────────────┘
 *
 * State:
 *   - Fetches /clips-proposal on mount + when the slug changes
 *   - Tracks approved ids (checkboxes) and per-proposal extract status
 *   - POSTs to /extract-clips and streams SSE back into the log
 *   - After successful extract, notifies the parent so it can switch
 *     to the Talking Head tab and refresh the project list
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C } from './brand';
import { dashKey } from './useEditor';
import {
  ClipProposalPanel,
  type ClipProposal,
  type ExtractStatus,
} from './ClipProposalPanel';

type ClipsProposalFile = {
  generatedAt: string;
  model: string;
  sourceDurationSec: number;
  proposals: ClipProposal[];
  /** Total Whisper word count of the source. */
  wordCount?: number;
  /** Set only when there's essentially nothing to clip (very sparse speech). */
  note?: string;
};

type Props = {
  slug: string;
  durationSec?: number;
  /** Server-derived pipeline stage — drives the poll loop + Failed/Retry UI. */
  stage?: 'ingesting' | 'transcribed' | 'clips-proposed' | 'editing' | 'rendered' | 'error';
  /** Stored error message when the last run failed. */
  error?: string | null;
  /** Re-run the full /process pipeline for this project. */
  onRetry?: () => void;
  /**
   * Called after at least one clip extraction succeeds so the parent
   * page can refresh the project list + switch to the Talking Head
   * tab where the new clips live.
   */
  onExtracted: (childSlugs: string[]) => void;
};

const EMPTY_EXTRACT: ExtractStatus = {
  inFlight: false,
  perProposal: {},
  log: [],
  lastError: null,
};

export function LongFormView({ slug, durationSec, stage, error, onRetry, onExtracted }: Props) {
  const [proposalFile, setProposalFile] = useState<ClipsProposalFile | null>(null);
  const [loadingProposals, setLoadingProposals] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [regenerating, setRegenerating] = useState(false);
  const [extract, setExtract] = useState<ExtractStatus>(EMPTY_EXTRACT);
  const videoRef = useRef<HTMLVideoElement>(null);

  const fetchProposals = useCallback(async () => {
    setLoadingProposals(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/editor/project/${slug}/clips-proposal`, {
        headers: { 'x-dashboard-key': dashKey() },
        cache: 'no-store',
      });
      if (res.status === 404) {
        setProposalFile(null);
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setLoadError(body?.error ?? `failed (${res.status})`);
        return;
      }
      setProposalFile(body as ClipsProposalFile);
      setApprovedIds(new Set());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingProposals(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  // While the project is still working and we don't have proposals yet,
  // poll so the panel fills in on its own when processing finishes —
  // instead of forcing the user to reselect or refresh. Stops once
  // proposals land or the job has failed.
  useEffect(() => {
    if (proposalFile || stage === 'error') return;
    const id = setInterval(fetchProposals, 4000);
    return () => clearInterval(id);
  }, [proposalFile, stage, fetchProposals]);

  const onToggle = useCallback((id: string) => {
    setApprovedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onToggleAll = useCallback((all: boolean) => {
    setApprovedIds(() => {
      if (!all || !proposalFile) return new Set();
      return new Set(proposalFile.proposals.map((p) => p.id));
    });
  }, [proposalFile]);

  const onSeek = useCallback((sec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = sec;
    v.play().catch(() => {});
  }, []);

  const onRegenerate = useCallback(async () => {
    setRegenerating(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/editor/project/${slug}/propose-clips`, {
        method: 'POST',
        headers: { 'x-dashboard-key': dashKey() },
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setLoadError(body?.error ?? `regenerate failed (${res.status})`);
        return;
      }
      // Drain the SSE stream; we only care about completion here.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
        void decoder;
      }
      await fetchProposals();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegenerating(false);
    }
  }, [slug, fetchProposals]);

  const onExtract = useCallback(async () => {
    if (approvedIds.size === 0) return;
    const ids = Array.from(approvedIds);
    const initialPer: ExtractStatus['perProposal'] = {};
    for (const id of ids) initialPer[id] = { status: 'pending' };
    setExtract({
      inFlight: true,
      perProposal: initialPer,
      log: [],
      lastError: null,
    });

    try {
      const res = await fetch(`/api/editor/project/${slug}/extract-clips`, {
        method: 'POST',
        headers: {
          'x-dashboard-key': dashKey(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ proposalIds: ids }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setExtract((p) => ({
          ...p,
          inFlight: false,
          lastError: body?.error ?? `extract failed (${res.status})`,
        }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const extractedSlugs: string[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const evt of events) {
          const eLine = evt.split('\n').find((l) => l.startsWith('event: '));
          const dLine = evt.split('\n').find((l) => l.startsWith('data: '));
          if (!dLine) continue;
          const event = eLine?.slice(7) ?? 'message';
          let data: Record<string, unknown> = {};
          try { data = JSON.parse(dLine.slice(6)); } catch { continue; }

          if (event === 'log' && typeof data.msg === 'string') {
            const msg = data.msg;
            setExtract((p) => ({ ...p, log: [...p.log.slice(-40), msg] }));
          } else if (event === 'clip') {
            const proposalId = data.proposalId as string | undefined;
            const status = data.status as 'extracted' | 'failed' | undefined;
            const childSlug = data.childSlug as string | undefined;
            const error = data.error as string | undefined;
            if (proposalId && (status === 'extracted' || status === 'failed')) {
              if (childSlug) extractedSlugs.push(childSlug);
              setExtract((p) => ({
                ...p,
                perProposal: {
                  ...p.perProposal,
                  [proposalId]: { status, childSlug, error },
                },
              }));
            }
          } else if (event === 'done') {
            const slugs = (data.extractedSlugs as string[] | undefined) ?? extractedSlugs;
            setExtract((p) => ({ ...p, inFlight: false }));
            if (slugs.length > 0) onExtracted(slugs);
          } else if (event === 'error') {
            setExtract((p) => ({
              ...p,
              inFlight: false,
              lastError: (data.msg as string | undefined) ?? 'extract error',
            }));
          }
        }
      }
    } catch (e) {
      setExtract((p) => ({
        ...p,
        inFlight: false,
        lastError: e instanceof Error ? e.message : String(e),
      }));
    }
  }, [slug, approvedIds, onExtracted]);

  const markers = proposalFile?.proposals ?? [];
  const totalDur = proposalFile?.sourceDurationSec ?? durationSec ?? 0;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      height: '100%',
      minHeight: 0,
      background: C.bg,
    }}>
      {/* Left: video + markers */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: 14,
        gap: 10,
        minWidth: 0,
      }}>
        <div style={{
          flex: 1,
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          overflow: 'hidden',
          minHeight: 0,
        }}>
          <video
            ref={videoRef}
            src={`/api/editor/project/${slug}/source?k=${encodeURIComponent(dashKey())}`}
            controls
            style={{ maxWidth: '100%', maxHeight: '100%' }}
          />
        </div>

        {/* Proposal markers over a mini timeline */}
        <MarkerStrip
          markers={markers}
          totalDur={totalDur}
          approvedIds={approvedIds}
          onSeek={onSeek}
        />

        <div style={{ fontSize: 11, color: C.silver, lineHeight: 1.5 }}>
          {stage === 'error'
            ? 'Processing failed \u2014 use the panel on the right to retry.'
            : proposalFile
              ? (proposalFile.note ??
                  `Claude analyzed ${totalDur.toFixed(0)}s and proposed ${proposalFile.proposals.length} clip${proposalFile.proposals.length === 1 ? '' : 's'}.`)
              : loadingProposals
                ? 'Loading proposals\u2026'
                : 'No proposals yet. Processing might still be running \u2014 it\u2019ll appear here automatically.'}
        </div>
      </div>

      {/* Right: review panel */}
      <aside style={{
        width: 420,
        minWidth: 320,
        borderLeft: `1px solid ${C.border}`,
        background: C.surface,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}>
        {stage === 'error' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ color: C.red, fontSize: 13, fontWeight: 700 }}>Processing failed</div>
            <div style={{ color: C.silver, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {error || 'The pipeline stopped before clips could be proposed \u2014 the run was likely interrupted. Retry to start it again.'}
            </div>
            {onRetry && (
              <button
                onClick={onRetry}
                style={{
                  alignSelf: 'flex-start',
                  padding: '8px 14px',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  border: 'none',
                  background: C.purple,
                  color: C.white,
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-montserrat), system-ui, sans-serif',
                }}
              >
                {'\u21bb'} Retry processing
              </button>
            )}
          </div>
        ) : (
          <>
            {loadingProposals && !proposalFile && (
              <div style={{ color: C.silver, fontSize: 13 }}>Loading clip proposals{'\u2026'}</div>
            )}
            {loadError && (
              <div style={{ color: C.red, fontSize: 12, marginBottom: 8 }}>
                {loadError}
              </div>
            )}
            {proposalFile && (
              <ClipProposalPanel
                proposals={proposalFile.proposals}
                approvedIds={approvedIds}
                onToggle={onToggle}
                onToggleAll={onToggleAll}
                onSeek={onSeek}
                onExtract={onExtract}
                onRegenerate={onRegenerate}
                regenerating={regenerating}
                extract={extract}
                generatedAt={proposalFile.generatedAt}
                note={proposalFile.note}
              />
            )}
            {!loadingProposals && !proposalFile && !loadError && (
              <div style={{ color: C.silver, fontSize: 12, lineHeight: 1.5 }}>
                No proposals on disk yet. If a job is running they{'\u2019'}ll appear here automatically; otherwise hit Regenerate once the transcript is ready.
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

/**
 * Compact seekbar overlay showing proposal markers at their start
 * times. Click any marker to jump the video to that moment.
 */
function MarkerStrip({
  markers,
  totalDur,
  approvedIds,
  onSeek,
}: {
  markers: ClipProposal[];
  totalDur: number;
  approvedIds: Set<string>;
  onSeek: (sec: number) => void;
}) {
  const items = useMemo(() => {
    if (totalDur <= 0) return [];
    return markers.map((m) => ({
      id: m.id,
      leftPct: (m.startSec / totalDur) * 100,
      widthPct: Math.max(0.5, ((m.endSec - m.startSec) / totalDur) * 100),
      approved: approvedIds.has(m.id),
      title: m.title,
    }));
  }, [markers, totalDur, approvedIds]);

  return (
    <div style={{
      position: 'relative',
      height: 28,
      background: C.surface2,
      borderRadius: 8,
      border: `1px solid ${C.border}`,
      overflow: 'hidden',
    }}>
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => {
            const marker = markers.find((m) => m.id === it.id);
            if (marker) onSeek(marker.startSec);
          }}
          title={it.title}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${it.leftPct}%`,
            width: `${it.widthPct}%`,
            background: it.approved ? C.purple : `${C.violet}55`,
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            borderLeft: `1px solid ${it.approved ? C.white : C.violet}`,
          }}
        />
      ))}
    </div>
  );
}
