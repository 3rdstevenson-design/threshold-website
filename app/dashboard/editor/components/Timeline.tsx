/**
 * Timeline — three horizontal tracks:
 *   1. Waveform (decorative PNG background)
 *   2. Clips track — draggable-to-reorder via @dnd-kit; trim edges on hover
 *   3. Caption track — each caption chip; click to select, drag to move timing
 *
 * Playhead is an absolutely-positioned vertical line. Click anywhere on
 * the timeline to seek.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, PointerSensor, useSensor, useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, horizontalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { C } from './brand';
import { dashKey } from './useEditor';
import {
  clipEditedMs,
  clipSpeed,
  editedMsToSource,
  CLIP_SPEED_PRESETS,
} from '@/lib/editor/editPlan';
import type { Caption, Clip, EditPlan, RetakeGroup } from '@/lib/editor/editPlan';
import { snapValue } from '@/lib/editor/snap';
import { filmstripFrameBackground, filmstripFrameIndex } from '@/lib/editor/filmstrip';

const TRACK_HEIGHT = 32;
const CAPTION_HEIGHT = 24;
const WAVEFORM_HEIGHT = 36;
const TIMELINE_PADDING_LR = 12;
/** Drag snapping engages when a candidate lands within this many px. */
const SNAP_PX = 8;
/** Filmstrip tile width that keeps a 9:16 frame undistorted at TRACK_HEIGHT. */
const THUMB_W = Math.round(TRACK_HEIGHT * (9 / 16));

type Props = {
  plan: EditPlan;
  editedDurationMs: number;
  playheadEditedMs: number;
  selectedClipId: string | null;
  selectedCaptionId: string | null;
  onSeek: (editedMs: number) => void;
  onSelectClip: (clipId: string | null) => void;
  onReorderClips: (clipIds: string[]) => void;
  onTrimClip: (clipId: string, patch: { sourceStart?: number; sourceEnd?: number }) => void;
  onSelectCaption: (id: string | null) => void;
  onUpdateCaption: (id: string, text: string) => void;
  onMoveCaption: (id: string, deltaMs: number) => void;
  onDeleteCaption: (id: string) => void;
  onInsertCaption: (startMs: number, endMs: number, text?: string) => string | null;
  onFlipRetake?: (groupId: string, alternativeId: string) => void;
  onSetClipSpeed?: (clipId: string, speed: number) => void;
  /** Live scrub while a trim handle is dragged: the preview seeks to the
   *  candidate edge frame (in SOURCE seconds) so trimming is frame-accurate
   *  by eye, Edits-style — not just a ghost bar. */
  onScrubSource?: (sourceSec: number) => void;
};

const ZOOM_PRESETS = [0.5, 1, 2, 4] as const;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 16;

