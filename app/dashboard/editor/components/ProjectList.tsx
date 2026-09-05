'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C } from './brand';
import { dashKey } from './useEditor';
import {
  PROCESS_LABEL,
  overallPct,
  useProgressTick,
  type LiveProgress,
  type ProcessStage,
} from './Toolbar';
import type { InboxEntry } from '@/lib/editor/inbox';
import {
  useUploads,
  enqueueUploads,
  retryUpload,
  cancelUpload as cancelUploadJob,
  cancelAllUploads,
  dismissUpload,
  registerOnUploaded,
  type UploadJob,
} from './uploadManager';

export type Category = 'talking-head' | 'long-form';

export type ProjectListEntry = {
  slug: string;
  stage:
    | 'ingesting'
    | 'transcribed'
    | 'clips-proposed'
    | 'editing'
    | 'rendered'
    | 'stale'
    | 'error';
  updatedAt: string;
  durationSec?: number;
  hasThumb: boolean;
  error?: string | null;
  category: Category;
  sourceSlug?: string;
  hasClipsProposal?: boolean;
  /** True while a server-side pipeline job is running or queued for this slug. */
  active?: boolean;
  activeStage?: string | null;
  queuePosition?: number;
};

/** Category chosen at upload time. 'auto' lets the server pick by duration. */
export type UploadAs = Category | 'auto';
const UPLOAD_AS_KEY = 'editor_upload_as';

const STAGE_LABEL: Record<ProjectListEntry['stage'], string> = {
  ingesting: 'Processing…',
  transcribed: 'Ready to edit',
  'clips-proposed': 'Clips ready',
  editing: 'Editing',
  rendered: 'Exported',
  stale: 'Edited — re-export',
  error: 'Failed — open to retry',
};

const STAGE_COLOR: Record<ProjectListEntry['stage'], string> = {
  ingesting: C.silver,
  transcribed: C.purple,
  'clips-proposed': C.gold,
  editing: C.purple,
  rendered: C.gold,
  stale: C.red,
  error: C.red,
};

const TAB_STORAGE_KEY = 'editor_category_tab';

