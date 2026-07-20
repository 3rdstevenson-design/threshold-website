/**
 * VideoPreview — the 9:16 playback panel.
 *
 * Smoothness strategy:
 *   - A requestAnimationFrame loop (running at ~60fps while playing)
 *     drives the edited-time playhead and handles clip-boundary seeks.
 *   - The active caption is chosen IMPERATIVELY inside the same RAF tick
 *     by reading video.currentTime and writing to a ref'd DOM node. This
 *     bypasses React state round-trips, keeping captions locked to the
 *     video clock with no visible lag.
 *   - Caption/header overlays resolve their style from
 *     plan.captionStyle + caption.style (per-caption override).
 */
'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef, useMemo } from 'react';
import { C } from './brand';
import type { Caption, CaptionStyle, EditPlan, HeaderConfig, Overlay } from '@/lib/editor/editPlan';
import { clipEditedMs, clipSpeed, editedMsToSource, resolveCaptionStyle, DEFAULT_CAPTION_STYLE, deriveRenderWords } from '@/lib/editor/editPlan';
import { dashKey } from './useEditor';

export type VideoPreviewHandle = {
  seekEditedMs: (ms: number) => void;
  togglePlay: () => void;
  nudge: (deltaMs: number) => void;
  beginEditCaption: () => void;
  /** Scrub straight to a SOURCE time (seconds) — used by trim-handle drags,
   *  where the candidate frame may lie outside the current clips and so has
   *  no edited-timeline address. Pauses playback. */
  scrubSourceSec: (sec: number) => void;
};

type Props = {
  plan: EditPlan;
  editedDurationMs: number;
  onPlayheadChange: (editedMs: number) => void;
  selectedCaptionId?: string | null;
  onSelectCaption?: (id: string | null) => void;
  onPatchCaptionStyle?: (id: string, patch: Partial<CaptionStyle> | null) => void;
  onUpdateCaption?: (id: string, text: string) => void;
  onSetEmphasizedWord?: (id: string, index: number | null) => void;
  /** Drag-to-reposition the header on the preview (merges a partial into plan.header). */
  onUpdateHeader?: (patch: Partial<HeaderConfig>) => void;
  /** Free text overlays: selection + drag-to-reposition (paused only). */
  selectedOverlayId?: string | null;
  onSelectOverlay?: (id: string | null) => void;
  onPatchOverlayStyle?: (id: string, patch: Partial<CaptionStyle>) => void;
  /** Overlay Instagram's UI safe-zones (top, right action rail, bottom caption). */
  showSafeZones?: boolean;
  /** Overlay a mock of Instagram's Reels chrome (right rail, caption block). */
  showIgChrome?: boolean;
};

