/**
 * /dashboard/editor — Edits-style video editor.
 *
 * Layout: everything fits inside one viewport. No scrolling required.
 *
 *   ┌───────────────────────────────────────────────────────┐
 *   │ Header                                                │ 44px
 *   ├──────────┬────────────────────────────────────────────┤
 *   │          │  Toolbar + Header form + Filler panel      │ ~100px
 *   │ Projects ├───────────────────────┬────────────────────┤
 *   │          │                       │                    │
 *   │ (upload) │   VideoPreview 9:16   │   Stats / Logs     │ flex:1
 *   │          │                       │                    │
 *   │          ├───────────────────────┴────────────────────┤
 *   │          │   Timeline (waveform + clips + captions)   │ ~200px
 *   └──────────┴────────────────────────────────────────────┘
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { C } from './components/brand';
import {
  ProjectList,
  type ProjectListEntry,
  type Category,
} from './components/ProjectList';
import { VideoPreview, type VideoPreviewHandle } from './components/VideoPreview';
import { Toolbar } from './components/Toolbar';
import { ExportDonePanel } from './components/ExportDonePanel';
import { HeaderConfigForm } from './components/HeaderConfigForm';
import { FillerWordsPanel } from './components/FillerWordsPanel';
import { Timeline } from './components/Timeline';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { CaptionStylePanel } from './components/CaptionStylePanel';
import { CustomSpellingsPanel } from './components/CustomSpellingsPanel';
import {
  DisfluencyReviewPanel,
  type DisfluencyProposal,
} from './components/DisfluencyReviewPanel';
import { LongFormView } from './components/LongFormView';
import { dashKey, useEditor } from './components/useEditor';
import { clipEditedMs } from '@/lib/editor/editPlan';
import type { ProcessStage, AuditSummary } from './components/Toolbar';
import { MobileSheet } from './components/MobileSheet';
import { MobileBottomNav } from './components/MobileBottomNav';

const SESSION_KEY = 'dashboard_authed';
const POLL_MS = 5000;

function isAuthed(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return false;
  try {
    return Date.now() < JSON.parse(stored).expiry;
  } catch {
    return false;
  }
}

type ProjectUIState = {
  rendering: boolean;
  renderLog: string[];
  renderProgress: { pct: number; phase: string } | null;
  processStage: ProcessStage;
  /** Queue position while processStage === 'queued'. 0 when running. */
  queuePosition: number;
  processError: string | null;
  processLog: string[];
  auditSummary: AuditSummary | null;
  proposal: DisfluencyProposal | null;
  approvedIds: Set<string>;
  previewingPolishCuts: boolean;
};

const DEFAULT_PROJECT_STATE: ProjectUIState = {
  rendering: false,
  renderLog: [],
  renderProgress: null,
  processStage: 'idle',
  queuePosition: 0,
  processError: null,
  processLog: [],
  auditSummary: null,
  proposal: null,
  approvedIds: new Set(),
  previewingPolishCuts: false,
};

