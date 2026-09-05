/**
 * useEditor — centralized state for the editor page.
 *
 * Responsibilities:
 *   - fetch/save the edit plan for the selected slug
 *   - fetch analysis.json (words + silences) for autoCut
 *   - expose mutator methods that both update local state AND PUT the plan
 *     back to the server (debounced so we don't spam the API on drags)
 *   - expose the current playhead and selection state
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Caption,
  CaptionStyle,
  Clip,
  CutSettings,
  EditPlan,
  HeaderConfig,
  SpellingCorrection,
} from '@/lib/editor/editPlan';
import { applyAction, clipEditedMs, clipSpeed, editedDurationMs } from '@/lib/editor/editPlan';
import { type Silence, type Word } from '@/lib/editor/autoCut';
import { runCutStages } from '@/lib/editor/cutPipeline';
import { chunkCaptions } from '@/lib/editor/captionChunker';

const SESSION_KEY = 'dashboard_authed';

export function dashKey(): string {
  if (typeof window === 'undefined') return '';
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return '';
  try { return JSON.parse(stored).password ?? ''; } catch { return ''; }
}

export type Analysis = {
  duration: number;
  words: Word[];
  silences: Silence[];
  hasWords: boolean;
};

export type AutoCutStats = {
  removedCount: number;
  removedSeconds: number;
  silenceCuts: number;
  fillerCuts: number;
  stutterCuts?: number;
  droppedTinyClips?: number;
  singleWordCuts?: number;
  fragmentCuts?: number;
  retakeCuts?: number;
  retakeGroups?: number;
};

export type EditorState = {
  plan: EditPlan | null;
  analysis: Analysis | null;
  loading: boolean;
  saveError: string | null;
  lastAutoCut: AutoCutStats | null;
  selectedClipId: string | null;
  selectedCaptionId: string | null;
  playheadEditedMs: number;
  editedDurationMs: number;
};

const HISTORY_LIMIT = 50;

export function useEditor(slug: string | null) {
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastAutoCut, setLastAutoCut] = useState<AutoCutStats | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
  const [playheadEditedMs, setPlayheadEditedMs] = useState(0);

  // Undo/redo stacks of full plan snapshots. Bounded to HISTORY_LIMIT entries.
  const [past, setPast] = useState<EditPlan[]>([]);
  const [future, setFuture] = useState<EditPlan[]>([]);
  // Kept in sync with `plan` but updated *synchronously* inside mutate /
  // undo / redo so back-to-back calls in the same tick observe the
  // latest plan before React commits the next render.
  const planRef = useRef<EditPlan | null>(null);

  // Bumped by reload() to force a re-fetch of plan + analysis without a
  // slug change (e.g. after Polish promotes v2 → v1 on disk).
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Plan queued by the debounce but not yet PUT. Drained by flushSave(). */
  const pendingSave = useRef<EditPlan | null>(null);

  // ── Load on slug change ─────────────────────────────────────────
  useEffect(() => {
    if (!slug) {
      setPlan(null);
      setAnalysis(null);
      setLastAutoCut(null);
      setSelectedClipId(null);
      setSelectedCaptionId(null);
      setPlayheadEditedMs(0);
      setPast([]);
      setFuture([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const key = dashKey();
        const [planRes, analysisRes] = await Promise.all([
          fetch(`/api/editor/project/${slug}/plan`, {
            headers: { 'x-dashboard-key': key },
            cache: 'no-store',
          }),
          fetch(`/api/editor/project/${slug}/analysis`, {
            headers: { 'x-dashboard-key': key },
            cache: 'no-store',
          }),
        ]);
        if (cancelled) return;
        if (planRes.ok) {
          const { plan: p } = await planRes.json();
          setPlan(p);
        } else {
          setPlan(null);
        }
        if (analysisRes.ok) {
          setAnalysis(await analysisRes.json());
        } else {
          setAnalysis(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // New project — reset history
    setPast([]);
    setFuture([]);
    return () => { cancelled = true; };
  }, [slug, reloadKey]);

  // ── Debounced save ──────────────────────────────────────────────
  const saveNow = useCallback(async (next: EditPlan) => {
    setSaveError(null);
    try {
      const res = await fetch(`/api/editor/project/${next.slug}/plan`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-dashboard-key': dashKey(),
        },
        body: JSON.stringify({ plan: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error ?? `save failed ${res.status}`);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const queueSave = useCallback((next: EditPlan) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingSave.current = next;
    saveTimer.current = setTimeout(() => {
      pendingSave.current = null;
      saveNow(next);
    }, 400);
  }, [saveNow]);

  /**
   * Write any debounced-but-unsent plan immediately. Callers must await this
   * before an action that reads the plan server-side (Export), otherwise the
   * server renders a plan up to 400ms stale.
   */
  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingSave.current;
    pendingSave.current = null;
    if (pending) await saveNow(pending);
  }, [saveNow]);

  // Flush on unmount. This previously only cleared the timer, which silently
  // discarded any edit made within 400ms of switching projects.
  const flushRef = useRef(flushSave);
  useEffect(() => { flushRef.current = flushSave; }, [flushSave]);
  useEffect(() => () => { void flushRef.current(); }, []);

  // Keep the ref in sync for the common case where plan changes via
  // external sources (load, reload, etc).
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  const commitPlan = useCallback((next: EditPlan) => {
    planRef.current = next;
    setPlan(next);
  }, []);

  // ── Action helpers ──────────────────────────────────────────────
  // Each mutator applies the action locally, pushes the previous state
  // onto the undo stack, clears the redo stack, and queues a server
  // save.
  //
  // WARNING: do NOT nest these setState calls inside another setState
  // updater. React 18 eagerly re-invokes updater functions (for the
  // useState bailout check), which would cause the history push to
  // run TWICE per mutation — the first undo then pops a duplicate of
  // the current plan, visibly appearing to do nothing.
  const mutate = useCallback(
    (fn: (current: EditPlan) => EditPlan | null) => {
      const cur = planRef.current;
      if (!cur) return;
      const next = fn(cur);
      if (!next || next === cur) return;
      setPast((p) => {
        const appended = [...p, cur];
        return appended.length > HISTORY_LIMIT ? appended.slice(-HISTORY_LIMIT) : appended;
      });
      setFuture((f) => (f.length === 0 ? f : []));
      commitPlan(next);
      queueSave(next);
    },
    [commitPlan, queueSave],
  );

  const undo = useCallback(() => {
    const cur = planRef.current;
    if (!cur || past.length === 0) return;
    const last = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, cur]);
    commitPlan(last);
    queueSave(last);
  }, [past, commitPlan, queueSave]);

  const redo = useCallback(() => {
    const cur = planRef.current;
    if (!cur || future.length === 0) return;
    const last = future[future.length - 1];
    setFuture((f) => f.slice(0, -1));
    setPast((p) => {
      const appended = [...p, cur];
      return appended.length > HISTORY_LIMIT ? appended.slice(-HISTORY_LIMIT) : appended;
    });
    commitPlan(last);
    queueSave(last);
  }, [future, commitPlan, queueSave]);

  const splitAt = useCallback((editedMs: number) => {
    mutate((cur) => {
      // Find clip containing playhead in edited space
      let acc = 0;
      for (const c of cur.clips) {
        const ms = clipEditedMs(c);
        if (editedMs > acc && editedMs < acc + ms) {
          const offsetMs = editedMs - acc;
          const atSourceSeconds = c.sourceStart + (offsetMs / 1000) * clipSpeed(c);
          return applyAction(cur, {
            type: 'split_clip',
            params: { clipId: c.id, atSourceSeconds },
          });
        }
        acc += ms;
      }
      return null;
    });
  }, [mutate]);

  const deleteClip = useCallback((clipId: string) => {
    mutate((cur) => applyAction(cur, { type: 'delete_clip', params: { clipId } }));
    setSelectedClipId((cur) => (cur === clipId ? null : cur));
  }, [mutate]);

  const reorderClips = useCallback((ids: string[]) => {
    mutate((cur) => applyAction(cur, { type: 'reorder_clips', params: { clipIds: ids } }));
  }, [mutate]);

  const trimClip = useCallback(
    (clipId: string, patch: { sourceStart?: number; sourceEnd?: number }) => {
      mutate((cur) => {
        const afterTrim = applyAction(cur, { type: 'trim_clip', params: { clipId, ...patch } });
        // Re-derive captions so newly-exposed (or newly-cut) source words
        // show up in the caption track. Requires analysis.words — if absent,
        // fall back to leaving captions alone.
        if (!analysis) return afterTrim;
        const captions = chunkCaptions(analysis.words, afterTrim.clips, {
          customSpellings: afterTrim.customSpellings ?? [],
        });
        return applyAction(afterTrim, {
          type: 'generate_captions',
          params: { captions },
        });
      });
    },
    [analysis, mutate],
  );

  /**
   * Set a clip's stepped playback speed. Captions live in edited time, so
   * every caption at or after the clip shifts when its duration changes —
   * re-chunk them against the new timing (same policy as trimClip).
   */
  const setClipSpeed = useCallback(
    (clipId: string, speed: number) => {
      mutate((cur) => {
        const after = applyAction(cur, { type: 'set_clip_speed', params: { clipId, speed } });
        if (!analysis) return after;
        const captions = chunkCaptions(analysis.words, after.clips, {
          customSpellings: after.customSpellings ?? [],
        });
        return applyAction(after, {
          type: 'generate_captions',
          params: { captions },
        });
      });
    },
    [analysis, mutate],
  );

  /**
   * Swap which take a retake group keeps ("use this take instead").
   * Regenerates captions afterward (same policy as trimClip) so the
   * caption track reflects the new take's words.
   */
  const flipRetake = useCallback(
    (groupId: string, alternativeId: string) => {
      mutate((cur) => {
        const flipped = applyAction(cur, {
          type: 'flip_retake_choice',
          params: { groupId, alternativeId },
        });
        if (!analysis) return flipped;
        const captions = chunkCaptions(analysis.words, flipped.clips, {
          customSpellings: flipped.customSpellings ?? [],
        });
        return applyAction(flipped, {
          type: 'generate_captions',
          params: { captions },
        });
      });
    },
    [analysis, mutate],
  );

  const generateCaptions = useCallback(() => {
    if (!analysis) return;
    mutate((cur) => {
      const captions = chunkCaptions(analysis.words, cur.clips, {
        customSpellings: cur.customSpellings ?? [],
      });
      return applyAction(cur, { type: 'generate_captions', params: { captions } });
    });
  }, [analysis, mutate]);

  /**
   * Combined pipeline — triggered by the "Analyze audio" button and the
   * Auto-Cut settings panel's "Re-apply cuts". Runs the SAME four staged
   * detectors as the server pipeline (cutPipeline.ts: silences → fillers
   * → stutters → retakes) against the stored analysis.json — no
   * re-transcription — honouring plan.cutSettings, then regenerates
   * captions against the post-cut clips.
   *
   * Everything commits as a SINGLE history entry so one ⌘Z reverts back
   * to the state before Analyze.
   */
  const runAutoCutAndCaptions = useCallback(() => {
    setLastAutoCut(null);
    if (!analysis) return;
    mutate((cur) => {
      const cut = runCutStages({
        duration: cur.sourceDuration,
        words: analysis.words,
        silences: analysis.silences,
        fillerWords: cur.fillerWords,
        settings: cur.cutSettings,
      });
      setLastAutoCut({
        ...cut.stats,
        silenceCuts: cut.stages.silences.cutCount,
        fillerCuts: cut.stages.fillers.cutCount,
        stutterCuts: cut.stages.stutters.phrasesRemoved,
        singleWordCuts: cut.stages.stutters.singleWordsRemoved,
        fragmentCuts: cut.stages.stutters.fragmentsRemoved,
        retakeCuts: cut.stages.retakes.cutCount,
        retakeGroups: cut.stages.retakes.groupsFound,
      });
      const afterCut = applyAction(cur, {
        type: 'auto_cut',
        params: { clips: cut.clips, stats: cut.stats },
      });

      const captions = chunkCaptions(analysis.words, afterCut.clips, {
        customSpellings: afterCut.customSpellings ?? [],
      });
      const withCaptions = applyAction(afterCut, {
        type: 'generate_captions',
        params: { captions },
      });
      // Retake alternates + cut annotations ride outside the action log
      // (same policy as the server pipeline) — undo restores full
      // snapshots, so these revert with everything else.
      return { ...withCaptions, retakeGroups: cut.retakeGroups, cutLog: cut.cutLog };
    });
  }, [analysis, mutate]);

  /** Patch the auto-cut tuning (silence threshold, retake preference). */
  const setCutSettings = useCallback((patch: Partial<CutSettings>) => {
    mutate((cur) => applyAction(cur, { type: 'set_cut_settings', params: patch }));
  }, [mutate]);

  /** Replace the project's filler-word list. Takes effect on the next
   *  auto-cut run (runAutoCutAndCaptions). */
  const setFillerWords = useCallback((fillerWords: string[]) => {
    const clean = Array.from(
      new Set(fillerWords.map((w) => w.trim().toLowerCase()).filter(Boolean)),
    );
    mutate((cur) => applyAction(cur, {
      type: 'update_filler_words',
      params: { fillerWords: clean },
    }));
  }, [mutate]);

  /**
   * Restore removed source range(s) back onto the timeline as clips
   * ("undo this one cut" from a removed-segment marker), then regenerate
   * captions so the restored words appear. One history entry.
   */
  const restoreGap = useCallback((ranges: { start: number; end: number }[]) => {
    mutate((cur) => {
      const restored = applyAction(cur, { type: 'restore_gap', params: { ranges } });
      if (restored.clips === cur.clips) return null;
      if (!analysis) return restored;
      const captions = chunkCaptions(analysis.words, restored.clips, {
        customSpellings: restored.customSpellings ?? [],
      });
      return applyAction(restored, {
        type: 'generate_captions',
        params: { captions },
      });
    });
  }, [analysis, mutate]);

  /**
   * Re-time existing captions onto the current clips WITHOUT regenerating
   * the text. Used when clips change after captions have been created —
   * preserves any manual edits while keeping timing in sync.
   */
  const resyncCaptions = useCallback(() => {
    if (!analysis) return;
    mutate((cur) => {
      const captions = chunkCaptions(analysis.words, cur.clips, {
        customSpellings: cur.customSpellings ?? [],
      });
      return applyAction(cur, {
        type: 'generate_captions',
        params: { captions },
      });
    });
  }, [analysis, mutate]);

  const insertCaption = useCallback((startMs: number, endMs: number, text?: string) => {
    let newId: string | null = null;
    mutate((cur) => {
      const before = new Set(cur.captions.map((c) => c.id));
      const next = applyAction(cur, { type: 'insert_caption', params: { startMs, endMs, text } });
      newId = next.captions.find((c) => !before.has(c.id))?.id ?? null;
      return next;
    });
    if (newId) {
      setSelectedCaptionId(newId);
      setSelectedClipId(null);
    }
    return newId;
  }, [mutate, setSelectedCaptionId, setSelectedClipId]);

  const updateCaption = useCallback((captionId: string, text: string) => {
    mutate((cur) => applyAction(cur, { type: 'update_caption', params: { captionId, text } }));
  }, [mutate]);

  const moveCaption = useCallback((captionId: string, deltaMs: number) => {
    mutate((cur) => applyAction(cur, { type: 'move_caption', params: { captionId, deltaMs } }));
  }, [mutate]);

  const deleteCaption = useCallback((captionId: string) => {
    mutate((cur) => applyAction(cur, { type: 'delete_caption', params: { captionId } }));
    setSelectedCaptionId((cur) => (cur === captionId ? null : cur));
  }, [mutate]);

  // --- Free text overlays (separate layer from transcript captions) ---
  const insertOverlay = useCallback((startMs: number, endMs: number, text?: string) => {
    let newId: string | null = null;
    mutate((cur) => {
      const before = new Set((cur.overlays ?? []).map((o) => o.id));
      const next = applyAction(cur, { type: 'insert_overlay', params: { startMs, endMs, text } });
      newId = (next.overlays ?? []).find((o) => !before.has(o.id))?.id ?? null;
      return next;
    });
    return newId;
  }, [mutate]);

  const updateOverlay = useCallback((overlayId: string, text: string) => {
    mutate((cur) => applyAction(cur, { type: 'update_overlay', params: { overlayId, text } }));
  }, [mutate]);

  const setOverlayTime = useCallback((overlayId: string, startMs: number, endMs: number) => {
    mutate((cur) => applyAction(cur, { type: 'set_overlay_time', params: { overlayId, startMs, endMs } }));
  }, [mutate]);

  const patchOverlayStyle = useCallback((overlayId: string, style: Partial<CaptionStyle>) => {
    mutate((cur) => applyAction(cur, { type: 'patch_overlay_style', params: { overlayId, style } }));
  }, [mutate]);

  const deleteOverlay = useCallback((overlayId: string) => {
    mutate((cur) => applyAction(cur, { type: 'delete_overlay', params: { overlayId } }));
  }, [mutate]);

  const setHeader = useCallback((header: HeaderConfig | null) => {
    mutate((cur) => applyAction(cur,
      header
        ? { type: 'set_header', params: header }
        : { type: 'clear_header', params: {} },
    ));
  }, [mutate]);

  const setCaptionStyle = useCallback((patch: Partial<CaptionStyle>) => {
    // Style edits propagate globally AND strip any matching per-caption
    // overrides, so dragging / recolouring one caption updates them all.
    // Text edits remain per-caption (updateCaption) — obviously distinct
    // text per caption. Explicit per-caption style overrides still exist
    // via setCaptionStyleOverride for opt-in asymmetry.
    mutate((cur) => applyAction(cur, { type: 'set_caption_style_all', params: patch }));
  }, [mutate]);

  const setCaptionStyleOverride = useCallback(
    (captionId: string, style: Partial<CaptionStyle> | null) => {
      mutate((cur) => applyAction(cur, {
        type: 'set_caption_style_override',
        params: { captionId, style },
      }));
    },
    [mutate],
  );

  const mergeCaptionWithNext = useCallback((captionId: string) => {
    mutate((cur) => applyAction(cur, {
      type: 'merge_caption_with_next',
      params: { captionId },
    }));
  }, [mutate]);

  const setCaptionEmphasizedWord = useCallback(
    (captionId: string, index: number | null) => {
      mutate((cur) => applyAction(cur, {
        type: 'set_caption_emphasized_word',
        params: { captionId, index },
      }));
    },
    [mutate],
  );

  const setCustomSpellings = useCallback((spellings: SpellingCorrection[]) => {
    mutate((cur) => applyAction(cur, {
      type: 'set_custom_spellings',
      params: { spellings },
    }));
  }, [mutate]);

  const totalEditedMs = useMemo(
    () => (plan ? editedDurationMs(plan) : 0),
    [plan],
  );

  return {
    plan,
    analysis,
    loading,
    saveError,
    reload,
    flushSave,
    lastAutoCut,
    selectedClipId,
    setSelectedClipId,
    selectedCaptionId,
    setSelectedCaptionId,
    playheadEditedMs,
    setPlayheadEditedMs,
    editedDurationMs: totalEditedMs,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    actions: {
      runAutoCutAndCaptions,
      setCutSettings,
      setFillerWords,
      restoreGap,
      resyncCaptions,
      splitAt,
      deleteClip,
      reorderClips,
      trimClip,
      setClipSpeed,
      flipRetake,
      generateCaptions,
      insertCaption,
      updateCaption,
      moveCaption,
      deleteCaption,
      insertOverlay,
      updateOverlay,
      setOverlayTime,
      patchOverlayStyle,
      deleteOverlay,
      setHeader,
      setCaptionStyle,
      setCaptionStyleOverride,
      mergeCaptionWithNext,
      setCaptionEmphasizedWord,
      setCustomSpellings,
      undo,
      redo,
    },
  };
}