export const VideoPreview = forwardRef<VideoPreviewHandle, Props>(function VideoPreview(
  { plan, editedDurationMs, onPlayheadChange, selectedCaptionId, onSelectCaption, onPatchCaptionStyle, onUpdateCaption, onSetEmphasizedWord, onUpdateHeader, selectedOverlayId, onSelectOverlay, onPatchOverlayStyle, showSafeZones, showIgChrome },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captionLayerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);

  // Reactive pointer to the currently-active caption — used by the
  // interactive overlay (click / drag / dblclick). Only tracked while
  // paused to avoid thrashing state during playback; playback uses the
  // imperative painter which reads from refs.
  const activeCaption = useMemo<Caption | null>(() => {
    if (playing) return null;
    return plan.captions.find((c) => currentMs >= c.startMs && currentMs <= c.endMs) ?? null;
  }, [playing, plan.captions, currentMs]);

  // Inject the caption animation keyframes into the document head once.
  useEffect(() => { ensureCaptionKeyframes(); }, []);

  // Keep the latest plan in a ref so the RAF loop always reads up-to-date
  // clip boundaries without re-subscribing each render.
  const planRef = useRef(plan);
  useEffect(() => { planRef.current = plan; }, [plan]);

  const onPlayheadRef = useRef(onPlayheadChange);
  useEffect(() => { onPlayheadRef.current = onPlayheadChange; }, [onPlayheadChange]);

  // Map currentTime → edited-timeline ms. Used by the RAF loop and by
  // the clip-boundary detector. Also keeps the element's playbackRate in
  // sync with the active clip's speed — per-clip speed previews live
  // without re-encoding.
  const mapAndHandleSeek = useCallback((v: HTMLVideoElement) => {
    const plan = planRef.current;
    const sourceMs = v.currentTime * 1000;
    let acc = 0;
    for (let i = 0; i < plan.clips.length; i++) {
      const clip = plan.clips[i];
      const s = clip.sourceStart * 1000;
      const e = clip.sourceEnd * 1000;
      if (sourceMs >= s && sourceMs <= e) {
        const speed = clipSpeed(clip);
        // Some browsers throw on rates they can't do — never break the RAF loop.
        if (v.playbackRate !== speed) { try { v.playbackRate = speed; } catch {} }
        return acc + (sourceMs - s) / speed;
      }
      acc += clipEditedMs(clip);
    }
    // Outside any clip — jump to the next clip start in source space.
    let nextStart: number | null = null;
    for (const c of plan.clips) {
      if (c.sourceStart * 1000 > sourceMs) { nextStart = c.sourceStart; break; }
    }
    if (nextStart !== null) {
      v.currentTime = nextStart;
    } else {
      v.pause();
    }
    return null;
  }, []);

  // Imperative caption selection. Uses a DOM ref so we don't wait for
  // React state to re-render before the caption updates.
  //
  // Cache keys prevent DOM rebuilds on every RAF tick (60fps). The paint
  // is idempotent when the active caption's id + text + resolved style
  // haven't changed — we return early and let the existing DOM keep
  // rendering. This is critical for playback smoothness: without caching,
  // we'd be calling layer.innerHTML = '' and running autoShrinkToFit's
  // getBoundingClientRect at 60+ fps, causing constant reflow jank.
  const lastCaptionIdRef = useRef<string | null>(null);
  const lastAppliedTextRef = useRef<string>('');
  const lastAppliedStyleSigRef = useRef<string>('');
  const lastActiveWordIdxRef = useRef<number>(-1);
  const paintCaption = useCallback((editedMs: number) => {
    const plan = planRef.current;
    const layer = captionLayerRef.current;
    if (!layer) return;
    const active = plan.captions.find(
      (c) => editedMs >= c.startMs && editedMs <= c.endMs,
    );
    const nextId = active?.id ?? null;

    // Same caption still active — skip DOM work if neither the text nor
    // the resolved style has changed since the last paint. This is the
    // common case during playback and makes the RAF tick essentially free.
    if (nextId === lastCaptionIdRef.current) {
      if (!active) return; // still "no caption" → nothing to do
      const resolved = resolveCaptionStyle(plan.captionStyle, active.style);
      const styleSig = styleSignature(resolved);
      // In karaoke mode the highlighted word changes as playback
      // advances even within a single caption. Re-check the active
      // word index and repaint only when it moves. A pinned
      // emphasizedWordIndex short-circuits the time-based travel.
      const wordIdx =
        resolved.mode === 'karaoke' || resolved.mode === 'word'
          ? (typeof active.emphasizedWordIndex === 'number'
              ? active.emphasizedWordIndex
              : activeWordIndex(deriveRenderWords(active), editedMs))
          : -1;
      if (
        active.text === lastAppliedTextRef.current &&
        styleSig === lastAppliedStyleSigRef.current &&
        wordIdx === lastActiveWordIdxRef.current
      ) {
        return; // no DOM write — previous paint still valid
      }
      // Text / style / active word changed — re-apply without
      // restarting the entry animation to avoid visual jitter.
      applyCaptionStyle(layer, active, resolved, editedMs, { skipAnimation: true });
      lastAppliedTextRef.current = active.text;
      lastAppliedStyleSigRef.current = styleSig;
      lastActiveWordIdxRef.current = wordIdx;
      return;
    }

    // Active caption changed — full repaint with entry animation.
    lastCaptionIdRef.current = nextId;
    if (!active) {
      layer.style.opacity = '0';
      layer.textContent = '';
      lastAppliedTextRef.current = '';
      lastAppliedStyleSigRef.current = '';
      lastActiveWordIdxRef.current = -1;
      return;
    }
    const resolved = resolveCaptionStyle(plan.captionStyle, active.style);
    applyCaptionStyle(layer, active, resolved, editedMs);
    layer.style.opacity = '1';
    lastAppliedTextRef.current = active.text;
    lastAppliedStyleSigRef.current = styleSignature(resolved);
    lastActiveWordIdxRef.current =
      resolved.mode === 'karaoke' || resolved.mode === 'word'
        ? (typeof active.emphasizedWordIndex === 'number'
            ? active.emphasizedWordIndex
            : activeWordIndex(deriveRenderWords(active), editedMs))
        : -1;
  }, []);

  // RAF loop — only runs while playing. On each frame we map the video
  // time, nudge the playhead state, and paint the caption imperatively.
  const rafId = useRef<number | null>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const tick = () => {
      const mapped = mapAndHandleSeek(v);
      if (mapped !== null) {
        paintCaption(mapped);
        setCurrentMs((prev) => (Math.abs(mapped - prev) > 8 ? mapped : prev));
        onPlayheadRef.current(mapped);
      }
      rafId.current = requestAnimationFrame(tick);
    };

    if (playing) {
      rafId.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      rafId.current = null;
    };
  }, [playing, mapAndHandleSeek, paintCaption]);

  // Re-paint the caption layer when the plan's captions or style change
  // (e.g. after typing in the caption-style panel, or editing a chip).
  //
  // IMPORTANT: do NOT depend on `currentMs` here. During playback,
  // setCurrentMs fires every ~8ms and would re-run this effect ~125
  // times per second, each time resetting lastCaptionIdRef to null and
  // triggering a full DOM rebuild + animation restart inside paintCaption
  // — that's what caused the preview to visibly stutter. Instead, read
  // the current video time directly from the element on each fire.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // Force re-resolve by clearing the caption + style caches so the
    // very next paint does a real DOM write.
    lastCaptionIdRef.current = null;
    lastAppliedTextRef.current = '';
    lastAppliedStyleSigRef.current = '';
    const mapped = mapAndHandleSeek(v);
    if (mapped !== null) paintCaption(mapped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.captions, plan.captionStyle]);

  // Only reset playback when we load a DIFFERENT project. On clip edits
  // (delete, split, reorder) we keep the video's current source time.
  useEffect(() => {
    setCurrentMs(0);
    const v = videoRef.current;
    // Blank the imperative caption layer and reset the paint caches so
    // stale text from the prior project can't linger in the DOM while
    // the video element reloads its src for the new project.
    const layer = captionLayerRef.current;
    if (layer) {
      layer.textContent = '';
      layer.style.opacity = '0';
    }
    lastCaptionIdRef.current = null;
    lastAppliedTextRef.current = '';
    lastAppliedStyleSigRef.current = '';
    lastActiveWordIdxRef.current = -1;
    if (!v) return;
    if (plan.clips.length > 0) {
      v.currentTime = plan.clips[0].sourceStart;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.slug]);

  // When clips change within the same project, remap the playhead.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const mapped = mapAndHandleSeek(v);
    if (mapped !== null) {
      setCurrentMs(mapped);
      onPlayheadRef.current(mapped);
      paintCaption(mapped);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.clips]);

  const seekEditedMs = useCallback((ms: number) => {
    scrubbingRef.current = false;
    const clamped = Math.max(0, Math.min(editedDurationMs, ms));
    setCurrentMs(clamped);
    const m = editedMsToSource(plan, clamped);
    if (m && videoRef.current) {
      videoRef.current.currentTime = m.sourceMs / 1000;
    }
    paintCaption(clamped);
    onPlayheadChange(clamped);
  }, [plan, editedDurationMs, onPlayheadChange, paintCaption]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    scrubbingRef.current = false;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const nudge = useCallback((deltaMs: number) => {
    seekEditedMs(currentMs + deltaMs);
  }, [currentMs, seekEditedMs]);

  // Open the inline caption editor for the caption under the playhead.
  // The interactive overlay only mounts while paused, so we pause first;
  // setting editingCaptionId then makes CaptionInteractionLayer render its
  // <input> on the next commit.
  const beginEditCaption = useCallback(() => {
    const target = plan.captions.find(
      (c) => currentMs >= c.startMs && currentMs <= c.endMs,
    );
    if (!target) return;
    const v = videoRef.current;
    if (v && !v.paused) v.pause();
    onSelectCaption?.(target.id);
    setEditingCaptionId(target.id);
  }, [plan.captions, currentMs, onSelectCaption]);

  // While trim-scrubbing, the paused-time seek handler must NOT remap the
  // source position back into the clips (out-of-clip frames are the point).
  const scrubbingRef = useRef(false);

  const scrubSourceSec = useCallback((sec: number) => {
    const v = videoRef.current;
    if (!v) return;
    scrubbingRef.current = true;
    if (!v.paused) v.pause();
    v.currentTime = Math.max(0, sec);
  }, []);

  useImperativeHandle(ref, () => ({ seekEditedMs, togglePlay, nudge, beginEditCaption, scrubSourceSec }), [seekEditedMs, togglePlay, nudge, beginEditCaption, scrubSourceSec]);

  // Pause-time playhead sync (for seeks without playback).
  const handleTimeUpdate = useCallback(() => {
    if (playing) return; // RAF handles it
    if (scrubbingRef.current) return; // trim-scrub owns the position
    const v = videoRef.current;
    if (!v) return;
    const mapped = mapAndHandleSeek(v);
    if (mapped !== null) {
      setCurrentMs(mapped);
      onPlayheadRef.current(mapped);
      paintCaption(mapped);
    }
  }, [playing, mapAndHandleSeek, paintCaption]);

  const headerVisible = isHeaderVisible(plan.header, currentMs);

  // Global style for the caption layer (anchors position; the per-caption
  // fields are applied imperatively inside paintCaption).
  const captionLayerStyle = useMemo(() => {
    const globalStyle = plan.captionStyle ?? DEFAULT_CAPTION_STYLE;
    const base = captionLayerBaseStyle(globalStyle.position);
    // While inline-editing, hide the painted layer so the edit input
    // isn't visually doubled.
    if (editingCaptionId && activeCaption?.id === editingCaptionId) {
      return { ...base, opacity: 0 } as React.CSSProperties;
    }
    return base;
  }, [plan.captionStyle, editingCaptionId, activeCaption?.id]);

  const resolvedActiveStyle = useMemo(() => {
    if (!activeCaption) return null;
    return resolveCaptionStyle(plan.captionStyle, activeCaption.style);
  }, [activeCaption, plan.captionStyle]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8,
      minHeight: 0,
      minWidth: 0,
      width: '100%',
      height: '100%',
    }}>
      <div style={{
        position: 'relative',
        aspectRatio: '9 / 16',
        height: '100%',
        maxWidth: '100%',
        background: '#000',
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: `0 0 0 1px ${C.border}, 0 8px 24px rgba(0,0,0,0.45)`,
        // Enable container queries so captions can scale with the preview
        containerType: 'inline-size',
      } as React.CSSProperties}>
        <video
          ref={videoRef}
          src={`/api/editor/project/${plan.slug}/source?k=${encodeURIComponent(dashKey())}`}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={handleTimeUpdate}
          onError={() => setVideoError('Could not load the source video. Try re-analyzing or re-uploading.')}
          onLoadedMetadata={() => setVideoError(null)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          playsInline
          preload="auto"
          controls={false}
        />
        {videoError && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            padding: 20, textAlign: 'center',
            color: C.red, fontSize: 12, fontWeight: 600,
            background: 'rgba(13,13,24,0.9)',
          }}>
            {videoError}
          </div>
        )}
        {plan.header && headerVisible && <HeaderOverlay header={plan.header} draggable={!playing} onMove={onUpdateHeader} />}
        <div ref={captionLayerRef} style={captionLayerStyle} />
        {!playing && activeCaption && resolvedActiveStyle && onSelectCaption && onPatchCaptionStyle && onUpdateCaption && (
          <CaptionInteractionLayer
            caption={activeCaption}
            captionLayerRef={captionLayerRef}
            resolvedStyle={resolvedActiveStyle}
            isSelected={selectedCaptionId === activeCaption.id}
            isEditing={editingCaptionId === activeCaption.id}
            onSelect={() => onSelectCaption(activeCaption.id)}
            onStartEdit={() => { onSelectCaption(activeCaption.id); setEditingCaptionId(activeCaption.id); }}
            onEndEdit={() => setEditingCaptionId(null)}
            onPatchStyle={(patch) => onPatchCaptionStyle(activeCaption.id, patch)}
            onUpdateText={(text) => onUpdateCaption(activeCaption.id, text)}
            onSetEmphasizedWord={onSetEmphasizedWord
              ? (idx) => onSetEmphasizedWord(activeCaption.id, idx)
              : undefined}
          />
        )}
        {/* TODO(overlays): free text-overlay layer is half-wired — editPlan
            overlay actions and useEditor.insertOverlay exist, but the
            <OverlayLayer> render component was never created (broke the prod
            build). Disabled to keep deploys green; re-enable once
            OverlayLayer.tsx is written.
        {plan.overlays && plan.overlays.length > 0 && (
          <OverlayLayer
            overlays={plan.overlays}
            currentMs={currentMs}
            paused={!playing}
            selectedId={selectedOverlayId ?? null}
            onSelect={onSelectOverlay}
            onPatchStyle={onPatchOverlayStyle}
          />
        )} */}
        {showSafeZones && <SafeZoneOverlay />}
        {showIgChrome && <IgChromeOverlay />}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: C.silver, flexShrink: 0 }}>
        <button onClick={togglePlay} style={transportBtn}>
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <button onClick={() => nudge(-5000)} style={transportBtn}>‹‹ 5s</button>
        <button onClick={() => nudge(5000)} style={transportBtn}>5s ››</button>
        <span style={{ fontVariantNumeric: 'tabular-nums', marginLeft: 4 }}>
          {fmtTime(currentMs)} / {fmtTime(editedDurationMs)}
        </span>
      </div>
    </div>
  );
});