export function Timeline(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const baseTrackPx = useTimelineWidth(containerRef);

  // Zoom state — persisted per-slug so the editor remembers the chosen
  // zoom across reloads. Default 1x. localStorage is read in an effect
  // (not at useState init) to keep SSR/CSR markup identical. Continuous
  // (any positive number) so trackpad pinch-zoom can set intermediate
  // values — presets [0.5, 1, 2, 4] remain available via the buttons.
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const zoomKey = `editor-timeline-zoom:${props.plan.slug}`;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(zoomKey);
    if (!raw) return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= ZOOM_MIN && parsed <= ZOOM_MAX) {
      setZoomLevel(parsed);
    }
  }, [zoomKey]);
  const setZoom = useCallback((z: number) => {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    setZoomLevel(clamped);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(zoomKey, String(clamped));
    }
  }, [zoomKey]);

  const trackPx = baseTrackPx * zoomLevel;

  // Trackpad pinch-zoom on macOS arrives as `wheel` events with ctrlKey:true.
  // Anchor the zoom on the cursor position so the content under the cursor
  // stays visually pinned across the zoom transition. Native listener with
  // {passive:false} — React's SyntheticEvent can't preventDefault on wheel.
  useEffect(() => {
    const viewport = containerRef.current;
    if (!viewport) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const cursorViewportX = e.clientX - rect.left - TIMELINE_PADDING_LR;
      const cursorStageX = viewport.scrollLeft + cursorViewportX;
      const editedMs = props.editedDurationMs;
      const msAtCursor = trackPx === 0 || editedMs === 0 ? 0 : (cursorStageX / trackPx) * editedMs;

      const factor = Math.exp(-e.deltaY * 0.01);
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomLevel * factor));
      if (Math.abs(next - zoomLevel) < 1e-4) return;
      setZoom(next);

      // Restore cursor anchor after React commits the new trackPx.
      requestAnimationFrame(() => {
        const newTrackPx = baseTrackPx * next;
        if (editedMs === 0 || newTrackPx === 0) return;
        const newStageX = (msAtCursor / editedMs) * newTrackPx;
        viewport.scrollLeft = newStageX - cursorViewportX;
      });
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [baseTrackPx, trackPx, zoomLevel, props.editedDurationMs, setZoom]);

  // Two-finger pinch-zoom for touch (mobile). Mirrors the trackpad ctrl+wheel
  // path above and anchors on the pinch midpoint so content stays pinned.
  useEffect(() => {
    const viewport = containerRef.current;
    if (!viewport) return;
    let startDist = 0;
    let startZoom = zoomLevel;
    let anchorMs = 0;
    let anchorViewportX = 0;
    const fingerDist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      startDist = fingerDist(e.touches);
      startZoom = zoomLevel;
      const rect = viewport.getBoundingClientRect();
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      anchorViewportX = midX - rect.left - TIMELINE_PADDING_LR;
      const stageX = viewport.scrollLeft + anchorViewportX;
      anchorMs = trackPx === 0 || props.editedDurationMs === 0 ? 0 : (stageX / trackPx) * props.editedDurationMs;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || startDist === 0) return;
      e.preventDefault();
      const ratio = fingerDist(e.touches) / startDist;
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, startZoom * ratio));
      if (Math.abs(next - zoomLevel) < 1e-4) return;
      setZoom(next);
      requestAnimationFrame(() => {
        const newTrackPx = baseTrackPx * next;
        if (props.editedDurationMs === 0 || newTrackPx === 0) return;
        viewport.scrollLeft = (anchorMs / props.editedDurationMs) * newTrackPx - anchorViewportX;
      });
    };
    const onTouchEnd = (e: TouchEvent) => { if (e.touches.length < 2) startDist = 0; };
    viewport.addEventListener('touchstart', onTouchStart, { passive: false });
    viewport.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport.addEventListener('touchend', onTouchEnd);
    return () => {
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onTouchEnd);
    };
  }, [baseTrackPx, trackPx, zoomLevel, props.editedDurationMs, setZoom]);

  // Compute each clip's edited-time window and pixel position.
  const layout = useMemo(() => {
    let accMs = 0;
    const arr = props.plan.clips.map((c) => {
      const ms = clipEditedMs(c);
      const entry = { clip: c, startMs: accMs, endMs: accMs + ms, durMs: ms };
      accMs += ms;
      return entry;
    });
    return arr;
  }, [props.plan.clips]);

  const msToPx = useCallback(
    (ms: number) => {
      if (props.editedDurationMs === 0 || trackPx === 0) return 0;
      return (ms / props.editedDurationMs) * trackPx;
    },
    [props.editedDurationMs, trackPx],
  );

  const pxToMs = useCallback(
    (px: number) => {
      if (trackPx === 0) return 0;
      return Math.max(0, Math.min(props.editedDurationMs, (px / trackPx) * props.editedDurationMs));
    },
    [props.editedDurationMs, trackPx],
  );

  // Map each clip to the retake group whose KEPT take it contains (by
  // source-range midpoint). Alternates live on plan.retakeGroups, not in
  // clips[], so this containment check is how the UI finds where to badge.
  const retakeGroupByClipId = useMemo(() => {
    const map = new Map<string, RetakeGroup>();
    for (const g of props.plan.retakeGroups ?? []) {
      const kept = g.alternatives.find((a) => a.id === g.keptAlternativeId);
      if (!kept) continue;
      const mid = (kept.sourceStart + kept.sourceEnd) / 2;
      const holder = props.plan.clips.find(
        (c) => mid >= c.sourceStart && mid <= c.sourceEnd,
      );
      if (holder) map.set(holder.id, g);
    }
    return map;
  }, [props.plan.retakeGroups, props.plan.clips]);

  const selectedRetakeGroup = props.selectedClipId
    ? retakeGroupByClipId.get(props.selectedClipId) ?? null
    : null;

  const selectedClip = useMemo(
    () => props.plan.clips.find((c) => c.id === props.selectedClipId) ?? null,
    [props.plan.clips, props.selectedClipId],
  );

  // One request serves every clip thumbnail — the strip is sliced client-side.
  const filmstripUrl = `/api/editor/project/${props.plan.slug}/filmstrip?k=${encodeURIComponent(dashKey())}`;

  // Snap targets for trim drags, in SOURCE seconds: every clip boundary
  // plus every caption start mapped back to its source position.
  const clipSnapTargetsSec = useMemo(() => {
    const targets: number[] = [];
    for (const c of props.plan.clips) {
      targets.push(c.sourceStart, c.sourceEnd);
    }
    for (const cap of props.plan.captions) {
      const m = editedMsToSource(props.plan, cap.startMs);
      if (m) targets.push(m.sourceMs / 1000);
    }
    return targets;
  }, [props.plan]);

  // Snap targets for caption drags, in EDITED ms: clip boundaries plus
  // every caption's start/end (a chip excludes its own edges when snapping).
  const captionSnapTargetsMs = useMemo(() => {
    const targets: number[] = [0];
    let acc = 0;
    for (const c of props.plan.clips) {
      acc += clipEditedMs(c);
      targets.push(acc);
    }
    for (const cap of props.plan.captions) {
      targets.push(cap.startMs, cap.endMs);
    }
    return targets;
  }, [props.plan.clips, props.plan.captions]);

  const onTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Compute click position relative to the inner stage (which is what
    // msToPx/pxToMs operate on). The stage may be horizontally scrolled
    // when zoomed in, so we rely on the stage's own getBoundingClientRect.
    const stage = e.currentTarget;
    const rect = stage.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const clamped = Math.max(0, Math.min(trackPx, px));
    props.onSeek(pxToMs(clamped));
  }, [props, trackPx, pxToMs]);

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = props.plan.clips.findIndex((c) => c.id === active.id);
    const newIdx = props.plan.clips.findIndex((c) => c.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(props.plan.clips, oldIdx, newIdx);
    props.onReorderClips(reordered.map((c) => c.id));
  }, [props]);

  return (
    <div style={{ padding: '10px 20px 14px', background: C.bg, borderTop: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: C.silver, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>Timeline · {props.plan.clips.length} clip{props.plan.clips.length === 1 ? '' : 's'} · {fmtTime(props.editedDurationMs)}</span>
        <span style={{ fontSize: 9, color: C.silver, textTransform: 'none', letterSpacing: 0.5, opacity: 0.7, flex: 1 }}>
          click a clip to select · drag to reorder · click the timeline to seek
        </span>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <span style={{ fontSize: 9, opacity: 0.6, marginRight: 4 }}>zoom</span>
          <span
            style={{
              fontSize: 9,
              fontFamily: 'ui-monospace, SF Mono, monospace',
              color: C.silver,
              opacity: 0.7,
              marginRight: 2,
              minWidth: 32,
              textAlign: 'right',
            }}
            title="Pinch on the trackpad over the timeline to zoom"
          >{zoomLevel.toFixed(zoomLevel < 1 ? 2 : 1)}x</span>
          {ZOOM_PRESETS.map((z) => {
            const isActive = Math.abs(zoomLevel - z) < 0.05;
            return (
              <button
                key={z}
                onClick={() => setZoom(z)}
                style={{
                  padding: '2px 6px',
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: 'ui-monospace, SF Mono, monospace',
                  background: isActive ? C.gold : 'transparent',
                  color: isActive ? C.bg : C.silver,
                  border: `1px solid ${isActive ? C.gold : C.border}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                  letterSpacing: 0,
                }}
                title={`Zoom timeline to ${z}x (or pinch on trackpad)`}
              >{z}x</button>
            );
          })}
        </div>
      </div>
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: `10px ${TIMELINE_PADDING_LR}px`,
          userSelect: 'none',
          overflowX: zoomLevel > 1.001 ? 'auto' : 'hidden',
          overscrollBehaviorX: 'contain',
        }}
      >
        <div
          ref={scrollRef}
          onClick={onTimelineClick}
          style={{
            position: 'relative',
            width: trackPx > 0 ? trackPx : '100%',
            minWidth: '100%',
          }}
        >
          {/* Waveform background */}
          <div style={{ height: WAVEFORM_HEIGHT, marginBottom: 6, position: 'relative' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/editor/project/${props.plan.slug}/waveform?k=${encodeURIComponent(dashKey())}`}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'fill',
                opacity: 0.6,
                filter: 'saturate(1.1)',
              }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>

          {/* Clips track */}
          <div style={{ position: 'relative', height: TRACK_HEIGHT, marginBottom: 6 }}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={props.plan.clips.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
                <div style={{ display: 'flex', height: '100%', gap: 2 }}>
                  {layout.map(({ clip, durMs }) => (
                    <ClipBar
                      key={clip.id}
                      clip={clip}
                      width={msToPx(durMs)}
                      selected={props.selectedClipId === clip.id}
                      sourceDuration={props.plan.sourceDuration}
                      retakeGroup={retakeGroupByClipId.get(clip.id) ?? null}
                      filmstripUrl={filmstripUrl}
                      snapTargetsSec={clipSnapTargetsSec}
                      onSelect={() => props.onSelectClip(clip.id)}
                      onTrim={(patch) => props.onTrimClip(clip.id, patch)}
                      onScrubSource={props.onScrubSource}
                      containerPxToMs={pxToMs}
                      containerMsToPx={msToPx}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          {/* Caption track — single-click an empty gap seeks (bubbles to the
              timeline handler); double-click an empty gap inserts a new caption
              spanning that gap (capped at 2.5s centred on the click). */}
          <div
            style={{ position: 'relative', height: CAPTION_HEIGHT, cursor: 'copy' }}
            onDoubleClick={(e) => {
              if (e.target !== e.currentTarget) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const ms = pxToMs(e.clientX - rect.left);
              const caps = [...props.plan.captions].sort((a, b) => a.startMs - b.startMs);
              // Gap = [prev.endMs, next.startMs] around the click.
              let gapStart = 0;
              let gapEnd = props.editedDurationMs;
              for (const c of caps) {
                if (c.endMs <= ms && c.endMs > gapStart) gapStart = c.endMs;
                if (c.startMs >= ms && c.startMs < gapEnd) gapEnd = c.startMs;
              }
              if (gapEnd - gapStart < 120) return; // too tight to be useful
              const span = Math.min(2500, gapEnd - gapStart);
              const centre = Math.max(gapStart, Math.min(gapEnd, ms));
              const startMs = Math.max(gapStart, Math.min(centre - span / 2, gapEnd - span));
              const endMs = Math.min(gapEnd, startMs + span);
              props.onInsertCaption(startMs, endMs, '');
            }}
            title="Double-click an empty spot to insert a caption"
          >
            {props.plan.captions.map((c) => (
              <CaptionChip
                key={c.id}
                caption={c}
                left={msToPx(c.startMs)}
                width={Math.max(40, msToPx(c.endMs - c.startMs))}
                selected={props.selectedCaptionId === c.id}
                onSelect={() => props.onSelectCaption(c.id)}
                onUpdate={(text) => props.onUpdateCaption(c.id, text)}
                onMove={(deltaMs) => props.onMoveCaption(c.id, deltaMs)}
                onDelete={() => props.onDeleteCaption(c.id)}
                containerPxToMs={pxToMs}
                snapTargetsMs={captionSnapTargetsMs}
              />
            ))}
          </div>

          {/* Playhead — positioned via transform for GPU-accelerated motion,
              with a short linear transition so React-driven state updates
              interpolate smoothly between frames. */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 2,
              background: C.gold,
              pointerEvents: 'none',
              boxShadow: '0 0 6px rgba(201,168,76,0.6)',
              transform: `translate3d(${msToPx(props.playheadEditedMs)}px, 0, 0)`,
              transition: 'transform 60ms linear',
              willChange: 'transform',
            }}
          />
        </div>
      </div>
      {selectedClip && props.onSetClipSpeed && (
        <SpeedPanel
          clip={selectedClip}
          onSet={(speed) => props.onSetClipSpeed!(selectedClip.id, speed)}
        />
      )}
      {selectedRetakeGroup && props.onFlipRetake && (
        <RetakePanel
          group={selectedRetakeGroup}
          onFlip={(altId) => props.onFlipRetake!(selectedRetakeGroup.id, altId)}
        />
      )}
    </div>
  );
}

/**
 * Stepped per-clip speed control — shown when a clip is selected. The
 * presets match the ffmpeg render path (setpts + atempo), so what the
 * preview plays (via playbackRate) is what exports.
 */
function SpeedPanel({ clip, onSet }: { clip: Clip; onSet: (speed: number) => void }) {
  const current = clipSpeed(clip);
  return (
    <div
      style={{
        marginTop: 8,
        padding: '6px 10px',
        background: C.surface,
        border: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: C.silver }}>
        Clip speed
      </span>
      <div style={{ display: 'flex', gap: 2 }}>
        {CLIP_SPEED_PRESETS.map((s) => {
          const isActive = Math.abs(current - s) < 1e-9;
          return (
            <button
              key={s}
              onClick={() => onSet(s)}
              style={{
                padding: '3px 8px',
                fontSize: 10,
                fontWeight: 700,
                fontFamily: 'ui-monospace, SF Mono, monospace',
                background: isActive ? C.gold : 'transparent',
                color: isActive ? C.bg : C.silver,
                border: `1px solid ${isActive ? C.gold : C.border}`,
                borderRadius: 8,
                cursor: 'pointer',
              }}
              title={`Play this clip at ${s}x (captions retime automatically)`}
            >{s}x</button>
          );
        })}
      </div>
      <span style={{ fontSize: 9, color: C.silver, opacity: 0.7 }}>
        {(clip.sourceEnd - clip.sourceStart).toFixed(1)}s source → {(clipEditedMs(clip) / 1000).toFixed(1)}s on timeline
      </span>
    </div>
  );
}

/**
 * "Use this take instead" panel — shown when the selected clip is the
 * keeper of a retake group. Lists every detected take of the same line.
 */
function RetakePanel({ group, onFlip }: { group: RetakeGroup; onFlip: (altId: string) => void }) {
  return (
    <div
      style={{
        marginTop: 8,
        padding: '8px 10px',
        background: C.surface,
        border: `1px solid ${group.flagged ? C.gold : C.border}`,
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: group.flagged ? C.gold : C.silver, marginBottom: 6 }}>
        {group.alternatives.length} takes of this line
        {group.flagged ? ` · needs review — ${group.reason}` : ''}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {group.alternatives.map((alt, i) => {
          const isKept = alt.id === group.keptAlternativeId;
          return (
            <div
              key={alt.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 6px',
                background: isKept ? 'rgba(201,168,76,0.12)' : 'transparent',
                border: `1px solid ${isKept ? C.gold : 'transparent'}`,
              }}
            >
              <span style={{ fontSize: 10, fontFamily: 'ui-monospace, SF Mono, monospace', color: C.silver, minWidth: 52 }}>
                take {i + 1} · {(alt.sourceEnd - alt.sourceStart).toFixed(1)}s
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 11,
                  color: C.white,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={alt.transcript}
              >
                “{alt.transcript}”
              </span>
              {typeof alt.meanConfidence === 'number' && (
                <span style={{ fontSize: 9, color: C.silver, opacity: 0.7 }}>
                  {(alt.meanConfidence * 100).toFixed(0)}%
                </span>
              )}
              {isKept ? (
                <span style={{ fontSize: 9, fontWeight: 700, color: C.gold, letterSpacing: 1 }}>KEPT</span>
              ) : (
                <button
                  onClick={() => onFlip(alt.id)}
                  style={{
                    padding: '2px 8px',
                    fontSize: 10,
                    fontWeight: 700,
                    background: 'transparent',
                    color: C.gold,
                    border: `1px solid ${C.gold}`,
                    cursor: 'pointer',
                  }}
                  title="Swap this take onto the timeline in place of the kept one"
                >use this take</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type TrimLive = {
  edge: 'start' | 'end';
  /** Cursor px delta, post-snap, in timeline (edited) px. */
  deltaPx: number;
  /** Candidate boundary in source seconds (clamped + snapped). */
  candidateSec: number;
  snapped: boolean;
};

function ClipBar({
  clip, width, selected, sourceDuration, retakeGroup, filmstripUrl, snapTargetsSec,
  onSelect, onTrim, onScrubSource, containerPxToMs, containerMsToPx,
}: {
  clip: Clip;
  width: number;
  selected: boolean;
  sourceDuration: number;
  retakeGroup: RetakeGroup | null;
  filmstripUrl: string;
  snapTargetsSec: number[];
  onSelect: () => void;
  onTrim: (patch: { sourceStart?: number; sourceEnd?: number }) => void;
  onScrubSource?: (sourceSec: number) => void;
  containerPxToMs: (px: number) => number;
  containerMsToPx: (ms: number) => number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: clip.id });
  const dur = clip.sourceEnd - clip.sourceStart;
  const speed = clipSpeed(clip);
  const resizeState = useRef<{ edge: 'start' | 'end'; startX: number; accPx: number } | null>(null);
  const [liveDelta, setLiveDelta] = useState<TrimLive | null>(null);

  // Turn a cursor px delta into the trimmed edge's candidate source
  // position: px → edited ms → source sec (× speed), clamp to the legal
  // range, then snap to nearby clip boundaries / caption starts.
  const computeTrim = useCallback((edge: 'start' | 'end', accPx: number): TrimLive => {
    const deltaSec = (containerPxToMs(Math.abs(accPx)) * (accPx < 0 ? -1 : 1) / 1000) * speed;
    const base = edge === 'start' ? clip.sourceStart : clip.sourceEnd;
    const clamp = (v: number) =>
      edge === 'start'
        ? Math.max(0, Math.min(clip.sourceEnd - 0.05, v))
        : Math.max(clip.sourceStart + 0.05, Math.min(sourceDuration, v));
    const candidate = clamp(base + deltaSec);
    const tolSec = (containerPxToMs(SNAP_PX) / 1000) * speed;
    const snap = snapValue(candidate, snapTargetsSec, tolSec, [base]);
    const finalSec = clamp(snap.value);
    // Ghost feedback tracks the (possibly snapped) candidate, not the raw cursor.
    const deltaPx = containerMsToPx(((finalSec - base) / speed) * 1000);
    return { edge, deltaPx, candidateSec: finalSec, snapped: snap.snapped && finalSec === snap.value };
  }, [clip.sourceStart, clip.sourceEnd, sourceDuration, speed, snapTargetsSec, containerPxToMs, containerMsToPx]);

  const beginResize = (edge: 'start' | 'end') => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeState.current = { edge, startX: e.clientX, accPx: 0 };
    const live = computeTrim(edge, 0);
    setLiveDelta(live);
    // Scrub the preview to the edge frame so the trim is judged on the
    // actual video, not just the ghost bar.
    onScrubSource?.(live.candidateSec);
  };
  const duringResize = (e: React.PointerEvent) => {
    if (!resizeState.current) return;
    e.stopPropagation();
    resizeState.current.accPx = e.clientX - resizeState.current.startX;
    const live = computeTrim(resizeState.current.edge, resizeState.current.accPx);
    setLiveDelta(live);
    onScrubSource?.(live.candidateSec);
  };
  const endResize = (e: React.PointerEvent) => {
    if (!resizeState.current) return;
    e.stopPropagation();
    const { edge, accPx } = resizeState.current;
    resizeState.current = null;
    setLiveDelta(null);
    const { candidateSec } = computeTrim(edge, accPx);
    if (edge === 'start') {
      if (Math.abs(candidateSec - clip.sourceStart) >= 0.01) onTrim({ sourceStart: candidateSec });
    } else {
      if (Math.abs(candidateSec - clip.sourceEnd) >= 0.01) onTrim({ sourceEnd: candidateSec });
    }
  };

  // Preview the dragged edge while resizing — a thin bar that slides with
  // the cursor (gold) and locks white when magnetically snapped, plus a
  // ghost frame of the source at the candidate trim point.
  const ghostBar = liveDelta ? (
    <>
      <div
        style={{
          position: 'absolute',
          top: -2,
          bottom: -2,
          width: 2,
          background: liveDelta.snapped ? '#FFFFFF' : C.gold,
          boxShadow: liveDelta.snapped
            ? '0 0 6px rgba(255,255,255,0.9)'
            : '0 0 4px rgba(201,168,76,0.8)',
          pointerEvents: 'none',
          [liveDelta.edge === 'start' ? 'left' : 'right']: 0,
          transform: `translateX(${liveDelta.deltaPx}px)`,
          zIndex: 3,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '100%',
          marginBottom: 6,
          [liveDelta.edge === 'start' ? 'left' : 'right']: -20,
          transform: `translateX(${liveDelta.deltaPx}px)`,
          width: 40,
          height: 71, // 9:16 at 40px wide
          border: `1px solid ${liveDelta.snapped ? '#FFFFFF' : C.gold}`,
          background: '#000',
          ...filmstripFrameBackground(
            filmstripUrl,
            filmstripFrameIndex(liveDelta.candidateSec, sourceDuration),
          ),
          pointerEvents: 'none',
          zIndex: 5,
          boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            bottom: -1,
            left: 0,
            right: 0,
            fontSize: 8,
            fontFamily: 'ui-monospace, SF Mono, monospace',
            textAlign: 'center',
            color: '#fff',
            background: 'rgba(13,13,24,0.85)',
            lineHeight: '11px',
          }}
        >{liveDelta.candidateSec.toFixed(2)}s</span>
      </div>
    </>
  ) : null;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onSelect()}
      style={{
        position: 'relative',
        width: Math.max(4, width),
        height: '100%',
        transform: CSS.Transform.toString(transform),
        transition,
        background: selected ? C.purple : C.violet,
        opacity: isDragging ? 0.5 : 1,
        border: selected ? `2px solid ${C.gold}` : `1px solid rgba(255,255,255,0.15)`,
        // Guarantee a clickable hit target even for sub-second fragments.
        // Actual duration is still faithfully shown via zoom — this just
        // widens the pointer surface on extremely narrow clips so they
        // can't become un-selectable.
        minWidth: 14,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: C.white,
        fontSize: 10,
        fontWeight: 700,
        fontFamily: 'ui-monospace, SF Mono, monospace',
        cursor: 'grab',
        overflow: 'visible',
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
      }}
      title={
        `${clip.sourceStart.toFixed(2)}s – ${clip.sourceEnd.toFixed(2)}s (${dur.toFixed(2)}s)` +
        (speed !== 1 ? ` @ ${speed}x` : '') +
        (retakeGroup ? ` · ${retakeGroup.alternatives.length} takes — select to swap` : '') +
        (selected ? ' · drag gold edges to extend/trim' : '')
      }
    >
      {/* Filmstrip — fixed-width tiles, each showing the source frame
          nearest its own span, so frames stay undistorted at any zoom.
          pointer-events:none keeps dnd-kit / trim handles untouched. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          display: 'flex',
          pointerEvents: 'none',
          zIndex: 0,
        }}
        aria-hidden
      >
        {(() => {
          const w = Math.max(4, width);
          // Cap the tile count so extreme zoom on long clips can't mint
          // thousands of divs; tiles just get proportionally wider.
          const tileW = Math.max(THUMB_W, w / 200);
          const count = Math.max(1, Math.ceil(w / tileW));
          return Array.from({ length: count }, (_, i) => {
            const midSec = clip.sourceStart + (((i + 0.5) * tileW) / w) * dur;
            const idx = filmstripFrameIndex(Math.min(midSec, clip.sourceEnd), sourceDuration);
            return (
              <div
                key={i}
                style={{
                  flex: '0 0 auto',
                  width: tileW,
                  height: '100%',
                  ...filmstripFrameBackground(filmstripUrl, idx),
                }}
              />
            );
          });
        })()}
        {/* Brand tint so the duration label stays readable over frames. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: selected ? 'rgba(112,2,171,0.45)' : 'rgba(13,13,24,0.4)',
          }}
        />
      </div>
      {speed !== 1 && (
        <span
          style={{
            position: 'absolute',
            top: -7,
            left: -1,
            fontSize: 8,
            fontWeight: 800,
            lineHeight: '10px',
            padding: '0 3px',
            background: C.gold,
            color: C.bg,
            border: `1px solid ${C.gold}`,
            zIndex: 2,
            pointerEvents: 'none',
          }}
        >{speed}×</span>
      )}
      {retakeGroup && (
        <span
          style={{
            position: 'absolute',
            top: -7,
            right: -1,
            fontSize: 8,
            fontWeight: 800,
            lineHeight: '10px',
            padding: '0 3px',
            background: retakeGroup.flagged ? C.gold : C.violet,
            color: retakeGroup.flagged ? C.bg : C.white,
            border: `1px solid ${retakeGroup.flagged ? C.gold : 'rgba(255,255,255,0.3)'}`,
            zIndex: 2,
            pointerEvents: 'none',
          }}
        >⟲{retakeGroup.alternatives.length}</span>
      )}
      {(() => {
        if (liveDelta) {
          const projected = liveDelta.edge === 'end'
            ? liveDelta.candidateSec - clip.sourceStart
            : clip.sourceEnd - liveDelta.candidateSec;
          const deltaSec = projected - dur;
          const deltaDisplay = deltaSec >= 0 ? `+${deltaSec.toFixed(2)}` : deltaSec.toFixed(2);
          return (
            <span style={{ fontVariantNumeric: 'tabular-nums', position: 'relative', zIndex: 1, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
              {Math.max(0, projected).toFixed(2)}s
              <span style={{ opacity: 0.85, marginLeft: 4, fontSize: 9 }}>({deltaDisplay}s{liveDelta.snapped ? ' ⌁' : ''})</span>
            </span>
          );
        }
        return width > 32
          ? <span style={{ position: 'relative', zIndex: 1, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>{`${dur.toFixed(1)}s`}</span>
          : '';
      })()}
      {selected && (
        <>
          <div
            onPointerDown={beginResize('start')}
            onPointerMove={duringResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: -3,
              top: -2,
              bottom: -2,
              width: 8,
              cursor: 'ew-resize',
              background: 'linear-gradient(90deg, rgba(201,168,76,0.9), rgba(201,168,76,0.1))',
              borderRadius: 8,
              zIndex: 2,
              touchAction: 'none',
            }}
            title="Drag to extend clip start earlier in source (or trim later)"
          />
          <div
            onPointerDown={beginResize('end')}
            onPointerMove={duringResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              right: -3,
              top: -2,
              bottom: -2,
              width: 8,
              cursor: 'ew-resize',
              background: 'linear-gradient(270deg, rgba(201,168,76,0.9), rgba(201,168,76,0.1))',
              borderRadius: 8,
              zIndex: 2,
              touchAction: 'none',
            }}
            title="Drag to extend clip end later in source (or trim earlier)"
          />
          {ghostBar}
        </>
      )}
    </div>
  );
}

function CaptionChip({
  caption, left, width, selected,
  onSelect, onUpdate, onMove, onDelete, containerPxToMs, snapTargetsMs,
}: {
  caption: Caption;
  left: number;
  width: number;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (text: string) => void;
  onMove: (deltaMs: number) => void;
  onDelete: () => void;
  containerPxToMs: (px: number) => number;
  snapTargetsMs: number[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(caption.text);
  const dragState = useRef<{ startX: number; accPx: number; started: boolean } | null>(null);

  // Sync draft if the caption text changes externally (e.g. regenerate).
  useEffect(() => {
    if (!editing) setDraft(caption.text);
  }, [caption.text, editing]);

  const startDrag = (e: React.PointerEvent) => {
    if (editing) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, accPx: 0, started: false };
  };
  const doDrag = (e: React.PointerEvent) => {
    if (!dragState.current) return;
    dragState.current.accPx = e.clientX - dragState.current.startX;
    if (Math.abs(dragState.current.accPx) >= 4) dragState.current.started = true;
  };
  const endDrag = () => {
    if (!dragState.current) return;
    const { accPx, started } = dragState.current;
    dragState.current = null;
    if (!started) {
      // Plain click — select AND open editor inline (no double-click required).
      if (!selected) onSelect();
      setDraft(caption.text);
      setEditing(true);
      return;
    }
    let deltaMs = containerPxToMs(Math.abs(accPx)) * (accPx < 0 ? -1 : 1);
    // Snap whichever caption edge lands closest to a clip boundary or
    // another caption's edge (own edges excluded so tiny nudges stick).
    const tol = containerPxToMs(SNAP_PX);
    const own = [caption.startMs, caption.endMs];
    const snapStart = snapValue(caption.startMs + deltaMs, snapTargetsMs, tol, own);
    const snapEnd = snapValue(caption.endMs + deltaMs, snapTargetsMs, tol, own);
    const adjStart = snapStart.snapped ? snapStart.value - (caption.startMs + deltaMs) : null;
    const adjEnd = snapEnd.snapped ? snapEnd.value - (caption.endMs + deltaMs) : null;
    if (adjStart !== null && (adjEnd === null || Math.abs(adjStart) <= Math.abs(adjEnd))) {
      deltaMs += adjStart;
    } else if (adjEnd !== null) {
      deltaMs += adjEnd;
    }
    onMove(deltaMs);
  };

  return (
    <div
      onPointerDown={startDrag}
      onPointerMove={doDrag}
      onPointerUp={endDrag}
      style={{
        position: 'absolute',
        left,
        top: 0,
        width,
        height: CAPTION_HEIGHT,
        background: selected ? C.gold : C.surface,
        color: selected ? C.bg : C.white,
        border: `1px solid ${selected ? C.gold : C.border}`,
        borderRadius: 8,
        padding: '2px 8px',
        fontSize: 10,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        cursor: editing ? 'text' : 'pointer',
      }}
      title="Click to edit · drag to shift timing · Delete to remove"
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); if (draft !== caption.text) onUpdate(draft); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') { setDraft(caption.text); setEditing(false); }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'inherit',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'inherit',
          }}
        />
      ) : (
        <>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {caption.text}
          </span>
          {selected && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: 0,
                marginLeft: 4,
                fontSize: 13,
                lineHeight: 1,
              }}
            >×</button>
          )}
        </>
      )}
    </div>
  );
}

function useTimelineWidth(ref: React.RefObject<HTMLDivElement>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      setW(Math.max(0, box.width - TIMELINE_PADDING_LR * 2));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function fmtTime(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