export default function EditorPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectListEntry[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  // Always SSR as 'talking-head' to avoid a hydration mismatch: server
  // and client would disagree on which tab button has the active style
  // if we read localStorage in the initializer. After mount, sync to
  // the persisted tab choice.
  const [activeCategory, setActiveCategory] = useState<Category>('talking-head');
  useEffect(() => {
    try {
      const stored = localStorage.getItem('editor_category_tab');
      if (stored === 'long-form') setActiveCategory('long-form');
    } catch {}
  }, []);
  const onCategoryChange = useCallback((c: Category) => {
    setActiveCategory(c);
    try { localStorage.setItem('editor_category_tab', c); } catch {}
    // Drop the selection when switching tabs — the currently-selected
    // project probably isn't in the new tab. The useEffect below picks
    // the first project in the new tab once projects load.
    setSelectedSlug(null);
  }, []);

  // Per-project UI state. Everything here is tied to a specific slug's
  // pipeline run (render progress, process stage, audit results, polish
  // proposal) — kept in a slug-keyed map so switching between projects
  // shows the current state of the NEWLY-selected project, not leaked
  // state from the previous one. In-flight SSE streams snapshot the
  // slug at the top of their handler and continue to write to their
  // own slot even if the user switches away.
  const [projectStates, setProjectStates] = useState<Record<string, ProjectUIState>>({});
  const current = selectedSlug
    ? (projectStates[selectedSlug] ?? DEFAULT_PROJECT_STATE)
    : DEFAULT_PROJECT_STATE;
  const {
    rendering, renderLog, renderProgress,
    processStage, processError, processLog, auditSummary,
    proposal, approvedIds, previewingPolishCuts,
  } = current;
  const processing =
    processStage !== 'idle' &&
    processStage !== 'error' &&
    processStage !== 'done';

  // Map of slug → live ProcessStage for any project currently running
  // the pipeline. Fed to ProjectList so the sidebar row shows a progress
  // bar + phase label even when that project isn't selected.
  const processingBySlug = useMemo(() => {
    const m: Record<string, { stage: ProcessStage; queuePosition: number }> = {};
    for (const [slug, s] of Object.entries(projectStates)) {
      if (
        s.processStage !== 'idle' &&
        s.processStage !== 'error' &&
        s.processStage !== 'done'
      ) {
        m[slug] = { stage: s.processStage, queuePosition: s.queuePosition };
      }
    }
    return m;
  }, [projectStates]);

  const patchProject = useCallback(
    (slug: string, patch: Partial<ProjectUIState>) => {
      setProjectStates((prev) => ({
        ...prev,
        [slug]: { ...(prev[slug] ?? DEFAULT_PROJECT_STATE), ...patch },
      }));
    },
    [],
  );
  const updateProject = useCallback(
    (
      slug: string,
      updater: (s: ProjectUIState) => Partial<ProjectUIState>,
    ) => {
      setProjectStates((prev) => {
        const base = prev[slug] ?? DEFAULT_PROJECT_STATE;
        return { ...prev, [slug]: { ...base, ...updater(base) } };
      });
    },
    [],
  );

  const previewRef = useRef<VideoPreviewHandle>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const {
    plan, analysis, loading: editorLoading, saveError, reload: reloadEditor,
    lastAutoCut, selectedClipId, setSelectedClipId,
    selectedCaptionId, setSelectedCaptionId,
    playheadEditedMs, setPlayheadEditedMs,
    editedDurationMs, canUndo, canRedo, actions,
  } = useEditor(selectedSlug);

  useEffect(() => {
    if (!isAuthed()) router.replace('/dashboard');
  }, [router]);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Mobile (Edits-style) bottom-sheet selection. null = closed. Reset when
  // the selected project changes so a stale sheet never carries over.
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [showIgChrome, setShowIgChrome] = useState(false);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  useEffect(() => { setActiveSheet(null); }, [selectedSlug]);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/editor/projects', {
        headers: { 'x-dashboard-key': dashKey() },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      setProjects(data.projects ?? []);
    } finally {
      setLoadingProjects(false);
    }
  }, []);
  useEffect(() => {
    fetchProjects();
    const id = setInterval(fetchProjects, POLL_MS);
    return () => clearInterval(id);
  }, [fetchProjects]);

  // Deep link: /dashboard/editor?project=<slug> selects that project on
  // arrival (the pipeline health view links here). One-shot — after that,
  // selection is purely client state as before.
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current || projects.length === 0) return;
    deepLinkedRef.current = true;
    const wanted = new URLSearchParams(window.location.search).get('project');
    if (!wanted) return;
    const match = projects.find((p) => p.slug === wanted);
    if (!match) return;
    setActiveCategory(match.category ?? 'talking-head');
    setSelectedSlug(match.slug);
  }, [projects]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select the first project in the CURRENT category. Without this
  // filter the selection could land on a hidden project in the other
  // tab, which would render nothing in the workspace.
  useEffect(() => {
    if (selectedSlug) return;
    // On mobile, never auto-select — otherwise tapping "← Projects" instantly
    // re-selects the first reel and the project list can never show.
    if (isMobile) return;
    const inCategory = projects.filter(
      (p) => (p.category ?? 'talking-head') === activeCategory,
    );
    if (inCategory.length > 0) setSelectedSlug(inCategory[0].slug);
  }, [projects, selectedSlug, activeCategory, isMobile]);

  // Auto-resync captions when clip structure changes via reorder / split
  // / trim (where individual words may move across clip boundaries).
  // Delete uses an in-place cascade inside the editPlan reducer, so we
  // skip resync when the clip count dropped — the cascade already filtered
  // + shifted captions atomically.
  const lastClipCountRef = useRef<number>(-1);
  const lastClipsSigRef = useRef<string>('');
  useEffect(() => {
    if (!plan || !analysis || !analysis.hasWords) return;
    if (plan.captions.length === 0) return;
    const sig = plan.clips.map((c) => `${c.id}:${c.sourceStart.toFixed(3)}-${c.sourceEnd.toFixed(3)}`).join('|');
    const prevSig = lastClipsSigRef.current;
    const prevCount = lastClipCountRef.current;
    lastClipsSigRef.current = sig;
    lastClipCountRef.current = plan.clips.length;
    if (sig === prevSig) return;
    // A clip deletion cascade already handled captions; don't double-run.
    if (prevCount >= 0 && plan.clips.length < prevCount) return;
    const t = setTimeout(() => actions.resyncCaptions(), 150);
    return () => clearTimeout(t);
  }, [plan, analysis, actions]);

  // Auto-follow: as the playhead moves, point the caption override panel at
  // whichever caption is on screen. Yields to an explicit clip selection so
  // it doesn't fight the clip-follow effect below. (Keyboard caption actions
  // resolve the caption at the playhead directly, so they don't depend on
  // this.)
  useEffect(() => {
    if (!plan) return;
    if (selectedClipId) return;
    const active = plan.captions.find(
      (c) => playheadEditedMs >= c.startMs && playheadEditedMs <= c.endMs,
    );
    if (active && active.id !== selectedCaptionId) {
      setSelectedCaptionId(active.id);
    }
  }, [playheadEditedMs, plan, selectedClipId, selectedCaptionId, setSelectedCaptionId]);

  // Auto-follow: keep the clip under the playhead selected so the user
  // can hit Delete to drop it without first clicking the bar. After a
  // deletion the playhead lands on the neighbouring clip — which then
  // auto-selects — so delete-delete-delete workflows don't require the
  // mouse.
  //
  // Boundary bias: right. At a split boundary the playhead sits exactly
  // at editedMs = start-of-clip-N+1 = end-of-clip-N. We pick clip N+1 so
  // that right after a splitAt the user is holding the newly-cut-off
  // *back half*, which is the usual piece they want to inspect or drop.
  useEffect(() => {
    if (!plan || plan.clips.length === 0) return;
    let acc = 0;
    let hit: string | null = null;
    for (let i = 0; i < plan.clips.length; i++) {
      const c = plan.clips[i];
      const clipMs = clipEditedMs(c);
      const end = acc + clipMs;
      const isLast = i === plan.clips.length - 1;
      // Strict < on the trailing edge so boundary hits fall through to
      // the next clip; the last clip uses <= to catch end-of-timeline.
      if (playheadEditedMs >= acc && (isLast ? playheadEditedMs <= end : playheadEditedMs < end)) {
        hit = c.id;
        break;
      }
      acc = end;
    }
    if (hit && hit !== selectedClipId) {
      setSelectedClipId(hit);
    }
  }, [playheadEditedMs, plan, selectedClipId, setSelectedClipId]);

  const runProcess = useCallback(async (slug: string, approvedRangeIds?: string[]) => {
    if (!slug) return;
    // Slug is passed explicitly so this can be called from onUploaded
    // (before setSelectedSlug has re-rendered) as well as the manual
    // Process-video button. All SSE callbacks close over this local,
    // so progress keeps writing to the correct project slot even if
    // the user switches projects mid-process.
    patchProject(slug, {
      processStage: 'preparing',
      processError: null,
      processLog: [],
      auditSummary: null,
    });
    try {
      const init: RequestInit = {
        method: 'POST',
        headers: {
          'x-dashboard-key': dashKey(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          approvedRangeIds ? { approvedRangeIds } : {},
        ),
      };
      const res = await fetch(
        `/api/editor/project/${slug}/process`,
        init,
      );
      if (!res.ok || !res.body) {
        patchProject(slug, {
          processStage: 'error',
          processError: `process failed (${res.status})`,
        });
        return;
      }
      await consumeSSE(res.body, (ev, data) => {
        const msg = typeof data.msg === 'string' ? data.msg : null;
        if (ev === 'log' && msg) {
          updateProject(slug, (p) => ({
            processLog: [...p.processLog.slice(-300), msg],
          }));
        }
        if (ev === 'stage' && typeof data.name === 'string') {
          patchProject(slug, { processStage: data.name as ProcessStage });
          if (data.name !== 'queued') {
            patchProject(slug, { queuePosition: 0 });
          }
        }
        if (ev === 'queue' && typeof data.position === 'number') {
          patchProject(slug, { queuePosition: data.position });
        }
        if (ev === 'stage-stats' && typeof data.stage === 'string') {
          const s = data.stats as Record<string, unknown> | undefined;
          if (s) {
            const bits: string[] = [];
            if (typeof s.cutCount === 'number') bits.push(`${s.cutCount} cut`);
            if (typeof s.phrasesRemoved === 'number')
              bits.push(`${s.phrasesRemoved} phrases`);
            if (typeof s.secondsRemoved === 'number')
              bits.push(`-${Number(s.secondsRemoved).toFixed(2)}s`);
            if (bits.length > 0) {
              updateProject(slug, (p) => ({
                processLog: [
                  ...p.processLog.slice(-300),
                  `[${data.stage}] ${bits.join(' · ')}`,
                ],
              }));
            }
          }
        }
        if (ev === 'audit' && data && typeof data === 'object') {
          const s = data as Partial<Omit<AuditSummary, 'promoted'>> & {
            deepgram?: AuditSummary['deepgram'];
          };
          if (s && typeof s === 'object') {
            const statusRaw = s.status;
            const normalized: AuditSummary['status'] =
              statusRaw === 'clean' || statusRaw === 'warn' || statusRaw === 'fail'
                ? statusRaw
                : 'warn';
            updateProject(slug, (p) => ({
              auditSummary: {
                status: normalized,
                maxDriftMs: Number(s.maxDriftMs) || 0,
                meanDriftMs: Number(s.meanDriftMs) || 0,
                failCount: Number(s.failCount) || 0,
                warnCount: Number(s.warnCount) || 0,
                captionCount: Number(s.captionCount) || 0,
                promoted: p.auditSummary?.promoted ?? false,
                deepgram: s.deepgram ?? p.auditSummary?.deepgram ?? null,
              },
            }));
          }
        }
        if (ev === 'done') {
          const auditStatus = typeof data.auditStatus === 'string' ? data.auditStatus : 'clean';
          const out = typeof data.outputPath === 'string' ? data.outputPath : null;
          const promoted = data.promoted === true;
          const s = data.auditSummary as
            | (Partial<Omit<AuditSummary, 'promoted'>> & {
                deepgram?: AuditSummary['deepgram'];
              })
            | null
            | undefined;
          const newAudit =
            s && typeof s === 'object'
              ? (() => {
                  const statusRaw = s.status;
                  const normalized: AuditSummary['status'] =
                    statusRaw === 'clean' || statusRaw === 'warn' || statusRaw === 'fail'
                      ? statusRaw
                      : 'warn';
                  return {
                    status: normalized,
                    maxDriftMs: Number(s.maxDriftMs) || 0,
                    meanDriftMs: Number(s.meanDriftMs) || 0,
                    failCount: Number(s.failCount) || 0,
                    warnCount: Number(s.warnCount) || 0,
                    captionCount: Number(s.captionCount) || 0,
                    promoted,
                    deepgram: s.deepgram ?? null,
                  } satisfies AuditSummary;
                })()
              : null;
          updateProject(slug, (p) => ({
            processStage: 'done',
            processLog: [
              ...p.processLog,
              `DONE (audit=${auditStatus}${promoted ? ', promoted' : ''})${out ? ` → ${out}` : ''}`,
            ],
            ...(newAudit ? { auditSummary: newAudit } : {}),
          }));
          if (promoted) reloadEditor();
        }
        if (ev === 'error' && msg) {
          patchProject(slug, { processStage: 'error', processError: msg });
        }
      });
    } catch (e) {
      patchProject(slug, {
        processStage: 'error',
        processError: e instanceof Error ? e.message : String(e),
      });
    } finally {
      fetchProjects();
      setTimeout(
        () =>
          updateProject(slug, (p) => ({
            processStage: p.processStage === 'done' ? 'idle' : p.processStage,
          })),
        2000,
      );
    }
  }, [patchProject, updateProject, fetchProjects, reloadEditor]);

  const previewPolishCuts = useCallback(async () => {
    if (!selectedSlug) return;
    const slug = selectedSlug;
    patchProject(slug, { previewingPolishCuts: true, processError: null });
    try {
      const res = await fetch(
        `/api/editor/project/${slug}/polish/propose`,
        {
          method: 'POST',
          headers: { 'x-dashboard-key': dashKey() },
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        patchProject(slug, {
          processError: `Preview failed (${res.status}): ${body?.error ?? 'unknown error'}`,
        });
        return;
      }
      const p: DisfluencyProposal = {
        proposed: body.proposed ?? [],
        keptIds: body.keptIds ?? [],
        scopedSeconds: Number(body.scopedSeconds) || 0,
        wordCount: Number(body.wordCount) || 0,
        generatedAt: body.generatedAt ?? new Date().toISOString(),
      };
      patchProject(slug, { proposal: p, approvedIds: new Set(p.keptIds) });
    } catch (e) {
      patchProject(slug, {
        processError: e instanceof Error ? e.message : String(e),
      });
    } finally {
      patchProject(slug, { previewingPolishCuts: false });
    }
  }, [selectedSlug, patchProject]);

  const toggleApprovedId = useCallback(
    (id: string) => {
      if (!selectedSlug) return;
      const slug = selectedSlug;
      updateProject(slug, (p) => {
        const next = new Set(p.approvedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { approvedIds: next };
      });
    },
    [selectedSlug, updateProject],
  );

  const applyReviewedPolish = useCallback(async () => {
    if (!selectedSlug) return;
    const slug = selectedSlug;
    const ids = Array.from(approvedIds);
    patchProject(slug, { proposal: null, approvedIds: new Set() });
    await runProcess(slug, ids);
  }, [selectedSlug, approvedIds, patchProject, runProcess]);

  const cancelReviewedPolish = useCallback(() => {
    if (!selectedSlug) return;
    patchProject(selectedSlug, { proposal: null, approvedIds: new Set() });
  }, [selectedSlug, patchProject]);

  const promoteV2Anyway = useCallback(async () => {
    if (!selectedSlug) return;
    const slug = selectedSlug;
    try {
      const res = await fetch(`/api/editor/project/${slug}/promote-v2`, {
        method: 'POST',
        headers: { 'x-dashboard-key': dashKey() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        updateProject(slug, (p) => ({
          processLog: [
            ...p.processLog,
            `Promote failed (${res.status}): ${body?.error ?? 'unknown error'}`,
          ],
        }));
        return;
      }
      updateProject(slug, (p) => ({
        processLog: [
          ...p.processLog,
          `Promoted manually → ${body.outputPath ?? 'final.mp4'}`,
        ],
        auditSummary: null,
      }));
      reloadEditor();
      fetchProjects();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      updateProject(slug, (p) => ({
        processLog: [...p.processLog, `Promote error: ${m}`],
      }));
    }
  }, [selectedSlug, updateProject, reloadEditor, fetchProjects]);

  const runRender = useCallback(async () => {
    if (!selectedSlug) return;
    // Snapshot slug so SSE callbacks always write to this project's slot
    // even if the user switches to a different project mid-render.
    const slug = selectedSlug;
    patchProject(slug, {
      rendering: true,
      renderLog: [],
      renderProgress: { pct: 0, phase: 'starting' },
    });
    try {
      const res = await fetch(`/api/editor/project/${slug}/render`, {
        method: 'POST',
        headers: { 'x-dashboard-key': dashKey() },
      });
      if (!res.ok || !res.body) {
        updateProject(slug, (p) => ({
          renderLog: [...p.renderLog, `render failed: ${res.status}`],
        }));
        return;
      }
      await consumeSSE(res.body, (ev, data) => {
        const msg = typeof data.msg === 'string' ? data.msg : null;
        const out = typeof data.outputPath === 'string' ? data.outputPath : null;
        const q = typeof data.queuePath === 'string' ? data.queuePath : null;
        if (ev === 'log' && msg) {
          updateProject(slug, (p) => ({
            renderLog: [...p.renderLog.slice(-300), msg],
          }));
        }
        if (ev === 'progress' && typeof data.pct === 'number') {
          const phase = typeof data.phase === 'string' ? data.phase : 'rendering';
          patchProject(slug, { renderProgress: { pct: data.pct, phase } });
        }
        if (ev === 'done' && out) {
          updateProject(slug, (p) => ({
            renderProgress: { pct: 100, phase: 'done' },
            renderLog: [
              ...p.renderLog,
              `DONE → ${out}`,
              ...(q ? [`Queued → ${q}`] : []),
            ],
          }));
        }
        if (ev === 'error' && msg) {
          updateProject(slug, (p) => ({
            renderLog: [...p.renderLog, `ERROR: ${msg}`],
          }));
        }
      });
    } finally {
      patchProject(slug, { rendering: false });
      // Leave the final percentage visible for a moment; clear on next run.
      fetchProjects();
    }
  }, [selectedSlug, patchProject, updateProject, fetchProjects]);

  // Keyboard shortcuts. The full scheme is listed in <ShortcutsOverlay/>
  // (press ?). Editing keys call the same useEditor actions the mouse uses,
  // so they persist + undo identically. Clip keys (S/[/]/,/./Delete/reorder)
  // and caption keys (Enter/M/N) are modeless — each acts on whatever is under
  // the playhead, so there's nothing to toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      // Shortcuts overlay — works with or without a project loaded.
      if (e.key === '?') { e.preventDefault(); setShowShortcuts((s) => !s); return; }
      if (e.key === 'Escape' && showShortcuts) { e.preventDefault(); setShowShortcuts(false); return; }
      if (showShortcuts) return; // freeze edit keys while the cheatsheet is up
      if (!plan) return;

      const mod = e.metaKey || e.ctrlKey;
      const seek = (ms: number) => previewRef.current?.seekEditedMs(ms);

      // Undo / Redo.
      if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); actions.undo(); return; }
      if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); actions.redo(); return; }
      if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); actions.redo(); return; }

      // Reorder the clip at the playhead — Cmd/Ctrl+Shift+Arrow.
      if (mod && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        if (!selectedClipId) return;
        const idx = plan.clips.findIndex((c) => c.id === selectedClipId);
        if (idx === -1) return;
        const to = e.key === 'ArrowLeft' ? idx - 1 : idx + 1;
        if (to < 0 || to >= plan.clips.length) return;
        const ids = plan.clips.map((c) => c.id);
        [ids[idx], ids[to]] = [ids[to], ids[idx]];
        actions.reorderClips(ids);
        return;
      }

      // Heavy pipeline actions, behind Shift so a stray key can't fire them.
      if (e.shiftKey && !mod && (e.key === 'E' || e.key === 'e')) {
        e.preventDefault();
        if (!rendering) runRender();
        return;
      }
      if (e.shiftKey && !mod && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        if (!processing && selectedSlug) runProcess(selectedSlug);
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          previewRef.current?.togglePlay();
          return;
        case 'ArrowRight':
          e.preventDefault();
          previewRef.current?.nudge(e.altKey ? 100 : e.shiftKey ? 5000 : 1000);
          return;
        case 'ArrowLeft':
          e.preventDefault();
          previewRef.current?.nudge(e.altKey ? -100 : e.shiftKey ? -5000 : -1000);
          return;
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault();
          // Jump to previous / next clip boundary in edited time.
          const bounds = [0];
          let acc = 0;
          for (const c of plan.clips) { acc += clipEditedMs(c); bounds.push(acc); }
          const eps = 1;
          if (e.key === 'ArrowDown') {
            const nextB = bounds.find((b) => b > playheadEditedMs + eps);
            if (nextB != null) seek(nextB);
          } else {
            const prevB = [...bounds].reverse().find((b) => b < playheadEditedMs - eps);
            if (prevB != null) seek(prevB);
          }
          return;
        }
        case 'Home':
          e.preventDefault();
          seek(0);
          return;
        case 'End':
          e.preventDefault();
          seek(editedDurationMs);
          return;
        case 's':
        case 'S':
          e.preventDefault();
          actions.splitAt(playheadEditedMs);
          return;
        case 'Enter':
          // Edit the caption under the playhead. beginEditCaption resolves it
          // from the current time and no-ops if there's no caption there.
          e.preventDefault();
          previewRef.current?.beginEditCaption();
          return;
        case 'm':
        case 'M': {
          const cap = plan.captions.find(
            (c) => playheadEditedMs >= c.startMs && playheadEditedMs <= c.endMs,
          );
          if (cap) { e.preventDefault(); actions.mergeCaptionWithNext(cap.id); }
          return;
        }
        case 'n':
        case 'N': {
          e.preventDefault();
          // Insert a caption spanning the gap around the playhead (≤2.5s),
          // mirroring the timeline's double-click-to-insert behaviour.
          const ms = playheadEditedMs;
          const caps = [...plan.captions].sort((a, b) => a.startMs - b.startMs);
          let gapStart = 0;
          let gapEnd = editedDurationMs;
          for (const c of caps) {
            if (c.endMs <= ms && c.endMs > gapStart) gapStart = c.endMs;
            if (c.startMs >= ms && c.startMs < gapEnd) gapEnd = c.startMs;
          }
          if (gapEnd - gapStart < 120) return;
          const span = Math.min(2500, gapEnd - gapStart);
          const centre = Math.max(gapStart, Math.min(gapEnd, ms));
          const startMs = Math.max(gapStart, Math.min(centre - span / 2, gapEnd - span));
          const endMs = Math.min(gapEnd, startMs + span);
          actions.insertCaption(startMs, endMs, '');
          return;
        }
        case 'Delete':
        case 'Backspace':
          // Delete the clip at the playhead (the frequent cut). Captions are
          // removed via their on-chip × or by clearing their text.
          if (selectedClipId) { e.preventDefault(); actions.deleteClip(selectedClipId); }
          return;
      }

      // Bracket / comma / period trim the clip at the playhead. Uses e.code
      // because Shift rewrites the character (',' → '<'); Shift = coarser
      // 0.5s step, otherwise 0.1s.
      const step = e.shiftKey ? 0.5 : 0.1; // seconds
      if (selectedClipId) {
        const clip = plan.clips.find((c) => c.id === selectedClipId);
        if (!clip) return;
        const clampStart = (v: number) => Math.max(0, Math.min(clip.sourceEnd - 0.05, v));
        const clampEnd = (v: number) => Math.max(clip.sourceStart + 0.05, Math.min(plan.sourceDuration, v));
        switch (e.code) {
          case 'BracketLeft':  e.preventDefault(); actions.trimClip(clip.id, { sourceStart: clampStart(clip.sourceStart - step) }); return;
          case 'BracketRight': e.preventDefault(); actions.trimClip(clip.id, { sourceStart: clampStart(clip.sourceStart + step) }); return;
          case 'Comma':        e.preventDefault(); actions.trimClip(clip.id, { sourceEnd: clampEnd(clip.sourceEnd - step) }); return;
          case 'Period':       e.preventDefault(); actions.trimClip(clip.id, { sourceEnd: clampEnd(clip.sourceEnd + step) }); return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plan, actions, playheadEditedMs, selectedClipId, selectedCaptionId, editedDurationMs, rendering, processing, selectedSlug, runRender, runProcess, showShortcuts]);

  const selected = useMemo(
    () => projects.find((p) => p.slug === selectedSlug) ?? null,
    [projects, selectedSlug],
  );
  // Process needs a selected project; everything downstream (analysis,
  // clips, captions) is produced by the pipeline itself.
  const canProcess = !!selectedSlug && !processing;

  const clearProcessLog = useCallback(
    () => selectedSlug && patchProject(selectedSlug, { processLog: [] }),
    [selectedSlug, patchProject],
  );
  const clearRenderLog = useCallback(
    () => selectedSlug && patchProject(selectedSlug, { renderLog: [] }),
    [selectedSlug, patchProject],
  );
  const latestLog = processing
    ? { title: 'Processing', lines: processLog, active: true, onClear: clearProcessLog }
    : rendering
      ? { title: 'Rendering', lines: renderLog, active: true, onClear: clearRenderLog }
      : processLog.length > 0
        ? { title: 'Process log', lines: processLog, active: false, onClear: clearProcessLog }
        : renderLog.length > 0
          ? { title: 'Render log', lines: renderLog, active: false, onClear: clearRenderLog }
          : null;

  return (
    <main style={{
      height: isMobile ? 'calc(100dvh - 60px)' : 'calc(100vh - 60px)',
      overflow: 'hidden',
      color: C.white,
      fontFamily: 'var(--font-body)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <header style={{
        display: 'flex', alignItems: 'center',
        gap: isMobile ? 8 : 12,
        padding: isMobile ? '8px 12px' : '10px 18px',
        borderBottom: `1px solid ${C.border}`,
        flex: '0 0 auto',
        flexWrap: 'wrap',
      }}>
        {isMobile && selected && (
          <button onClick={() => setSelectedSlug(null)} style={navBtn}>← Projects</button>
        )}
        <span style={{
          color: C.purple, fontWeight: 600, fontSize: 11,
          letterSpacing: '0.35em', textTransform: 'uppercase',
          fontFamily: 'var(--font-ui)',
        }}>
          Editor
        </span>
        {plan && !isMobile && (
          <>
            <span style={{ color: C.silver, fontSize: 11, marginLeft: 8 }}>
              {plan.slug}
            </span>
            <span style={{ color: C.silver, fontSize: 11 }}>·</span>
            <span style={{ color: C.silver, fontSize: 11 }}>
              source {plan.sourceDuration.toFixed(1)}s · edited {(editedDurationMs / 1000).toFixed(1)}s · {plan.clips.length} clip{plan.clips.length === 1 ? '' : 's'} · {plan.captions.length} caption{plan.captions.length === 1 ? '' : 's'}
            </span>
          </>
        )}
        {plan && isMobile && (
          <span style={{ color: C.silver, fontSize: 11 }}>
            {(editedDurationMs / 1000).toFixed(1)}s · {plan.clips.length}c · {plan.captions.length}cap
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {saveError && (
            <span style={{ fontSize: 11, color: C.red }}>save: {saveError}</span>
          )}
          {!isMobile && (
            <span style={{ color: C.silver, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
              ␣ play · ←→ seek · S split · ↵ caption · ⌘Z undo · ? keys
            </span>
          )}
          <button onClick={fetchProjects} style={navBtn}>↻</button>
        </div>
      </header>

      <div style={{
        display: isMobile ? 'flex' : 'grid',
        flexDirection: isMobile ? 'column' : undefined,
        gridTemplateColumns: isMobile ? undefined : '280px 1fr',
        flex: 1,
        minHeight: 0,
      }}>
        {(!isMobile || !selected) && (
          <ProjectList
            projects={projects}
            selectedSlug={selectedSlug}
            onSelect={setSelectedSlug}
            onRefresh={fetchProjects}
            onUploaded={(slug, category) => {
              // If the uploader pushed into the other tab, follow it so
              // the user actually sees the project they just uploaded.
              if (category !== activeCategory) setActiveCategory(category);
              setSelectedSlug(slug);
              fetchProjects();
              // Auto-kick the pipeline so the user can walk away. The
              // /process endpoint branches on category server-side, so
              // the same call launches either the talking-head pipeline
              // or the long-form transcribe+diarize+propose pass.
              runProcess(slug);
            }}
            processingBySlug={processingBySlug}
            loading={loadingProjects}
            activeCategory={activeCategory}
            onCategoryChange={onCategoryChange}
            isMobile={isMobile}
          />
        )}

        <section style={{
          display: isMobile && !selected ? 'none' : 'flex',
          flex: isMobile ? 1 : undefined,
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 0,
        }}>
          {!selected && (
            <div style={{ padding: 40, color: C.silver, fontSize: 14, lineHeight: 1.6 }}>
              Click a project on the left to open it, or upload a new video to get started.
            </div>
          )}

          {/* Long-form projects get the clip-review view instead of the
              talking-head timeline. No Toolbar, no useEditor — just the
              source preview + ClipProposalPanel. */}
          {selected && selected.category === 'long-form' && (
            <LongFormView
              slug={selected.slug}
              durationSec={selected.durationSec}
              stage={selected.stage}
              error={selected.error}
              onRetry={() => runProcess(selected.slug)}
              onExtracted={(childSlugs) => {
                // Jump to the Talking Head tab so the user immediately
                // sees the newly-minted short-form projects. Select the
                // first extracted clip so its timeline loads.
                setActiveCategory('talking-head');
                try { localStorage.setItem('editor_category_tab', 'talking-head'); } catch {}
                if (childSlugs[0]) setSelectedSlug(childSlugs[0]);
                fetchProjects();
              }}
            />
          )}

          {selected && selected.category !== 'long-form' && !plan && editorLoading && (
            <div style={{ padding: 40, color: C.silver }}>Loading edit plan…</div>
          )}

          {selected && selected.category !== 'long-form' && plan && (
            isMobile ? (
              <>
                {/* MOBILE — Instagram Edits-style shell: big preview, a
                    horizontal scrubbing timeline, and a bottom tab bar whose
                    tabs open tool sheets (instead of a tall stacked column). */}
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                  <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, padding: '6px 8px' }}>
                    <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => setShowIgChrome((v) => !v)}
                        style={previewToggleBtn(showIgChrome)}
                        title="Preview with mock Instagram Reels chrome"
                      >
                        ▶ IG preview
                      </button>
                      <button
                        onClick={() => setShowSafeZones((v) => !v)}
                        style={previewToggleBtn(showSafeZones)}
                      >
                        ⛶ Safe area
                      </button>
                    </div>
                    <VideoPreview
                      ref={previewRef}
                      plan={plan}
                      editedDurationMs={editedDurationMs}
                      onPlayheadChange={setPlayheadEditedMs}
                      selectedCaptionId={selectedCaptionId}
                      onSelectCaption={(id) => { setSelectedCaptionId(id); setSelectedClipId(null); }}
                      onPatchCaptionStyle={(_id, patch) => { if (patch) actions.setCaptionStyle(patch); }}
                      onUpdateCaption={actions.updateCaption}
                      onSetEmphasizedWord={actions.setCaptionEmphasizedWord}
                      onUpdateHeader={(patch) => { if (plan.header) actions.setHeader({ ...plan.header, ...patch }); }}
                      selectedOverlayId={selectedOverlayId}
                      onSelectOverlay={setSelectedOverlayId}
                      onPatchOverlayStyle={actions.patchOverlayStyle}
                      showSafeZones={showSafeZones}
                      showIgChrome={showIgChrome}
                    />
                  </div>
                  <div style={{ flex: '0 0 auto', overflow: 'hidden', borderTop: `1px solid ${C.border}`, background: C.surface }}>
                    <Timeline
                      plan={plan}
                      editedDurationMs={editedDurationMs}
                      playheadEditedMs={playheadEditedMs}
                      selectedClipId={selectedClipId}
                      selectedCaptionId={selectedCaptionId}
                      onSeek={(ms) => previewRef.current?.seekEditedMs(ms)}
                      onScrubSource={(sec) => previewRef.current?.scrubSourceSec(sec)}
                      onSelectClip={(id) => { setSelectedClipId(id); setSelectedCaptionId(null); }}
                      onReorderClips={actions.reorderClips}
                      onTrimClip={actions.trimClip}
                      onSelectCaption={(id) => { setSelectedCaptionId(id); setSelectedClipId(null); }}
                      onUpdateCaption={actions.updateCaption}
                      onMoveCaption={actions.moveCaption}
                      onDeleteCaption={actions.deleteCaption}
                      onInsertCaption={actions.insertCaption}
                      onFlipRetake={actions.flipRetake}
                      onSetClipSpeed={actions.setClipSpeed}
                    />
                  </div>
                  <MobileBottomNav
                    tabs={[
                      { id: 'cut', label: 'Cut', glyph: '✂' },
                      { id: 'captions', label: 'Captions', glyph: 'CC' },
                      { id: 'words', label: 'Words', glyph: 'Aa', badge: proposal ? 1 : undefined },
                      { id: 'text', label: 'Text', glyph: 'T', badge: (plan.overlays?.length ?? 0) || undefined },
                      { id: 'header', label: 'Header', glyph: '▤' },
                    ]}
                    activeId={activeSheet}
                    onSelect={(id) => setActiveSheet((cur) => (cur === id ? null : id))}
                  />
                </div>

                <MobileSheet open={activeSheet === 'cut'} title="Cut & Process" onClose={() => setActiveSheet(null)}>
                  <Toolbar
                    hasSelectedClip={!!selectedClipId}
                    onSplit={() => actions.splitAt(playheadEditedMs)}
                    onDeleteClip={() => selectedClipId && actions.deleteClip(selectedClipId)}
                    onRender={runRender}
                    rendering={rendering}
                    renderProgress={renderProgress}
                    lastAutoCut={lastAutoCut}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    onUndo={actions.undo}
                    onRedo={actions.redo}
                    onProcess={() => selectedSlug && runProcess(selectedSlug)}
                    processing={processing}
                    processStage={processStage}
                    processError={processError}
                    onDismissProcessError={() =>
                      selectedSlug && patchProject(selectedSlug, { processError: null })
                    }
                    canProcess={canProcess}
                    auditSummary={auditSummary}
                    onPromoteAnyway={promoteV2Anyway}
                    onDismissAudit={() =>
                      selectedSlug && patchProject(selectedSlug, { auditSummary: null })
                    }
                    onPreviewPolishCuts={previewPolishCuts}
                    previewingPolishCuts={previewingPolishCuts}
                  />
                  {!rendering && renderProgress?.pct === 100 && selectedSlug && (
                    <ExportDonePanel slug={selectedSlug} playheadMs={playheadEditedMs} />
                  )}
                  {selectedClipId && (
                    <div style={{ marginTop: 12 }}>
                      <SelectionInfo
                        title="Clip selected"
                        hint="Tap Delete to remove it (captions inside go too). Drag on the timeline to reorder."
                      />
                    </div>
                  )}
                  {latestLog && (
                    <div style={{ marginTop: 12 }}>
                      <LogPanel
                        title={latestLog.title}
                        lines={latestLog.lines}
                        active={latestLog.active}
                        onClose={latestLog.onClear}
                      />
                    </div>
                  )}
                </MobileSheet>

                <MobileSheet open={activeSheet === 'captions'} title="Caption Style" onClose={() => setActiveSheet(null)}>
                  <CaptionStylePanel style={plan.captionStyle} onChange={actions.setCaptionStyle} />
                </MobileSheet>

                <MobileSheet open={activeSheet === 'words'} title="Words & Cleanup" onClose={() => setActiveSheet(null)}>
                  <FillerWordsPanel words={plan.fillerWords} />
                  {proposal && (
                    <div style={{ marginTop: 12 }}>
                      <DisfluencyReviewPanel
                        proposal={proposal}
                        approvedIds={approvedIds}
                        onToggle={toggleApprovedId}
                        onApply={applyReviewedPolish}
                        onCancel={cancelReviewedPolish}
                        applying={processing}
                      />
                    </div>
                  )}
                  <div style={{ marginTop: 12 }}>
                    <CustomSpellingsPanel spellings={plan.customSpellings ?? []} onChange={actions.setCustomSpellings} />
                  </div>
                </MobileSheet>

                <MobileSheet open={activeSheet === 'header'} title="Header" onClose={() => setActiveSheet(null)}>
                  <HeaderConfigForm header={plan.header} onChange={actions.setHeader} />
                </MobileSheet>

                <MobileSheet open={activeSheet === 'text'} title="Text Overlays" onClose={() => setActiveSheet(null)}>
                  <button
                    onClick={() => {
                      const start = playheadEditedMs;
                      const end = Math.min(start + 3000, editedDurationMs || start + 3000);
                      const id = actions.insertOverlay(start, end, 'Text');
                      if (id) setSelectedOverlayId(id);
                    }}
                    style={{ width: '100%', padding: 12, background: C.purple, color: C.white, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' }}
                  >
                    + Add text overlay
                  </button>
                  <div style={{ fontSize: 11, color: C.silver, marginTop: 8, lineHeight: 1.5 }}>
                    Added at the playhead for 3s. Drag it on the video to position; it burns into the exported MP4.
                  </div>
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(plan.overlays ?? []).length === 0 && (
                      <div style={{ fontSize: 12, color: C.silver }}>No text overlays yet.</div>
                    )}
                    {(plan.overlays ?? []).map((o) => {
                      const sel = selectedOverlayId === o.id;
                      const sizeMult = o.style?.fontSizeMultiplier ?? 1;
                      return (
                        <div key={o.id} style={{ border: `1px solid ${sel ? C.purple : C.border}`, borderRadius: 10, padding: 10, background: C.surface }}>
                          <input
                            value={o.text}
                            onChange={(e) => actions.updateOverlay(o.id, e.target.value)}
                            onFocus={() => setSelectedOverlayId(o.id)}
                            placeholder="Overlay text"
                            style={{ width: '100%', boxSizing: 'border-box', background: C.bg, color: C.white, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px', fontSize: 14 }}
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                            <button onClick={() => { previewRef.current?.seekEditedMs(o.startMs); setSelectedOverlayId(o.id); }} style={navBtn}>
                              ↪ {(o.startMs / 1000).toFixed(1)}s
                            </button>
                            <button onClick={() => actions.patchOverlayStyle(o.id, { fontSizeMultiplier: Math.max(0.6, sizeMult - 0.1) })} style={navBtn}>A−</button>
                            <button onClick={() => actions.patchOverlayStyle(o.id, { fontSizeMultiplier: Math.min(2.2, sizeMult + 0.1) })} style={navBtn}>A+</button>
                            <button
                              onClick={() => { actions.deleteOverlay(o.id); if (selectedOverlayId === o.id) setSelectedOverlayId(null); }}
                              style={{ ...navBtn, marginLeft: 'auto', color: C.red, borderColor: `${C.red}55` }}
                            >Delete</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </MobileSheet>
              </>
            ) : (
            <>
              {/* Top controls row */}
              <div style={{ flex: '0 0 auto' }}>
                <HeaderConfigForm header={plan.header} onChange={actions.setHeader} />
                <Toolbar
                  hasSelectedClip={!!selectedClipId}
                  onSplit={() => actions.splitAt(playheadEditedMs)}
                  onDeleteClip={() => selectedClipId && actions.deleteClip(selectedClipId)}
                  onRender={runRender}
                  rendering={rendering}
                  renderProgress={renderProgress}
                  lastAutoCut={lastAutoCut}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  onUndo={actions.undo}
                  onRedo={actions.redo}
                  onProcess={() => selectedSlug && runProcess(selectedSlug)}
                  processing={processing}
                  processStage={processStage}
                  processError={processError}
                  onDismissProcessError={() =>
                    selectedSlug && patchProject(selectedSlug, { processError: null })
                  }
                  canProcess={canProcess}
                  auditSummary={auditSummary}
                  onPromoteAnyway={promoteV2Anyway}
                  onDismissAudit={() =>
                    selectedSlug && patchProject(selectedSlug, { auditSummary: null })
                  }
                  onPreviewPolishCuts={previewPolishCuts}
                  previewingPolishCuts={previewingPolishCuts}
                />
                {!rendering && renderProgress?.pct === 100 && selectedSlug && (
                  <ExportDonePanel slug={selectedSlug} playheadMs={playheadEditedMs} />
                )}
              </div>

              {/* Middle: video preview + side panel */}
              <div style={{
                flex: isMobile ? '0 0 auto' : 1,
                minHeight: 0,
                display: isMobile ? 'flex' : 'grid',
                flexDirection: isMobile ? 'column' : undefined,
                gridTemplateColumns: isMobile ? undefined : '1fr 280px',
                background: C.bg,
                borderBottom: `1px solid ${C.border}`,
              }}>
                <div style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 0,
                  minWidth: 0,
                  padding: 8,
                  height: isMobile ? '70vh' : undefined,
                  flexShrink: 0,
                }}>
                  <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => setShowIgChrome((v) => !v)}
                      style={previewToggleBtn(showIgChrome)}
                      title="Preview with mock Instagram Reels chrome"
                    >
                      ▶ IG preview
                    </button>
                    <button
                      onClick={() => setShowSafeZones((v) => !v)}
                      style={previewToggleBtn(showSafeZones)}
                      title="Show Instagram UI safe-zone guides"
                    >
                      ⛶ Safe area
                    </button>
                  </div>
                  <VideoPreview
                    ref={previewRef}
                    plan={plan}
                    editedDurationMs={editedDurationMs}
                    onPlayheadChange={setPlayheadEditedMs}
                    selectedCaptionId={selectedCaptionId}
                    onSelectCaption={(id) => { setSelectedCaptionId(id); setSelectedClipId(null); }}
                    onPatchCaptionStyle={(_id, patch) => { if (patch) actions.setCaptionStyle(patch); }}
                    onUpdateCaption={actions.updateCaption}
                    onSetEmphasizedWord={actions.setCaptionEmphasizedWord}
                    onUpdateHeader={(patch) => { if (plan.header) actions.setHeader({ ...plan.header, ...patch }); }}
                    showSafeZones={showSafeZones}
                    showIgChrome={showIgChrome}
                  />
                </div>
                <aside style={{
                  borderLeft: isMobile ? 'none' : `1px solid ${C.border}`,
                  borderTop: isMobile ? `1px solid ${C.border}` : 'none',
                  background: C.surface,
                  padding: '10px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  minHeight: 0,
                  overflow: isMobile ? 'visible' : 'auto',
                }}>
                  <FillerWordsPanel words={plan.fillerWords} />

                  {/* Polish proposal — per-range review. Only shown while a
                      proposal is open (after "Preview cuts", before apply/cancel). */}
                  {proposal && (
                    <DisfluencyReviewPanel
                      proposal={proposal}
                      approvedIds={approvedIds}
                      onToggle={toggleApprovedId}
                      onApply={applyReviewedPolish}
                      onCancel={cancelReviewedPolish}
                      applying={processing}
                    />
                  )}

                  {/* Caption style — global */}
                  <CaptionStylePanel
                    style={plan.captionStyle}
                    onChange={actions.setCaptionStyle}
                  />

                  {/* Custom spellings — per-project corrections */}
                  <CustomSpellingsPanel
                    spellings={plan.customSpellings ?? []}
                    onChange={actions.setCustomSpellings}
                  />

                  {selectedClipId && (
                    <SelectionInfo
                      title="Clip selected"
                      hint="Press Delete to remove (captions inside it are removed too). Drag on the timeline to reorder."
                    />
                  )}

                  {latestLog && (
                    <LogPanel
                      title={latestLog.title}
                      lines={latestLog.lines}
                      active={latestLog.active}
                      onClose={latestLog.onClear}
                    />
                  )}
                  <div style={{ fontSize: 10, color: C.silver, letterSpacing: 0.5, lineHeight: 1.5 }}>
                    Tip: click a caption on the preview to drag, resize, or double-click to edit its text. Karaoke mode: click a word to emphasize it.
                  </div>
                </aside>
              </div>

              {/* Bottom: timeline */}
              <div style={{ flex: '0 0 auto', overflowX: isMobile ? 'auto' : 'visible' }}>
                <Timeline
                  plan={plan}
                  editedDurationMs={editedDurationMs}
                  playheadEditedMs={playheadEditedMs}
                  selectedClipId={selectedClipId}
                  selectedCaptionId={selectedCaptionId}
                  onSeek={(ms) => previewRef.current?.seekEditedMs(ms)}
                  onScrubSource={(sec) => previewRef.current?.scrubSourceSec(sec)}
                  onSelectClip={(id) => { setSelectedClipId(id); setSelectedCaptionId(null); }}
                  onReorderClips={actions.reorderClips}
                  onTrimClip={actions.trimClip}
                  onSelectCaption={(id) => { setSelectedCaptionId(id); setSelectedClipId(null); }}
                  onUpdateCaption={actions.updateCaption}
                  onMoveCaption={actions.moveCaption}
                  onDeleteCaption={actions.deleteCaption}
                  onInsertCaption={actions.insertCaption}
                  onFlipRetake={actions.flipRetake}
                  onSetClipSpeed={actions.setClipSpeed}
                />
              </div>
            </>
            )
          )}
        </section>
      </div>
      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
    </main>
  );
}

function SelectionInfo({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{
      background: `${C.gold}11`,
      border: `1px solid ${C.gold}55`,
      borderRadius: 8,
      padding: '8px 10px',
    }}>
      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: C.gold, fontWeight: 700 }}>
        {title}
      </div>
      <div style={{ fontSize: 11, color: C.silver, marginTop: 4, lineHeight: 1.5 }}>
        {hint}
      </div>
    </div>
  );
}

// Raw pipeline output, collapsed by default — the staged progress bars are
// the user-facing status; the log is a debug view you opt into. While a job
// runs, the header shows a live one-liner (last log line) so the panel still
// communicates without exposing the full firehose.
function LogPanel({ title, lines, onClose, active }: { title: string; lines: string[]; onClose: () => void; active: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';
  return (
    <div style={{
      background: '#0a0a14',
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
      fontSize: 10,
      color: C.silver,
      maxHeight: expanded ? 150 : undefined,
      overflow: expanded ? 'auto' : 'hidden',
      padding: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={() => setExpanded((s) => !s)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
            color: active ? C.gold : C.silver, fontSize: 9, letterSpacing: 1.5,
            textTransform: 'uppercase', fontWeight: 700,
          }}
        >
          {expanded ? '▾' : '▸'} {active ? '● ' : ''}{title}
        </button>
        {!expanded && lastLine && (
          <span style={{
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap', color: C.silver, opacity: 0.8,
          }}>
            {lastLine}
          </span>
        )}
        {expanded && (
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: `1px solid ${C.border}`,
              color: C.silver,
              borderRadius: 6,
              padding: '1px 6px',
              fontSize: 9,
              cursor: 'pointer',
            }}
          >
            clear
          </button>
        )}
      </div>
      {expanded && (
        <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {lines.slice(-20).join('\n')}
        </pre>
      )}
    </div>
  );
}

async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: Record<string, unknown>) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split('\n\n');
    buf = events.pop() ?? '';
    for (const evt of events) {
      const lines = evt.split('\n');
      const eventType = lines.find((l) => l.startsWith('event: '))?.slice(7) ?? 'message';
      const dataLine = lines.find((l) => l.startsWith('data: '))?.slice(6);
      if (!dataLine) continue;
      try {
        onEvent(eventType, JSON.parse(dataLine));
      } catch {}
    }
  }
}

/** Floating toggle over the video preview (Safe area / IG preview). */
function previewToggleBtn(active: boolean): React.CSSProperties {
  return {
    padding: '6px 10px',
    borderRadius: 8,
    background: active ? C.purple : 'rgba(13,13,24,0.72)',
    color: C.white,
    border: `1px solid ${active ? C.purple : C.border}`,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: 'uppercase',
    cursor: 'pointer',
    WebkitBackdropFilter: 'blur(4px)',
    backdropFilter: 'blur(4px)',
  };
}

const navBtn: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 8,
  background: 'transparent',
  border: `1px solid ${C.border}`,
  color: C.silver,
  cursor: 'pointer',
  fontFamily: 'var(--font-montserrat)',
  fontWeight: 600,
  fontSize: 10,
};