/**
 * Returns the base CSS for the absolutely-positioned caption layer.
 * The caption layer is a single div whose contents we replace imperatively
 * inside paintCaption(). Keeping this stable lets React mount it once and
 * avoid unnecessary re-renders at 60fps.
 */
function captionLayerBaseStyle(position: CaptionStyle['position']): React.CSSProperties {
  // Position the caption band. `center` places it at vertical center;
  // top/bottom anchor to their edges with safe-zone padding.
  const posStyle: React.CSSProperties = position === 'top'
    ? { top: '12%' }
    : position === 'center'
      ? { top: '50%', transform: 'translateY(-50%)' }
      : { bottom: '12%' };

  return {
    position: 'absolute',
    left: '5%',
    right: '5%',
    ...posStyle,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    pointerEvents: 'none',
    opacity: 0,
    // Give the element a minimum height so the layer doesn't collapse
    // when empty (prevents layout shift on caption transitions).
    minHeight: 24,
  };
}

/**
 * Imperatively paint a caption into the given layer. Applies the resolved
 * CaptionStyle (color, stroke, font, size, background, animation).
 *
 * skipAnimation = true disables the entry keyframe — used when re-applying
 * the same caption because its style changed (live edits in the panel)
 * so we don't restart the animation on every keystroke.
 */