function fmtDuration(s?: number) {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

type Props = {
  projects: ProjectListEntry[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onRefresh: () => void;
  /**
   * Called with the uploaded slug and the category it was uploaded into.
   * The parent page uses this to kick off /process (which branches on
   * category server-side) and to make sure the sidebar is showing the
   * tab the new project landed in.
   */
  onUploaded: (slug: string, category: Category) => void;
  loading: boolean;
  // Live per-slug pipeline stage for any project currently processing.
  // When a slug appears here, the row shows a phase label + progress
  // bar overlay instead of the static server-derived stage badge. For
  // 'queued' entries, `queuePosition` drives the "Waiting #N" badge
  // so the user knows how many videos are ahead of this one.
  processingBySlug?: Record<string, { stage: ProcessStage; queuePosition: number; progress?: LiveProgress | null }>;
  /**
   * Controlled tab — when present, the parent decides which tab is
   * active (useful for switching into Talking Head after extracting
   * clips from a long-form project). Omit for purely local control.
   */
  activeCategory?: Category;
  onCategoryChange?: (c: Category) => void;
  /** Render the Instagram-Edits-style 2-column grid + upload FAB instead of the sidebar list. */
  isMobile?: boolean;
  /** Files the AirDrop watcher is still classifying (or skipped/errored) — not projects yet. */
  inbox?: InboxEntry[];
};

export function ProjectList(props: Props) {
  // Uploads live in the module-level uploadManager — byte progress, per-file
  // retry, and transfers that survive navigating away from this component.
  const uploads = useUploads();
  const anyProcessing = !!props.processingBySlug && Object.keys(props.processingBySlug).length > 0;
  const tick = useProgressTick(anyProcessing);
  const uploading = uploads.some(
    (u) => u.status === 'queued' || u.status === 'uploading' || u.status === 'stalled',
  );
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  // "Upload as" — chosen at enqueue time so a file never silently inherits
  // whichever tab happened to be open. Defaults to the active tab; 'auto'
  // lets the server pick long-form for anything ≥ 12 min.
  const [uploadAs, setUploadAs] = useState<UploadAs | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem(UPLOAD_AS_KEY);
      if (v === 'auto' || v === 'talking-head' || v === 'long-form') setUploadAs(v);
    } catch {}
  }, []);

  // Always SSR as 'talking-head' and sync from localStorage after mount
  // to avoid a hydration mismatch on the active-tab style.
  const [localCategory, setLocalCategory] = useState<Category>('talking-head');
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TAB_STORAGE_KEY);
      if (stored === 'long-form') setLocalCategory('long-form');
    } catch {}
  }, []);
  const category: Category = props.activeCategory ?? localCategory;
  const setCategory = useCallback((c: Category) => {
    if (props.onCategoryChange) {
      props.onCategoryChange(c);
    } else {
      setLocalCategory(c);
    }
    try { localStorage.setItem(TAB_STORAGE_KEY, c); } catch {}
  }, [props]);

  const filteredProjects = useMemo(
    () => props.projects.filter((p) => (p.category ?? 'talking-head') === category),
    [props.projects, category],
  );

  const unreviewedLongFormCount = useMemo(
    () => props.projects.filter((p) => p.category === 'long-form' && p.hasClipsProposal).length,
    [props.projects],
  );

  // Keep the manager's completion hook pointed at the LATEST onUploaded so
  // finished uploads auto-kick processing (page.tsx onUploaded → runProcess)
  // even for files that finished while this component was unmounted.
  useEffect(() => {
    registerOnUploaded((slug, cat) => props.onUploaded(slug, cat as Category));
  }, [props]);

  const effectiveUploadAs: UploadAs = uploadAs ?? category;
  const chooseUploadAs = useCallback((v: UploadAs) => {
    setUploadAs(v);
    try { localStorage.setItem(UPLOAD_AS_KEY, v); } catch {}
  }, []);
  const enqueue = useCallback((files: File[]) => {
    if (!files.length) return;
    enqueueUploads(files, effectiveUploadAs === 'auto' ? null : effectiveUploadAs);
  }, [effectiveUploadAs]);

  const onFilePicked = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    // Adding more files mid-batch is fine — they append to the queue.
    enqueue(files);
    e.currentTarget.value = '';
  }, [enqueue]);

  // Whole-panel drop target. Only react to real file drags (the timeline's
  // dnd-kit drags also bubble dragenter/dragover but carry no Files).
  const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    enqueue(files);
  }, [enqueue]);
  const dropHandlers = { onDragEnter, onDragOver, onDragLeave, onDrop };

  const cancelProcessing = useCallback(async (slug: string) => {
    setMenuFor(null);
    setBusySlug(slug);
    try {
      await fetch(`/api/editor/project/${slug}/cancel`, { method: 'POST', headers: { 'x-dashboard-key': dashKey() } });
      props.onRefresh();
    } finally {
      setBusySlug(null);
    }
  }, [props]);

  const moveCategory = useCallback(async (slug: string, to: Category) => {
    setMenuFor(null);
    setBusySlug(slug);
    try {
      const res = await fetch(`/api/editor/projects/${slug}`, {
        method: 'PATCH',
        headers: { 'x-dashboard-key': dashKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: to }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        window.alert(j.error ?? `Could not move project (HTTP ${res.status})`);
        return;
      }
      setCategory(to);
      props.onRefresh();
    } finally {
      setBusySlug(null);
    }
  }, [props, setCategory]);

  const deleteProject = useCallback(async (slug: string) => {
    setMenuFor(null);
    if (!window.confirm(`Move project "${slug}" to trash? The source video, analysis, edit plan, and renders go to my-video-projects/data/trash/ and can be restored by hand.`)) return;
    setDeleting(slug);
    try {
      await fetch(`/api/editor/projects/${slug}`, {
        method: 'DELETE',
        headers: { 'x-dashboard-key': dashKey() },
      });
      props.onRefresh();
    } finally {
      setDeleting(null);
    }
  }, [props]);

  const uploadHint = category === 'long-form'
    ? 'Drop a 30-60 min podcast or interview anywhere on this panel. I\u2019ll find viral clips. Large files resume if the connection drops.'
    : 'Drop one or more videos anywhere on this panel — they upload, then process one at a time. Or AirDrop to ~/Videos/Reels-Inbox/.';
  const uploadLabel = category === 'long-form' ? '\u2191 Upload long-form' : '\u2191 Upload video';

  // MOBILE — Instagram Edits-style project grid: 2-column thumbnail cards with
  // live pipeline progress, a batch-upload FAB, and an upload-progress banner.
  // Reuses every handler/state above; only the presentation differs.
  if (props.isMobile) {
    return (
      <div {...dropHandlers} style={{ position: 'relative', flex: 1, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column', background: C.bg }}>
        {dragOver && <DropOverlay />}
        <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, flex: '0 0 auto', background: C.bg }}>
          <TabButton active={category === 'talking-head'} onClick={() => setCategory('talking-head')} label="Talking Head" />
          <TabButton active={category === 'long-form'} onClick={() => setCategory('long-form')} label="Long-Form" badgeCount={unreviewedLongFormCount} />
        </div>

        <div style={{ flex: '0 0 auto', padding: '8px 14px', borderBottom: `1px solid ${C.border}` }}>
          <UploadAsControl value={effectiveUploadAs} onChange={chooseUploadAs} />
        </div>

        {uploads.length > 0 && (
          <div style={{ flex: '0 0 auto', borderBottom: `1px solid ${C.border}` }}>
            <UploadList uploads={uploads} compact onPickFile={() => fileInputRef.current?.click()} />
          </div>
        )}
        {!!props.inbox?.length && (
          <div style={{ flex: '0 0 auto', borderBottom: `1px solid ${C.border}`, padding: '8px 14px' }}>
            <InboxStrip entries={props.inbox} />
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 12 }}>
          {filteredProjects.length === 0 && !props.loading && (
            <div style={{ padding: 24, color: C.silver, fontSize: 13, lineHeight: 1.6, textAlign: 'center' }}>
              {category === 'long-form'
                ? 'No long-form sources yet. Tap + to upload a 30–60 min recording for clip proposals.'
                : 'No reels yet. Tap + to batch-import videos — they upload and auto-process.'}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {filteredProjects.map((p) => {
              const active = props.selectedSlug === p.slug;
              const liveEntry = props.processingBySlug?.[p.slug];
              const liveStage = liveEntry?.stage;
              const livePct = liveStage ? overallPct(liveStage, liveEntry?.progress ?? null, tick) : 0;
              const baseLabel = liveStage ? PROCESS_LABEL[liveStage] : null;
              const liveLabel = liveStage === 'queued' && liveEntry && liveEntry.queuePosition > 0
                ? `${baseLabel} #${liveEntry.queuePosition}`
                : baseLabel;
              const badgeColor = liveStage ? C.silver : STAGE_COLOR[p.stage];
              return (
                <button
                  key={p.slug}
                  onClick={() => props.onSelect(p.slug)}
                  style={{
                    position: 'relative', display: 'flex', flexDirection: 'column', textAlign: 'left',
                    background: C.surface, border: `1px solid ${active ? C.purple : C.border}`,
                    borderRadius: 12, overflow: 'hidden', padding: 0, cursor: 'pointer', color: C.white,
                  }}
                >
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '9 / 16', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {p.hasThumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/editor/thumb/${p.slug}?k=${encodeURIComponent(dashKey())}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: 22, color: C.silver }}>▦</span>
                    )}
                    {liveStage && (
                      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: `${C.silver}33` }}>
                        <div style={{ width: `${livePct}%`, height: '100%', background: C.purple, transition: 'width 300ms cubic-bezier(.2,.9,.3,1)' }} />
                      </div>
                    )}
                    <span
                      onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === p.slug ? null : p.slug); }}
                      style={{ position: 'absolute', top: 6, right: 6, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(13,13,24,0.7)', border: `1px solid ${C.border}`, borderRadius: 6, color: C.silver, fontSize: 15, lineHeight: 1 }}
                    >⋯</span>
                    {menuFor === p.slug && (
                      <RowMenu
                        project={p}
                        busy={busySlug === p.slug}
                        onCancel={() => cancelProcessing(p.slug)}
                        onMove={(to) => moveCategory(p.slug, to)}
                        onDelete={() => deleteProject(p.slug)}
                        onClose={() => setMenuFor(null)}
                      />
                    )}
                  </div>
                  <div style={{ padding: '8px 8px 10px' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.slug}</div>
                    <div style={{ display: 'inline-block', marginTop: 5, fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 700, color: badgeColor, border: `1px solid ${badgeColor}33`, background: `${badgeColor}11`, padding: '2px 6px', borderRadius: 4 }}>
                      {liveStage ? (liveStage === 'queued' ? liveLabel : `${liveLabel} · ${livePct}%`) : STAGE_LABEL[p.stage]}
                    </div>
                    <div style={{ fontSize: 10, color: C.silver, marginTop: 5 }}>{fmtDuration(p.durationSec)} · {fmtRelative(p.updatedAt)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={() => (uploading ? cancelAllUploads() : fileInputRef.current?.click())}
          aria-label={uploading ? 'Cancel uploads' : 'Upload videos'}
          style={{
            position: 'absolute', right: 16, bottom: 'calc(16px + env(safe-area-inset-bottom))',
            width: 56, height: 56, borderRadius: 28, background: C.purple, color: C.white,
            border: 'none', boxShadow: '0 6px 20px rgba(112,2,171,0.5)', fontSize: 28, lineHeight: '52px',
            cursor: 'pointer', zIndex: 20,
          }}
        >{uploading ? '✕' : '+'}</button>

        <input ref={fileInputRef} type="file" accept="video/*" multiple style={{ display: 'none' }} onChange={onFilePicked} />
      </div>
    );
  }

  return (
    <aside {...dropHandlers} style={{
      position: 'relative',
      borderRight: `1px solid ${C.border}`,
      background: C.surface,
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {dragOver && <DropOverlay />}
      {/* Category tabs */}
      <div style={{
        display: 'flex',
        borderBottom: `1px solid ${C.border}`,
        background: C.bg,
      }}>
        <TabButton
          active={category === 'talking-head'}
          onClick={() => setCategory('talking-head')}
          label="Talking Head"
        />
        <TabButton
          active={category === 'long-form'}
          onClick={() => setCategory('long-form')}
          label="Long-Form"
          badgeCount={unreviewedLongFormCount}
        />
      </div>

      {/* Upload / dropzone */}
      <div
        style={{
          padding: '16px 18px',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: 2, color: C.silver, textTransform: 'uppercase', marginBottom: 8 }}>
          {category === 'long-form' ? 'Long-Form Sources' : 'Projects'}
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: '100%',
            padding: '10px 12px',
            background: C.purple,
            color: C.white,
            border: 'none',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {uploadLabel}
        </button>
        <div style={{ marginTop: 8 }}>
          <UploadAsControl value={effectiveUploadAs} onChange={chooseUploadAs} />
        </div>
        <div style={{ fontSize: 11, color: C.silver, marginTop: 8, lineHeight: 1.5 }}>
          {uploadHint}
        </div>
        {uploads.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <UploadList uploads={uploads} onPickFile={() => fileInputRef.current?.click()} />
          </div>
        )}
        {!!props.inbox?.length && (
          <div style={{ marginTop: 10 }}>
            <InboxStrip entries={props.inbox} />
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          multiple
          style={{ display: 'none' }}
          onChange={onFilePicked}
        />
      </div>

      {/* Project list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filteredProjects.length === 0 && !props.loading && (
          <div style={{ padding: 24, color: C.silver, fontSize: 13, lineHeight: 1.5 }}>
            {category === 'long-form'
              ? 'No long-form sources yet. Upload a 30-60 min recording to get clip proposals.'
              : 'No projects yet. Upload a video to get started.'}
          </div>
        )}
        {filteredProjects.map((p) => {
          const active = props.selectedSlug === p.slug;
          const liveEntry = props.processingBySlug?.[p.slug];
          const liveStage = liveEntry?.stage;
          const livePct = liveStage ? overallPct(liveStage, liveEntry?.progress ?? null, tick) : 0;
          const baseLabel = liveStage ? PROCESS_LABEL[liveStage] : null;
          const liveLabel = liveStage === 'queued' && liveEntry && liveEntry.queuePosition > 0
            ? `${baseLabel} #${liveEntry.queuePosition}`
            : baseLabel;
          return (
            <div
              key={p.slug}
              style={{
                position: 'relative',
                borderBottom: `1px solid ${C.border}`,
                background: active ? C.surface2 : 'transparent',
              }}
            >
              <button
                onClick={() => props.onSelect(p.slug)}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 36px 12px 18px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: C.white,
                }}
              >
                <div style={{
                  width: 56, height: 100,
                  background: C.bg,
                  borderRadius: 8,
                  overflow: 'hidden',
                  flex: '0 0 auto',
                  border: `1px solid ${C.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, color: C.silver,
                }}>
                  {p.hasThumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/editor/thumb/${p.slug}?k=${encodeURIComponent(dashKey())}`}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : '—'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.slug}
                  </div>
                  <div style={{
                    display: 'inline-block',
                    marginTop: 4,
                    fontSize: 10, letterSpacing: 1, textTransform: 'uppercase',
                    color: liveStage ? C.silver : STAGE_COLOR[p.stage],
                    border: `1px solid ${liveStage ? C.silver : STAGE_COLOR[p.stage]}33`,
                    background: `${liveStage ? C.silver : STAGE_COLOR[p.stage]}11`,
                    padding: '2px 6px',
                    borderRadius: 8,
                    fontWeight: 700,
                  }}>
                    {liveStage
                      ? liveStage === 'queued'
                        ? liveLabel
                        : `${liveLabel} · ${livePct}%`
                      : STAGE_LABEL[p.stage]}
                  </div>
                  <div style={{ fontSize: 11, color: C.silver, marginTop: 4 }}>
                    {fmtDuration(p.durationSec)} · {fmtRelative(p.updatedAt)}
                  </div>
                </div>
              </button>
              {menuFor === p.slug && (
                <RowMenu
                  project={p}
                  busy={busySlug === p.slug}
                  onCancel={() => cancelProcessing(p.slug)}
                  onMove={(to) => moveCategory(p.slug, to)}
                  onDelete={() => deleteProject(p.slug)}
                  onClose={() => setMenuFor(null)}
                />
              )}
              <button
                onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === p.slug ? null : p.slug); }}
                disabled={deleting === p.slug}
                title="Project actions"
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  width: 24,
                  height: 24,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(13,13,24,0.6)',
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  color: C.silver,
                  cursor: deleting === p.slug ? 'wait' : 'pointer',
                  fontSize: 14, lineHeight: 1, padding: 0,
                  opacity: deleting === p.slug ? 0.5 : 0.85,
                }}
              >
                ⋯
              </button>
              {liveStage && (
                <div style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 3,
                  background: `${C.silver}33`,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${livePct}%`,
                    height: '100%',
                    background: C.silver,
                    transition: 'width 300ms cubic-bezier(.2,.9,.3,1)',
                  }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/** AirDrop inbox entries that are not projects yet (or never will be). */
function InboxStrip({ entries }: { entries: InboxEntry[] }) {
  const label = (e: InboxEntry) =>
    e.state === 'classifying' ? 'Classifying…'
    : e.state === 'auto-draft' ? `Auto-draft (${e.class ?? 'loop'})`
    : e.state === 'skipped' ? `Skipped: ${e.reason ?? 'no reason'}`
    : e.state === 'error' ? `Failed: ${e.reason ?? 'unknown'}`
    : e.state;
  const color = (e: InboxEntry) =>
    e.state === 'error' ? C.red : e.state === 'skipped' ? C.silver : e.state === 'classifying' ? C.purple : C.gold;
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: C.silver, marginBottom: 4 }}>
        AirDrop inbox
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries.slice(0, 6).map((e) => (
          <div key={e.file} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11 }}>
            <span style={{ flex: 1, minWidth: 0, color: C.white, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {e.file}
            </span>
            <span style={{ color: color(e), fontSize: 10, flexShrink: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {label(e)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DropOverlay() {
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 30, pointerEvents: 'none',
      background: `${C.purple}33`, border: `2px dashed ${C.purple}`, borderRadius: 8,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: C.white, fontSize: 14, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
    }}>
      Drop to upload
    </div>
  );
}

function UploadAsControl({ value, onChange }: { value: UploadAs; onChange: (v: UploadAs) => void }) {
  const opts: { v: UploadAs; label: string; title: string }[] = [
    { v: 'talking-head', label: 'Talking head', title: 'Cuts + captions + polish' },
    { v: 'long-form', label: 'Long-form', title: 'Transcribe + diarize + clip proposals' },
    { v: 'auto', label: 'Auto', title: 'Long-form if ≥ 12 min, else talking head' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: C.silver, flexShrink: 0 }}>Upload as</span>
      <div style={{ display: 'flex', flex: 1, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
        {opts.map((o) => (
          <button
            key={o.v}
            title={o.title}
            onClick={() => onChange(o.v)}
            style={{
              flex: 1, padding: '5px 4px', fontSize: 10, fontWeight: 700, cursor: 'pointer', border: 'none',
              background: value === o.v ? C.purple : 'transparent',
              color: value === o.v ? C.white : C.silver,
            }}
          >{o.label}</button>
        ))}
      </div>
    </div>
  );
}

function RowMenu({ project, busy, onCancel, onMove, onDelete, onClose }: {
  project: ProjectListEntry;
  busy: boolean;
  onCancel: () => void;
  onMove: (to: Category) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const other: Category = project.category === 'long-form' ? 'talking-head' : 'long-form';
  const item = (label: string, onClick: () => void, danger = false, disabled = false) => (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      disabled={disabled || busy}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12,
        background: 'transparent', border: 'none', color: danger ? C.red : C.white,
        cursor: disabled || busy ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
      }}
    >{label}</button>
  );
  return (
    <>
      <div onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', top: 36, right: 8, zIndex: 41, minWidth: 190,
          background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)', overflow: 'hidden',
        }}
      >
        {item('Cancel processing', onCancel, false, !project.active)}
        {item(other === 'long-form' ? 'Move to Long-Form' : 'Move to Talking Head', () => onMove(other), false, !!project.active)}
        {item('Move to trash…', onDelete, true)}
      </div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badgeCount,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badgeCount?: number;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '10px 8px',
        background: active ? C.surface : 'transparent',
        color: active ? C.white : C.silver,
        border: 'none',
        borderBottom: active ? `2px solid ${C.purple}` : `2px solid transparent`,
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        fontFamily: 'var(--font-montserrat), system-ui, sans-serif',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
      }}
    >
      {label}
      {badgeCount !== undefined && badgeCount > 0 && (
        <span style={{
          background: C.gold,
          color: C.bg,
          borderRadius: 8,
          padding: '1px 6px',
          fontSize: 9,
          fontWeight: 700,
          minWidth: 16,
          textAlign: 'center',
        }}>
          {badgeCount}
        </span>
      )}
    </button>
  );
}

// ── Upload list — per-file byte progress, ETA, stall + retry ──────────────────

function fmtMB(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1);
}

function fmtEta(sec: number | null) {
  if (sec === null) return '';
  if (sec < 60) return `${sec}s left`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s left`;
}

function UploadList({ uploads, compact, onPickFile }: { uploads: UploadJob[]; compact?: boolean; onPickFile?: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: compact ? '8px 14px' : 0 }}>
      {uploads.map((u) => {
        const active = u.status === 'uploading' || u.status === 'stalled' || u.status === 'finishing';
        const barColor =
          u.status === 'error' ? C.red
          : u.status === 'stalled' ? '#E0A030'
          : u.status === 'resumable' ? C.gold
          : u.status === 'done' ? 'var(--status-success-fg)'
          : C.purple;
        const statusLine =
          u.status === 'queued' ? 'Waiting…'
          : u.status === 'stalled' ? `Stalled at ${u.pct}% — still trying…`
          : u.status === 'uploading' ? `${fmtMB(u.sent)} / ${fmtMB(u.size)} MB · ${u.pct}%${u.etaSec !== null ? ` · ${fmtEta(u.etaSec)}` : ''}`
          : u.status === 'finishing' ? 'Assembling on the server…'
          : u.status === 'resumable' ? 'Interrupted — pick the same file again to resume'
          : u.status === 'done' ? 'Uploaded ✓'
          : u.status === 'canceled' ? 'Canceled'
          : `Failed: ${u.error ?? 'unknown error'}`;
        return (
          <div key={u.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600, color: C.white,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {u.name}
              </span>
              {u.status === 'resumable' && onPickFile && (
                <button
                  onClick={onPickFile}
                  style={{
                    background: 'none', border: `1px solid ${C.gold}`, color: C.gold,
                    borderRadius: 6, padding: '2px 8px', fontSize: 10, cursor: 'pointer', flexShrink: 0,
                  }}
                >Resume…</button>
              )}
              {(u.status === 'error' || u.status === 'canceled' || u.status === 'stalled') && (
                <button
                  onClick={() => retryUpload(u.id)}
                  style={{
                    background: 'none', border: `1px solid ${C.border}`, color: C.silver,
                    borderRadius: 6, padding: '2px 8px', fontSize: 10, cursor: 'pointer', flexShrink: 0,
                  }}
                >Retry</button>
              )}
              {active || u.status === 'queued' ? (
                <button
                  onClick={() => cancelUploadJob(u.id)}
                  aria-label={`Cancel ${u.name}`}
                  style={{
                    background: 'none', border: 'none', color: C.silver,
                    fontSize: 12, cursor: 'pointer', flexShrink: 0, padding: '0 2px',
                  }}
                >✕</button>
              ) : u.status !== 'done' ? (
                <button
                  onClick={() => dismissUpload(u.id)}
                  aria-label={`Dismiss ${u.name}`}
                  style={{
                    background: 'none', border: 'none', color: C.silver,
                    fontSize: 12, cursor: 'pointer', flexShrink: 0, padding: '0 2px',
                  }}
                >✕</button>
              ) : null}
            </div>
            <div style={{ height: 4, background: `${C.silver}22`, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${u.pct}%`, background: barColor,
                borderRadius: 2, transition: 'width 300ms ease',
              }} />
            </div>
            <span style={{ fontSize: 10, color: u.status === 'error' ? C.red : C.silver }}>
              {statusLine}
            </span>
          </div>
        );
      })}
    </div>
  );
}