function applyCaptionStyle(
  layer: HTMLDivElement,
  caption: Caption,
  style: CaptionStyle,
  editedMs: number,
  opts: { skipAnimation?: boolean } = {},
): void {
  const text = caption.text;
  const fontVar = fontFamilyVar(style.fontFamily);
  // Build the stroke via 8-direction text-shadow so the outline renders
  // on top of the fill. strokeWidth=0 disables the stroke.
  const s = style.strokeWidth;
  const stroke = s > 0 && style.strokeColor
    ? [
        `${s}px ${s}px 0 ${style.strokeColor}`,
        `-${s}px -${s}px 0 ${style.strokeColor}`,
        `${s}px -${s}px 0 ${style.strokeColor}`,
        `-${s}px ${s}px 0 ${style.strokeColor}`,
        `0 ${s}px 0 ${style.strokeColor}`,
        `${s}px 0 0 ${style.strokeColor}`,
        `0 -${s}px 0 ${style.strokeColor}`,
        `-${s}px 0 0 ${style.strokeColor}`,
      ].join(',')
    : 'none';

  // Scale with container width so long chunks don't get ellipsized on
  // narrow previews. clamp(min, pref, max) — pref uses `cqi` which is
  // 1% of the container's inline size (the video wrapper).
  const base = style.fontSizeMultiplier;
  const fontSize = `clamp(${11 * base}px, ${4.5 * base}cqi, ${22 * base}px)`;

  // Build the inner HTML — wrap in an inline-block so background hugs
  // the text and doesn't stretch the full layer width.
  const bg = style.background === 'dark'
    ? 'rgba(13,13,24,0.8)'
    : style.background === 'white'
      ? 'rgba(255,255,255,0.92)'
      : 'transparent';
  const padding = style.background === 'none' ? '0' : '6px 12px';
  const borderRadius = style.background === 'none' ? '0' : '6px';

  // Drag-to-reposition offsets. cqi = 1% of the video's inline size, so
  // offsets travel the same proportion across any preview size.
  const ox = style.positionOffsetX || 0;
  const oy = style.positionOffsetY || 0;
  const transform = (ox !== 0 || oy !== 0) ? `translate(${ox}cqi, ${oy}cqi)` : '';

  layer.innerHTML = '';
  const inner = document.createElement('span');
  Object.assign(inner.style, {
    display: 'inline-block',
    color: style.color,
    fontFamily: fontVar,
    fontWeight: '800',
    fontSize,
    lineHeight: '1.1',
    textShadow: stroke,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    whiteSpace: 'nowrap',
    background: bg,
    padding,
    borderRadius,
    maxWidth: '100%',
    transform,
    // NEVER ellipsize mid-word. The chunker now enforces a maxChars cap
    // so captions fit, and the auto-shrink pass below covers extreme
    // single-word overflow.
    overflow: 'visible',
  } as CSSStyleDeclaration);

  // Word-level modes — render per-word spans so the currently spoken
  // word can flip to `activeColor` (karaoke) or be shown on its own
  // (word). Falls through to the single-span chunks path if the caption
  // lacks word timings.
  //
  // `emphasizedWordIndex` (set by clicking a word in the preview) pins
  // the highlight to one word for the entire caption instead of the
  // time-based auto-travel.
  // Per-word modes. `deriveRenderWords` auto-heals stale words[] from
  // legacy plans by re-tokenizing against the caption's current text.
  const renderWords =
    style.mode === 'karaoke' || style.mode === 'word'
      ? deriveRenderWords(caption)
      : null;
  if (renderWords && renderWords.length > 0) {
    const pinned = typeof caption.emphasizedWordIndex === 'number'
      ? caption.emphasizedWordIndex
      : null;
    const activeIdx = pinned ?? activeWordIndex(renderWords, editedMs);
    if (style.mode === 'word') {
      // Only the active word is rendered. Before the first word's
      // startMs we show words[0] so the caption never blanks out
      // inside its own time window.
      const idx = activeIdx >= 0 ? activeIdx : 0;
      const w = renderWords[idx];
      const span = document.createElement('span');
      span.textContent = w.text;
      span.dataset.wordIndex = String(idx);
      span.style.color = style.activeColor;
      inner.appendChild(span);
    } else {
      // Karaoke — progressive reveal. Words already spoken stay lit;
      // upcoming words sit at 0.35 opacity until their turn. A pinned
      // emphasizedWordIndex lights only that one word (override).
      renderWords.forEach((w, i) => {
        const span = document.createElement('span');
        span.textContent = w.text;
        span.dataset.wordIndex = String(i);
        span.style.color = style.color;
        const lit = pinned !== null ? i === pinned : i <= activeIdx;
        span.style.opacity = lit ? '1' : '0.35';
        span.style.transition = 'opacity 120ms linear';
        inner.appendChild(span);
        if (i < renderWords.length - 1) {
          inner.appendChild(document.createTextNode(' '));
        }
      });
    }
  } else {
    inner.textContent = text;
  }

  // Apply the entry animation. Instant = no animation. The keyframes are
  // injected once in ensureCaptionKeyframes() the first time this renders.
  if (!opts.skipAnimation) {
    const animName = ANIMATION_KEYFRAME_NAMES[style.animation] ?? '';
    const animMs = ANIMATION_DURATION_MS[style.animation] ?? 180;
    if (animName) {
      inner.style.animation = `${animName} ${animMs}ms cubic-bezier(.2,.9,.3,1) both`;
    }
  }

  layer.appendChild(inner);

  // Auto-shrink safety net: if the rendered inner span overflows its
  // container (single super-long word, e.g. "KIERKEGAARD" on a narrow
  // preview), step the font-size down until it fits. Bound at 55% to
  // keep text readable.
  autoShrinkToFit(layer, inner);
}

const ANIMATION_KEYFRAME_NAMES: Record<CaptionStyle['animation'], string> = {
  instant:       '',
  fade:          'threshold-caption-fade',
  pop:           'threshold-caption-pop',
  bounce:        'threshold-caption-bounce',
  zoom:          'threshold-caption-zoom',
  'slide-up':    'threshold-caption-slide-up',
  'slide-down':  'threshold-caption-slide-down',
  'slide-left':  'threshold-caption-slide-left',
  'slide-right': 'threshold-caption-slide-right',
  shake:         'threshold-caption-shake',
};

const ANIMATION_DURATION_MS: Record<CaptionStyle['animation'], number> = {
  instant:       0,
  fade:          180,
  pop:           180,
  bounce:        420,
  zoom:          220,
  'slide-up':    180,
  'slide-down':  180,
  'slide-left':  180,
  'slide-right': 180,
  shake:         360,
};

/** Inject the shared keyframe CSS once per document. Idempotent. */
export function ensureCaptionKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('threshold-caption-kf')) return;
  const style = document.createElement('style');
  style.id = 'threshold-caption-kf';
  style.textContent = `
    @keyframes threshold-caption-fade {
      from { opacity: 0 }
      to   { opacity: 1 }
    }
    @keyframes threshold-caption-pop {
      0%   { transform: scale(.85); opacity: 0 }
      70%  { transform: scale(1.05); opacity: 1 }
      100% { transform: scale(1) }
    }
    @keyframes threshold-caption-bounce {
      0%   { transform: scale(.5);  opacity: 0 }
      45%  { transform: scale(1.2); opacity: 1 }
      70%  { transform: scale(.9) }
      100% { transform: scale(1) }
    }
    @keyframes threshold-caption-zoom {
      from { transform: scale(.4); opacity: 0 }
      to   { transform: scale(1);  opacity: 1 }
    }
    @keyframes threshold-caption-slide-up {
      from { transform: translateY(24px);  opacity: 0 }
      to   { transform: translateY(0);     opacity: 1 }
    }
    @keyframes threshold-caption-slide-down {
      from { transform: translateY(-24px); opacity: 0 }
      to   { transform: translateY(0);     opacity: 1 }
    }
    @keyframes threshold-caption-slide-left {
      from { transform: translateX(32px);  opacity: 0 }
      to   { transform: translateX(0);     opacity: 1 }
    }
    @keyframes threshold-caption-slide-right {
      from { transform: translateX(-32px); opacity: 0 }
      to   { transform: translateX(0);     opacity: 1 }
    }
    @keyframes threshold-caption-shake {
      0%,100% { transform: translateX(0) }
      15%     { transform: translateX(-6px) }
      30%     { transform: translateX(6px) }
      45%     { transform: translateX(-4px) }
      60%     { transform: translateX(4px) }
      75%     { transform: translateX(-2px) }
    }
  `;
  document.head.appendChild(style);
}

/**
 * If the inner text's rendered width exceeds the caption layer's
 * content box, shrink the font-size in 10% steps until it fits, or
 * until we hit 55% of the original size. If we hit the floor and still
 * don't fit, ENABLE word-wrap as the last-resort safety net.
 *
 * WORD-ATOMICITY — `word-break: keep-all` / `overflow-wrap: normal`
 * force wrapping at WHITESPACE ONLY (never mid-word). This matches the
 * chunker's invariant: a word is never broken mid-letter, either in
 * generation or in display.
 */
function autoShrinkToFit(layer: HTMLDivElement, inner: HTMLSpanElement): void {
  const layerRect = layer.getBoundingClientRect();
  const innerRect = inner.getBoundingClientRect();
  if (innerRect.width <= layerRect.width && innerRect.height <= layerRect.height) return;

  // Parse current font-size back to a pixel value (browser resolves clamp()).
  const computed = window.getComputedStyle(inner).fontSize;
  const currentPx = parseFloat(computed);
  if (!currentPx || isNaN(currentPx)) return;

  const minPx = currentPx * 0.55;
  let px = currentPx;
  // Bail after 8 iterations (0.9^8 ≈ 0.43 — plenty of headroom).
  for (let i = 0; i < 8; i++) {
    px = px * 0.9;
    if (px < minPx) { px = minPx; }
    inner.style.fontSize = `${px}px`;
    const r = inner.getBoundingClientRect();
    if (r.width <= layerRect.width && r.height <= layerRect.height) return;
    if (px <= minPx) break;
  }

  // Hit the min font-size and still overflowing — allow word-boundary
  // wrap. `keep-all` + `normal` overflow-wrap forbids mid-word breaks.
  inner.style.whiteSpace = 'normal';
  inner.style.wordBreak = 'keep-all';
  inner.style.overflowWrap = 'normal';
  inner.style.lineHeight = '1.15';
}

/**
 * Map the caption's fontFamily enum to the actual CSS variable defined in
 * `app/layout.tsx`. MUST match the `variable: '--font-...'` names there
 * exactly or the font won't switch.
 */
function fontFamilyVar(f: CaptionStyle['fontFamily']): string {
  switch (f) {
    case 'montserrat': return 'var(--font-montserrat), "Montserrat", sans-serif';
    case 'cormorant':  return 'var(--font-cormorant), "Cormorant Garamond", Georgia, serif';
    case 'nunito':
    default:           return 'var(--font-nunito), "Nunito Sans", sans-serif';
  }
}

/**
 * Compact fingerprint of the visual fields of a CaptionStyle. Used by
 * paintCaption to skip DOM work when the resolved style is unchanged
 * between frames. Omits `animation` (which only triggers on id change)
 * and `position` (which anchors the layer, not the inner span).
 */
function styleSignature(s: CaptionStyle): string {
  return [
    s.color, s.strokeColor, s.strokeWidth, s.fontFamily,
    s.fontSizeMultiplier, s.background, s.mode, s.activeColor,
  ].join('|');
}

/**
 * Returns the index of the word active at `editedMs` inside a caption,
 * or -1 if none is. A word is active while `editedMs` is within its
 * [startMs, endMs] window; between words, the most recent word stays
 * highlighted so the cursor doesn't briefly blank out on tiny gaps.
 */
function activeWordIndex(
  words: { startMs: number; endMs: number }[] | undefined,
  editedMs: number,
): number {
  if (!words || words.length === 0) return -1;
  let last = -1;
  for (let i = 0; i < words.length; i++) {
    if (editedMs >= words[i].startMs) last = i;
    else break;
  }
  return last;
}

/**
 * Instagram UI safe-zone guides. Marks the regions IG overlays its own chrome
 * on a Reel — top status/header, right action rail (like/comment/share/audio),
 * and the bottom username/caption block — so on-video text can be kept clear of
 * them. Preview-only; never rendered into the exported MP4. pointer-events:none
 * so it never blocks caption dragging underneath.
 */
function SafeZoneOverlay() {
  const zone = (s: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    border: '1px dashed rgba(255,90,90,0.7)',
    background: 'rgba(255,90,90,0.07)',
    boxSizing: 'border-box',
    ...s,
  });
  const label: React.CSSProperties = {
    position: 'absolute',
    fontSize: 8,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: 'rgba(255,170,170,0.95)',
    fontWeight: 700,
    fontFamily: 'var(--font-montserrat), system-ui, sans-serif',
  };
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }} aria-hidden>
      <div style={zone({ top: 0, left: 0, right: 0, height: '12%' })}>
        <span style={{ ...label, top: 3, left: 5 }}>Top UI</span>
      </div>
      <div style={zone({ right: 0, top: '40%', bottom: '9%', width: '15%' })}>
        <span style={{ ...label, bottom: 4, right: 5 }}>Actions</span>
      </div>
      <div style={zone({ left: 0, right: '16%', bottom: 0, height: '18%' })}>
        <span style={{ ...label, bottom: 4, left: 5 }}>Caption</span>
      </div>
    </div>
  );
}

/**
 * Mock of Instagram's Reels chrome — top "Reels" header, right action
 * rail (like/comment/share/save/audio), bottom username + caption block.
 * One-tap preview of how the reel will sit under IG's real UI.
 * Preview-only, never exported; pointer-events:none throughout.
 */
function IgChromeOverlay() {
  const iconShadow = 'drop-shadow(0 1px 3px rgba(0,0,0,0.55))';
  const railItem: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    color: '#fff',
    filter: iconShadow,
  };
  const count: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    fontFamily: 'var(--font-ui), system-ui, sans-serif',
    textShadow: '0 1px 2px rgba(0,0,0,0.6)',
  };
  const icon = (d: string, filled = false) => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill={filled ? '#fff' : 'none'}
      stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 7 }} aria-hidden>
      {/* Top header */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4% 5% 0',
        color: '#fff',
      }}>
        <span style={{
          fontSize: 'clamp(13px, 5cqi, 20px)', fontWeight: 700,
          fontFamily: 'var(--font-ui), system-ui, sans-serif',
          textShadow: '0 1px 3px rgba(0,0,0,0.6)',
        }}>Reels</span>
        <span style={{ filter: iconShadow }}>
          {icon('M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z')}
        </span>
      </div>

      {/* Right action rail */}
      <div style={{
        position: 'absolute', right: '3%', bottom: '11%',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
      }}>
        <div style={railItem}>
          {icon('M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z')}
          <span style={count}>12.4K</span>
        </div>
        <div style={railItem}>
          {icon('M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z')}
          <span style={count}>318</span>
        </div>
        <div style={railItem}>
          {icon('M22 2L11 13 M22 2l-7 20-4-9-9-4 20-7z')}
          <span style={count}>1,024</span>
        </div>
        <div style={railItem}>
          {icon('M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z')}
        </div>
        <div style={railItem}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" aria-hidden>
            <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
          </svg>
        </div>
        {/* Spinning-audio tile */}
        <div style={{
          width: 24, height: 24, borderRadius: 6,
          border: '2px solid #fff',
          background: 'linear-gradient(135deg, #444, #111)',
          filter: iconShadow,
        }} />
      </div>

      {/* Bottom username + caption block */}
      <div style={{
        position: 'absolute', left: '4%', right: '20%', bottom: '3.5%',
        display: 'flex', flexDirection: 'column', gap: 7,
        color: '#fff', fontFamily: 'var(--font-ui), system-ui, sans-serif',
        textShadow: '0 1px 2px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'linear-gradient(135deg, #7002AB, #C9A84C)',
            border: '1.5px solid rgba(255,255,255,0.9)',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 12, fontWeight: 700 }}>dr.larsandincharge</span>
          <span style={{
            fontSize: 10, fontWeight: 600,
            padding: '3px 9px',
            border: '1px solid rgba(255,255,255,0.85)',
            borderRadius: 7,
          }}>Follow</span>
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.35, opacity: 0.95 }}>
          Caption preview — keep on-video text clear of this block <span style={{ opacity: 0.7 }}>... more</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, opacity: 0.9 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="#fff" aria-hidden>
            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
          </svg>
          <span>dr.larsandincharge · Original audio</span>
        </div>
      </div>
    </div>
  );
}

const OVERLAY_FONT: Record<string, string> = {
  nunito: 'var(--font-nunito), system-ui, sans-serif',
  montserrat: 'var(--font-montserrat), system-ui, sans-serif',
  cormorant: 'var(--font-cormorant), Georgia, serif',
};

/** Renders the free text overlays active at the current time. */
function OverlayLayer({
  overlays,
  currentMs,
  paused,
  selectedId,
  onSelect,
  onPatchStyle,
}: {
  overlays: Overlay[];
  currentMs: number;
  paused: boolean;
  selectedId: string | null;
  onSelect?: (id: string | null) => void;
  onPatchStyle?: (id: string, patch: Partial<CaptionStyle>) => void;
}) {
  const active = overlays.filter((o) => currentMs >= o.startMs && currentMs < o.endMs);
  return (
    <>
      {active.map((o) => (
        <OverlayItem
          key={o.id}
          overlay={o}
          paused={paused}
          selected={selectedId === o.id}
          onSelect={onSelect}
          onPatchStyle={onPatchStyle}
        />
      ))}
    </>
  );
}

/** A single draggable text overlay. Drag (paused) repositions via cqi offsets, mirroring captions. */
function OverlayItem({
  overlay,
  paused,
  selected,
  onSelect,
  onPatchStyle,
}: {
  overlay: Overlay;
  paused: boolean;
  selected: boolean;
  onSelect?: (id: string | null) => void;
  onPatchStyle?: (id: string, patch: Partial<CaptionStyle>) => void;
}) {
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number; vw: number } | null>(null);
  const s = overlay.style ?? {};
  const ox = s.positionOffsetX || 0;
  const oy = s.positionOffsetY || 0;
  const mult = s.fontSizeMultiplier || 1;
  const canDrag = paused && !!onPatchStyle;
  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!canDrag) return;
    onSelect?.(overlay.id);
    const vw = (e.currentTarget.offsetParent as HTMLElement | null)?.getBoundingClientRect().width ?? 1;
    dragRef.current = { x: e.clientX, y: e.clientY, ox, oy, vw };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };
  const onPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const d = dragRef.current;
    if (!d || !onPatchStyle) return;
    const dxPct = ((e.clientX - d.x) / d.vw) * 100;
    const dyPct = ((e.clientY - d.y) / d.vw) * 100;
    onPatchStyle(overlay.id, {
      positionOffsetX: clampNum(d.ox + dxPct, -45, 45),
      positionOffsetY: clampNum(d.oy + dyPct, -45, 45),
    });
  };
  const endDrag = (e: React.PointerEvent<HTMLSpanElement>) => {
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };
  return (
    <span
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: `translate(calc(-50% + ${ox}cqi), calc(-50% + ${oy}cqi))`,
        maxWidth: '82cqi',
        textAlign: 'center',
        whiteSpace: 'pre-wrap',
        lineHeight: 1.15,
        fontFamily: OVERLAY_FONT[s.fontFamily ?? 'montserrat'] ?? OVERLAY_FONT.montserrat,
        fontWeight: 800,
        fontSize: `${5 * mult}cqi`,
        color: s.color || '#ffffff',
        WebkitTextStroke: '0.4cqi rgba(0,0,0,0.55)',
        textShadow: '0 0.3cqi 0.6cqi rgba(0,0,0,0.5)',
        padding: '0.25em 0.4em',
        borderRadius: 6,
        border: selected ? `2px solid ${C.purple}` : '2px solid transparent',
        background: selected ? 'rgba(112,2,171,0.12)' : 'transparent',
        pointerEvents: canDrag ? 'auto' : 'none',
        cursor: canDrag ? 'grab' : 'default',
        touchAction: canDrag ? 'none' : undefined,
        userSelect: 'none',
      }}
    >
      {overlay.text}
    </span>
  );
}

function HeaderOverlay({
  header,
  draggable,
  onMove,
}: {
  header: HeaderConfig;
  draggable?: boolean;
  onMove?: (patch: { positionOffsetX: number; positionOffsetY: number }) => void;
}) {
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number; vw: number } | null>(null);
  const ox = header.positionOffsetX || 0;
  const oy = header.positionOffsetY || 0;
  const topOrBottom: React.CSSProperties = header.position === 'top'
    ? { top: '8%' }
    : { bottom: '24%' };
  const canDrag = !!draggable && !!onMove;
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canDrag) return;
    const vw = e.currentTarget.parentElement?.getBoundingClientRect().width ?? 1;
    dragRef.current = { x: e.clientX, y: e.clientY, ox, oy, vw };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || !onMove) return;
    const dxPct = ((e.clientX - d.x) / d.vw) * 100;
    const dyPct = ((e.clientY - d.y) / d.vw) * 100;
    onMove({
      positionOffsetX: clampNum(d.ox + dxPct, -40, 40),
      positionOffsetY: clampNum(d.oy + dyPct, -40, 40),
    });
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        position: 'absolute',
        left: '6%',
        right: '6%',
        ...topOrBottom,
        transform: (ox !== 0 || oy !== 0) ? `translate(${ox}cqi, ${oy}cqi)` : undefined,
        padding: '10px 14px',
        // Must mirror the Remotion header exactly — the render has square
        // corners, so the preview keeps them too (fidelity > polish).
        borderRadius: 0,
        textAlign: 'center',
        color: C.white,
        fontFamily: 'var(--font-montserrat), system-ui, sans-serif',
        fontWeight: 800,
        fontSize: 14,
        letterSpacing: 0.5,
        lineHeight: 1.25,
        // Caption-style outline (8-direction text-shadow) so the white text
        // reads bar-free, mirroring applyCaptionStyle. Dark obsidian stroke.
        textShadow: [
          `1.5px 1.5px 0 #0D0D18`, `-1.5px -1.5px 0 #0D0D18`,
          `1.5px -1.5px 0 #0D0D18`, `-1.5px 1.5px 0 #0D0D18`,
          `0 1.5px 0 #0D0D18`, `1.5px 0 0 #0D0D18`,
          `0 -1.5px 0 #0D0D18`, `-1.5px 0 0 #0D0D18`,
        ].join(','),
        pointerEvents: canDrag ? 'auto' : 'none',
        cursor: canDrag ? 'grab' : 'default',
        touchAction: canDrag ? 'none' : undefined,
      }}>
      {header.text}
    </div>
  );
}

function isHeaderVisible(h: HeaderConfig | null, currentMs: number): boolean {
  if (!h) return false;
  if (h.durationMode === 'full') return true;
  const until = (h.fadeAfterSeconds ?? 5) * 1000;
  return currentMs <= until;
}

function fmtTime(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const transportBtn: React.CSSProperties = {
  background: C.surface,
  color: C.white,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '4px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

/**
 * Interactive hit-layer for the currently-active caption. Mounts only
 * when the video is paused; mirrors the painted caption's bounding box
 * and handles click-to-select, drag-to-reposition, drag-handle-to-resize,
 * and double-click-to-edit-text. When editing, it temporarily replaces
 * the painted caption with an input field.
 */
type DragMode = 'move' | 'resize';
type DragState = {
  mode: DragMode;
  startX: number;
  startY: number;
  startOx: number;
  startOy: number;
  startMult: number;
  vw: number;
};

function CaptionInteractionLayer({
  caption,
  captionLayerRef,
  resolvedStyle,
  isSelected,
  isEditing,
  onSelect,
  onStartEdit,
  onEndEdit,
  onPatchStyle,
  onUpdateText,
  onSetEmphasizedWord,
}: {
  caption: Caption;
  captionLayerRef: React.RefObject<HTMLDivElement>;
  resolvedStyle: CaptionStyle;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onPatchStyle: (patch: Partial<CaptionStyle>) => void;
  onUpdateText: (text: string) => void;
  onSetEmphasizedWord?: (index: number | null) => void;
}) {
  const [bbox, setBbox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [editText, setEditText] = useState(caption.text);
  const dragRef = useRef<DragState | null>(null);

  // Reset edit buffer when the caption identity or text changes from outside.
  useEffect(() => { setEditText(caption.text); }, [caption.id, caption.text]);

  // Measure the painted caption's inner span every frame so the hit-layer
  // tracks any style changes. Cheap because getBoundingClientRect is fast
  // and we early-exit if the dimensions are unchanged.
  useEffect(() => {
    if (isEditing) return;
    const viewport = captionLayerRef.current?.parentElement;
    if (!viewport) return;
    let raf = 0;
    let last: { left: number; top: number; width: number; height: number } | null = null;
    const measure = () => {
      const layer = captionLayerRef.current;
      const inner = layer?.firstElementChild as HTMLElement | null;
      if (inner && viewport) {
        const ir = inner.getBoundingClientRect();
        const vr = viewport.getBoundingClientRect();
        const next = {
          left: ir.left - vr.left,
          top: ir.top - vr.top,
          width: ir.width,
          height: ir.height,
        };
        if (
          !last ||
          Math.abs(last.left - next.left) > 0.5 ||
          Math.abs(last.top - next.top) > 0.5 ||
          Math.abs(last.width - next.width) > 0.5 ||
          Math.abs(last.height - next.height) > 0.5
        ) {
          last = next;
          setBbox(next);
        }
      }
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [captionLayerRef, caption.id, caption.text, resolvedStyle, isEditing]);

  // Global drag listeners — translate pointer deltas into positionOffset
  // or fontSizeMultiplier patches.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (d.mode === 'move') {
        const dxPct = (dx / d.vw) * 100;
        const dyPct = (dy / d.vw) * 100;
        onPatchStyle({
          positionOffsetX: clampNum(d.startOx + dxPct, -40, 40),
          positionOffsetY: clampNum(d.startOy + dyPct, -40, 40),
        });
      } else {
        const scale = 1 + dx / 120;
        onPatchStyle({
          fontSizeMultiplier: clampNum(d.startMult * scale, 0.6, 1.8),
        });
      }
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [onPatchStyle]);

  const startDrag = useCallback((mode: DragMode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const viewport = captionLayerRef.current?.parentElement;
    if (!viewport) return;
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startOx: resolvedStyle.positionOffsetX ?? 0,
      startOy: resolvedStyle.positionOffsetY ?? 0,
      startMult: resolvedStyle.fontSizeMultiplier,
      vw: viewport.getBoundingClientRect().width,
    };
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (mode === 'move') onSelect();
  }, [captionLayerRef, resolvedStyle, onSelect]);

  const commitEdit = useCallback(() => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== caption.text) onUpdateText(trimmed);
    onEndEdit();
  }, [editText, caption.text, onUpdateText, onEndEdit]);

  // Locate the karaoke word span (if any) under a pointer coordinate.
  // Relies on paintCaption tagging each word span with data-word-index.
  const hitTestWordIndex = useCallback((clientX: number, clientY: number): number | null => {
    const layer = captionLayerRef.current;
    if (!layer) return null;
    const spans = layer.querySelectorAll<HTMLElement>('[data-word-index]');
    for (const span of Array.from(spans)) {
      const r = span.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        const idx = Number(span.dataset.wordIndex);
        return Number.isFinite(idx) ? idx : null;
      }
    }
    return null;
  }, [captionLayerRef]);

  if (!bbox) return null;

  if (isEditing) {
    return (
      <div style={{
        position: 'absolute',
        left: Math.max(8, bbox.left - 20),
        top: bbox.top - 4,
        width: Math.min(bbox.width + 40, 1000),
        zIndex: 12,
      }}>
        <input
          autoFocus
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
            if (e.key === 'Escape') { e.preventDefault(); setEditText(caption.text); onEndEdit(); }
          }}
          style={{
            width: '100%',
            background: 'rgba(13,13,24,0.96)',
            color: '#fff',
            border: `2px solid ${C.gold}`,
            borderRadius: 8,
            padding: '6px 10px',
            fontFamily: fontFamilyVar(resolvedStyle.fontFamily),
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.3px',
            fontSize: 14,
            textAlign: 'center',
            outline: 'none',
            boxShadow: `0 0 0 4px ${C.gold}33`,
          }}
        />
      </div>
    );
  }

  const isKaraoke = resolvedStyle.mode === 'karaoke' && !!caption.words && caption.words.length > 0;
  const title = isKaraoke
    ? 'Click a word to emphasize · Drag to reposition · Double-click to edit text'
    : 'Click to select · Drag to reposition · Double-click to edit text';

  return (
    <div
      onPointerDown={startDrag('move')}
      onClick={(e) => {
        e.stopPropagation();
        if (isKaraoke && onSetEmphasizedWord) {
          const idx = hitTestWordIndex(e.clientX, e.clientY);
          if (idx !== null) {
            // Toggle — clicking the already-pinned word clears emphasis.
            const next = caption.emphasizedWordIndex === idx ? null : idx;
            onSetEmphasizedWord(next);
            onSelect();
            return;
          }
        }
        onSelect();
      }}
      onDoubleClick={(e) => { e.stopPropagation(); onStartEdit(); }}
      title={title}
      style={{
        position: 'absolute',
        left: bbox.left - 4,
        top: bbox.top - 4,
        width: bbox.width + 8,
        height: bbox.height + 8,
        pointerEvents: 'auto',
        cursor: 'grab',
        outline: isSelected ? `1.5px dashed ${C.gold}` : '1.5px dashed transparent',
        outlineOffset: -1,
        borderRadius: 8,
        transition: 'outline-color 100ms',
        zIndex: 10,
      }}
    >
      {isSelected && (
        <div
          onPointerDown={startDrag('resize')}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          title="Drag to resize caption"
          style={{
            position: 'absolute',
            right: -7,
            bottom: -7,
            width: 14,
            height: 14,
            background: C.gold,
            border: `2px solid #000`,
            borderRadius: 8,
            cursor: 'nwse-resize',
            pointerEvents: 'auto',
          }}
        />
      )}
    </div>
  );
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
