/**
 * editPlan.ts
 *
 * The edit plan is the single source of truth for a project's edit state.
 * Every UI action mutates it; preview plays from it; export renders from it.
 *
 * Two time spaces coexist:
 *   - Source time: seconds within the original source.mp4
 *   - Edited time: milliseconds on the timeline AFTER cuts are applied
 *
 * clips[]      — in source-time seconds (sourceStart, sourceEnd)
 * captions[]   — in edited-time milliseconds
 * header       — in edited-time milliseconds (via fadeAfterSeconds)
 *
 * This module is isomorphic: no Node-only imports. Filesystem I/O lives
 * in `planStore.ts` which is server-only.
 */
import { DEFAULT_FILLER_WORDS } from './fillerWords';

export const EDIT_PLAN_VERSION = 3;

/**
 * Stepped playback-speed presets offered by the UI. `speed` on a clip is
 * stored as a plain number so any positive factor loads, but the editor
 * only ever writes these values.
 */
export const CLIP_SPEED_PRESETS = [0.3, 0.5, 1, 2, 3, 4] as const;

export type Clip = {
  id: string;
  sourceStart: number; // seconds
  sourceEnd: number;   // seconds
  /** Why this clip exists as its own segment (set by the auto-cut stages). */
  reason?: 'silence' | 'retake' | 'filler' | 'manual';
  /** Retake-group id (plan.retakeGroups) this clip is the keeper for. */
  group?: string;
  /**
   * Playback speed factor. 1 (or absent) = normal. 2 = twice as fast, so
   * the clip occupies HALF its source duration on the edited timeline.
   * Every edited-time computation must divide source duration by this —
   * use clipEditedMs()/clipSpeed() instead of raw (sourceEnd - sourceStart).
   */
  speed?: number;
};

/** The effective speed of a clip — guards absent/zero/negative values. */
export function clipSpeed(c: Clip): number {
  const s = c.speed;
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : 1;
}

/** A clip's duration on the EDITED timeline in ms, speed applied. */
export function clipEditedMs(c: Clip): number {
  return (Math.max(0, c.sourceEnd - c.sourceStart) * 1000) / clipSpeed(c);
}

/** One candidate take within a retake group (source-time seconds). */
export type RetakeAlternative = {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  transcript: string;
  meanConfidence?: number;
};

/**
 * A detected "same line said multiple times" cluster. Alternates live HERE,
 * not in clips[] — clips[] holds only the kept take, so the time-mapping
 * functions and every clips[] consumer stay untouched. Flipping the choice
 * (flip_retake_choice) swaps the keeper clip's source range with another
 * alternative's.
 */
export type RetakeGroup = {
  id: string;
  /** Chronological candidates, including the currently-kept one. */
  alternatives: RetakeAlternative[];
  /** Which alternative is currently on the timeline. */
  keptAlternativeId: string;
  /** True when the auto-choice was uncertain — surface for review. */
  flagged: boolean;
  reason: string;
};

/**
 * CaptionStyle lives on `plan.captionStyle` (global default for all
 * captions in this project). Individual captions can provide a
 * `Partial<CaptionStyle>` under `Caption.style` to override any subset
 * of these fields.
 *
 * Resolution at render time: { ...plan.captionStyle, ...caption.style }
 */
export type CaptionAnimation =
  | 'instant'
  | 'fade'
  | 'pop'
  | 'bounce'
  | 'zoom'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'shake';

/**
 * Caption display mode.
 * - 'chunks'  = classic Threshold style. The whole caption is one colored
 *               block (default threshold-purple) that pops in and out in
 *               2–4 word chunks.
 * - 'karaoke' = iPhone-edit-style. Full phrase stays on screen as black
 *               text on a white pill; the currently-spoken word is
 *               highlighted in `activeColor` (default threshold-purple)
 *               and the highlight travels across the phrase as time
 *               advances. Requires per-caption `words[]` to be populated.
 */
/**
 * - 'chunks'  = whole caption as a single colored block (3-4 word clips).
 * - 'karaoke' = full phrase visible, active word highlighted in activeColor.
 * - 'word'    = single active word at a time, following speech word-by-word.
 */
export type CaptionMode = 'chunks' | 'karaoke' | 'word';

export type CaptionStyle = {
  color: string;            // text fill (passive in karaoke mode)
  strokeColor: string;      // outline color (or '' for no stroke)
  strokeWidth: number;      // preview stroke in px (0-4). Remotion scales proportionally.
  fontFamily: 'nunito' | 'montserrat' | 'cormorant';
  fontSizeMultiplier: number; // 0.6 … 1.8
  position: 'top' | 'center' | 'bottom';
  background: 'none' | 'dark' | 'white';
  /**
   * Entry animation — controls how a caption appears when its time
   * window begins. 'instant' (default) = no animation.
   */
  animation: CaptionAnimation;
  /**
   * Which renderer to use. Defaults to 'chunks' for back-compat.
   */
  mode: CaptionMode;
  /**
   * Only used when `mode === 'karaoke'` — color of the "currently
   * spoken" word. Defaults to threshold-purple so an existing plan's
   * text color (black/white) stays passive and the active word pops.
   */
  activeColor: string;
  /**
   * Free-form positional offset from the `position` anchor, expressed as
   * percentage of the video's shorter side (cqi units in the preview).
   * Set by drag-to-reposition on the live preview. 0 = no offset.
   */
  positionOffsetX: number;
  positionOffsetY: number;
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  color: '#7002AB',        // threshold-purple
  strokeColor: '#FFFFFF',
  strokeWidth: 2,
  fontFamily: 'montserrat',
  fontSizeMultiplier: 1.0,
  position: 'bottom',
  background: 'none',
  animation: 'instant',
  mode: 'chunks',
  activeColor: '#7002AB',
  positionOffsetX: 0,
  positionOffsetY: 0,
};

/**
 * Word-level timing inside a caption. Populated by the chunker so the
 * karaoke renderer can highlight one word at a time. Chunks renderer
 * ignores this.
 */
export type CaptionWord = {
  text: string;
  startMs: number; // edited timeline
  endMs: number;   // edited timeline
};

export type Caption = {
  id: string;
  text: string;
  startMs: number; // edited timeline
  endMs: number;   // edited timeline
  style?: Partial<CaptionStyle>; // per-caption override
  /**
   * Per-word timing inside this caption. Added by the chunker when
   * available; optional for back-compat with older plans. Sum of
   * word text should match caption.text (whitespace-normalized).
   */
  words?: CaptionWord[];
  /**
   * Karaoke-mode override. When set, this word index stays highlighted
   * in `activeColor` for the whole caption duration instead of the
   * auto-travelling time-based highlight. Click a word in the preview
   * to set/clear.
   */
  emphasizedWordIndex?: number;
};

export type HeaderConfig = {
  text: string;
  position: 'top' | 'bottom';
  durationMode: 'full' | 'fadeAfter';
  fadeAfterSeconds?: number;
  /** Drag offset from the base position, in cqi units (% of video width), like captions. */
  positionOffsetX?: number;
  positionOffsetY?: number;
};

export type EditAction = {
  id: string;
  type:
    | 'create_plan'
    | 'auto_cut'
    | 'split_clip'
    | 'delete_clip'
    | 'reorder_clips'
    | 'trim_clip'
    | 'generate_captions'
    | 'insert_caption'
    | 'update_caption'
    | 'move_caption'
    | 'delete_caption'
    | 'set_header'
    | 'clear_header'
    | 'update_filler_words'
    | 'set_caption_style'           // global caption-style patch
    | 'set_caption_style_all'       // global patch + strip same fields from every per-caption override
    | 'set_caption_style_override'  // per-caption override (or clear)
    | 'merge_caption_with_next'     // join a caption with the one after it
    | 'set_caption_emphasized_word' // karaoke static highlight (or clear)
    | 'set_custom_spellings'        // replace the custom-spellings list
    | 'flip_retake_choice'          // swap which take a retake group keeps
    | 'set_clip_speed'              // per-clip stepped playback speed
    | 'insert_overlay'             // free text-overlay layer (separate from transcript captions)
    | 'update_overlay'
    | 'set_overlay_time'
    | 'patch_overlay_style'
    | 'delete_overlay';
  at: string; // ISO timestamp
  params: unknown;
};

/**
 * A single spelling correction applied to caption text AFTER chunking.
 * Matches `from` case-insensitively with word boundaries; inserts `to`
 * verbatim so diacritics / proper capitalization are preserved.
 */
export type SpellingCorrection = {
  from: string;  // e.g. "coach cav"
  to: string;    // e.g. "Coach Kav"
};

/**
 * Default spellings seeded on every new plan. Users can add more via
 * the CustomSpellingsPanel. These are domain-specific mis-transcriptions
 * known from the Threshold team's common vocabulary.
 */
export const DEFAULT_SPELLING_CORRECTIONS: SpellingCorrection[] = [
  { from: 'coach cav',        to: 'Coach Kav' },
  { from: 'soren kierkegaard', to: 'Søren Kierkegaard' },
  { from: 'kierkegaard',      to: 'Kierkegaard' },
];

export type Overlay = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  /** Reuses CaptionStyle fields (color, fontFamily, fontSizeMultiplier, positionOffsetX/Y, …). */
  style?: Partial<CaptionStyle>;
};

export type EditPlan = {
  /**
   * 1 = pre-retake plans; 2 = adds clip metadata + retakeGroups;
   * 3 = adds per-clip speed. All additions are optional fields, so every
   * older version keeps loading (validatePlan accepts ≤ current).
   */
  version: 1 | 2 | 3;
  slug: string;
  sourceVideo: string;   // path relative to my-video-projects root
  sourceDuration: number; // seconds
  clips: Clip[];
  captions: Caption[];
  header: HeaderConfig | null;
  /** Free user-added text overlays — a separate layer from transcript captions. */
  overlays?: Overlay[];
  fillerWords: string[];
  /**
   * Global caption style used as the default for every caption that
   * doesn't provide its own `Caption.style` override. Optional for
   * backward compatibility — DEFAULT_CAPTION_STYLE is used when absent.
   */
  captionStyle?: CaptionStyle;
  /**
   * Per-project spelling corrections applied to every caption after
   * chunking. Optional for backward compatibility — DEFAULT_SPELLING_
   * CORRECTIONS is used when absent.
   */
  customSpellings?: SpellingCorrection[];
  /**
   * Retake groups detected by the auto-cut retake stage. Optional —
   * absent on version-1 plans and projects analyzed before the stage
   * existed. Alternates are swapped onto the timeline via the
   * `flip_retake_choice` action.
   */
  retakeGroups?: RetakeGroup[];
  history: EditAction[];
};

/**
 * Returns the word timings to use for per-word rendering (karaoke / word
 * modes). If the caption's stored `words[]` disagrees with the current
 * text (e.g. the user split "LEAPINTO" → "LEAP INTO" on an older plan
 * before the update_caption reducer learned to re-tokenize), we derive
 * fresh timings by proportionally distributing the caption's time
 * window across the new tokens, using character count as the weight.
 */
export function deriveRenderWords(caption: Caption): CaptionWord[] {
  const tokens = caption.text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const existing = caption.words;
  const dur = Math.max(0, caption.endMs - caption.startMs);
  const sameShape =
    !!existing &&
    existing.length === tokens.length &&
    existing.every((w, i) => w.text.trim() === tokens[i]);
  // Progressive-reveal needs word timings to span the caption window
  // so activeWordIndex lands on a real word while the caption is on
  // screen. If the stored timings sit entirely before / after / far
  // inside the window, redistribute even when the token shape matches.
  const slack = Math.max(120, dur * 0.25);
  const fits =
    sameShape &&
    existing![0].startMs <= caption.startMs + slack &&
    existing![existing!.length - 1].endMs >= caption.endMs - slack;
  if (fits) return existing!;
  const totalChars = tokens.reduce((sum, t) => sum + t.length, 0) || 1;
  let acc = 0;
  return tokens.map((tok) => {
    const start = caption.startMs + (acc / totalChars) * dur;
    acc += tok.length;
    const end = caption.startMs + (acc / totalChars) * dur;
    return { text: tok, startMs: start, endMs: end };
  });
}

/** Resolve the effective style for a single caption. */
export function resolveCaptionStyle(
  global: CaptionStyle | undefined,
  override: Partial<CaptionStyle> | undefined,
): CaptionStyle {
  return {
    ...DEFAULT_CAPTION_STYLE,
    ...(global ?? {}),
    ...(override ?? {}),
  };
}

// ── Validation ─────────────────────────────────────────────────────

export function validatePlan(x: unknown): x is EditPlan {
  if (!x || typeof x !== 'object') return false;
  const p = x as Partial<EditPlan>;
  return (
    // Accept every version up to the current one — version-1 plans predate
    // retake groups and must keep loading (all v2 additions are optional).
    typeof p.version === 'number' &&
    p.version >= 1 &&
    p.version <= EDIT_PLAN_VERSION &&
    typeof p.slug === 'string' &&
    typeof p.sourceVideo === 'string' &&
    typeof p.sourceDuration === 'number' &&
    Array.isArray(p.clips) &&
    Array.isArray(p.captions) &&
    Array.isArray(p.fillerWords) &&
    Array.isArray(p.history)
  );
}

/**
 * Migrate an older plan to the current version. Every bump so far
 * (v1 → v2 retake groups, v2 → v3 clip speed) is purely additive
 * (optional fields), so the only transform is stamping the version.
 * Call after validatePlan on load.
 */
export function migratePlan(plan: EditPlan): EditPlan {
  if (plan.version === EDIT_PLAN_VERSION) return plan;
  return { ...plan, version: EDIT_PLAN_VERSION };
}

// ── Plan construction ──────────────────────────────────────────────

export function createPlan(input: {
  slug: string;
  sourceVideo: string;
  sourceDuration: number;
}): EditPlan {
  return {
    version: EDIT_PLAN_VERSION,
    slug: input.slug,
    sourceVideo: input.sourceVideo,
    sourceDuration: input.sourceDuration,
    clips: [
      {
        id: randomId('clip'),
        sourceStart: 0,
        sourceEnd: input.sourceDuration,
      },
    ],
    captions: [],
    header: null,
    fillerWords: [...DEFAULT_FILLER_WORDS],
    captionStyle: { ...DEFAULT_CAPTION_STYLE },
    customSpellings: DEFAULT_SPELLING_CORRECTIONS.map((s) => ({ ...s })),
    history: [
      {
        id: randomId('act'),
        type: 'create_plan',
        at: new Date().toISOString(),
        params: {},
      },
    ],
  };
}

// ── Derived values ─────────────────────────────────────────────────

export function editedDurationMs(plan: EditPlan): number {
  return plan.clips.reduce((sum, c) => sum + clipEditedMs(c), 0);
}

/**
 * Map a source-time millisecond to its position on the edited timeline.
 * Returns null if the source ms lands inside a cut (removed) region.
 */
export function sourceMsToEditedMs(
  plan: EditPlan,
  sourceMs: number,
): number | null {
  let acc = 0;
  for (const clip of plan.clips) {
    const s = clip.sourceStart * 1000;
    const e = clip.sourceEnd * 1000;
    if (sourceMs >= s && sourceMs <= e) {
      return acc + (sourceMs - s) / clipSpeed(clip);
    }
    acc += clipEditedMs(clip);
  }
  return null;
}

/**
 * Map an edited-time millisecond back to source time. Used by the video
 * preview to decide which source segment to play.
 */
export function editedMsToSource(
  plan: EditPlan,
  editedMs: number,
): { clipIndex: number; sourceMs: number } | null {
  let acc = 0;
  for (let i = 0; i < plan.clips.length; i++) {
    const c = plan.clips[i];
    const clipMs = clipEditedMs(c);
    if (editedMs <= acc + clipMs) {
      return {
        clipIndex: i,
        sourceMs: c.sourceStart * 1000 + (editedMs - acc) * clipSpeed(c),
      };
    }
    acc += clipMs;
  }
  // Past end — clamp to last clip end
  if (plan.clips.length === 0) return null;
  const last = plan.clips[plan.clips.length - 1];
  return { clipIndex: plan.clips.length - 1, sourceMs: last.sourceEnd * 1000 };
}

// ── Mutations ──────────────────────────────────────────────────────

export function applyAction(plan: EditPlan, action: EditActionInput): EditPlan {
  const fullAction: EditAction = {
    id: randomId('act'),
    at: new Date().toISOString(),
    ...action,
  };
  const next = applyActionInternal(plan, fullAction);
  return {
    ...next,
    history: [...next.history, fullAction],
  };
}

type EditActionInput =
  | { type: 'auto_cut'; params: { clips: Clip[]; stats: { removedCount: number; removedSeconds: number } } }
  | { type: 'split_clip'; params: { clipId: string; atSourceSeconds: number } }
  | { type: 'delete_clip'; params: { clipId: string } }
  | { type: 'reorder_clips'; params: { clipIds: string[] } }
  | { type: 'trim_clip'; params: { clipId: string; sourceStart?: number; sourceEnd?: number } }
  | { type: 'generate_captions'; params: { captions: Caption[] } }
  | { type: 'insert_caption'; params: { startMs: number; endMs: number; text?: string } }
  | { type: 'update_caption'; params: { captionId: string; text: string } }
  | { type: 'move_caption'; params: { captionId: string; deltaMs: number } }
  | { type: 'delete_caption'; params: { captionId: string } }
  | { type: 'set_header'; params: HeaderConfig }
  | { type: 'clear_header'; params: Record<string, never> }
  | { type: 'update_filler_words'; params: { fillerWords: string[] } }
  | { type: 'set_caption_style'; params: Partial<CaptionStyle> }
  | { type: 'set_caption_style_all'; params: Partial<CaptionStyle> }
  | { type: 'set_caption_style_override'; params: { captionId: string; style: Partial<CaptionStyle> | null } }
  | { type: 'merge_caption_with_next'; params: { captionId: string } }
  | { type: 'set_caption_emphasized_word'; params: { captionId: string; index: number | null } }
  | { type: 'set_custom_spellings'; params: { spellings: SpellingCorrection[] } }
  | { type: 'flip_retake_choice'; params: { groupId: string; alternativeId: string } }
  | { type: 'set_clip_speed'; params: { clipId: string; speed: number } }
  | { type: 'insert_overlay'; params: { startMs: number; endMs: number; text?: string } }
  | { type: 'update_overlay'; params: { overlayId: string; text: string } }
  | { type: 'set_overlay_time'; params: { overlayId: string; startMs: number; endMs: number } }
  | { type: 'patch_overlay_style'; params: { overlayId: string; style: Partial<CaptionStyle> } }
  | { type: 'delete_overlay'; params: { overlayId: string } };

function applyActionInternal(plan: EditPlan, action: EditAction): EditPlan {
  switch (action.type) {
    case 'auto_cut': {
      const { clips } = action.params as { clips: Clip[] };
      return { ...plan, clips: clips.map((c) => ({ ...c, id: c.id ?? randomId('clip') })) };
    }
    case 'split_clip': {
      const { clipId, atSourceSeconds } = action.params as { clipId: string; atSourceSeconds: number };
      const idx = plan.clips.findIndex((c) => c.id === clipId);
      if (idx === -1) return plan;
      const clip = plan.clips[idx];
      if (atSourceSeconds <= clip.sourceStart || atSourceSeconds >= clip.sourceEnd) return plan;
      // Both halves inherit the clip's speed so the split is time-neutral.
      const left: Clip = { ...clip, sourceEnd: atSourceSeconds };
      const right: Clip = { ...clip, id: randomId('clip'), sourceStart: atSourceSeconds };
      const next = [...plan.clips];
      next.splice(idx, 1, left, right);
      return { ...plan, clips: next };
    }
    case 'delete_clip': {
      // Cascade-delete any captions that fell inside the deleted clip's
      // edited-time window, and shift captions that came after it left
      // by the deleted duration. All in one atomic update so there's no
      // visible window of stale captions.
      const { clipId } = action.params as { clipId: string };
      const idx = plan.clips.findIndex((c) => c.id === clipId);
      if (idx === -1) return plan;
      let rangeStart = 0;
      for (let i = 0; i < idx; i++) {
        rangeStart += clipEditedMs(plan.clips[i]);
      }
      const clip = plan.clips[idx];
      const deletedMs = clipEditedMs(clip);
      const rangeEnd = rangeStart + deletedMs;

      const captions = plan.captions
        // Drop captions whose window overlaps the deleted region.
        .filter((cap) => cap.endMs <= rangeStart || cap.startMs >= rangeEnd)
        // Shift post-range captions left.
        .map((cap) => (
          cap.startMs >= rangeEnd
            ? { ...cap, startMs: cap.startMs - deletedMs, endMs: cap.endMs - deletedMs }
            : cap
        ));

      return {
        ...plan,
        clips: plan.clips.filter((c) => c.id !== clipId),
        captions,
      };
    }
    case 'reorder_clips': {
      const { clipIds } = action.params as { clipIds: string[] };
      const map = new Map(plan.clips.map((c) => [c.id, c]));
      const reordered: Clip[] = [];
      for (const id of clipIds) {
        const c = map.get(id);
        if (c) reordered.push(c);
      }
      // Preserve any not referenced (shouldn't happen, but safe)
      for (const c of plan.clips) if (!clipIds.includes(c.id)) reordered.push(c);
      return { ...plan, clips: reordered };
    }
    case 'trim_clip': {
      const { clipId, sourceStart, sourceEnd } = action.params as {
        clipId: string; sourceStart?: number; sourceEnd?: number;
      };
      return {
        ...plan,
        clips: plan.clips.map((c) => {
          if (c.id !== clipId) return c;
          const s = sourceStart ?? c.sourceStart;
          const e = sourceEnd ?? c.sourceEnd;
          if (e <= s) return c;
          return { ...c, sourceStart: s, sourceEnd: e };
        }),
      };
    }
    case 'generate_captions': {
      const { captions } = action.params as { captions: Caption[] };
      return {
        ...plan,
        captions: captions.map((c) => ({ ...c, id: c.id ?? randomId('cap') })),
      };
    }
    case 'insert_caption': {
      const { startMs, endMs, text } = action.params as { startMs: number; endMs: number; text?: string };
      if (!(endMs > startMs)) return plan;
      const cap: Caption = {
        id: randomId('cap'),
        text: text ?? '',
        startMs,
        endMs,
      };
      // Keep caption list sorted by startMs so downstream code that
      // assumes chronological order (find-active, merge-next) stays correct.
      const next = [...plan.captions, cap].sort((a, b) => a.startMs - b.startMs);
      return { ...plan, captions: next };
    }
    case 'update_caption': {
      const { captionId, text } = action.params as { captionId: string; text: string };
      return {
        ...plan,
        captions: plan.captions.map((c) => {
          if (c.id !== captionId) return c;
          // Re-derive words[] so karaoke mode reflects the edit (e.g.
          // splitting "LEAPINTO" → "LEAP INTO" becomes two words, not
          // one). Timings are redistributed proportionally by character
          // count across the caption's existing [startMs, endMs] window.
          const tokens = text.trim().split(/\s+/).filter(Boolean);
          let words: CaptionWord[] | undefined;
          if (tokens.length > 0) {
            const totalChars = tokens.reduce((sum, t) => sum + t.length, 0) || 1;
            const dur = Math.max(0, c.endMs - c.startMs);
            let acc = 0;
            words = tokens.map((tok) => {
              const start = c.startMs + (acc / totalChars) * dur;
              acc += tok.length;
              const end = c.startMs + (acc / totalChars) * dur;
              return { text: tok, startMs: start, endMs: end };
            });
          }
          // Clear a stale emphasizedWordIndex if it's now out of range.
          const next: Caption = { ...c, text, words };
          if (
            typeof next.emphasizedWordIndex === 'number' &&
            (!words || next.emphasizedWordIndex >= words.length)
          ) {
            const { emphasizedWordIndex: _omit, ...rest } = next;
            return rest;
          }
          return next;
        }),
      };
    }
    case 'move_caption': {
      const { captionId, deltaMs } = action.params as { captionId: string; deltaMs: number };
      return {
        ...plan,
        captions: plan.captions.map((c) =>
          c.id === captionId
            ? { ...c, startMs: Math.max(0, c.startMs + deltaMs), endMs: Math.max(0, c.endMs + deltaMs) }
            : c,
        ),
      };
    }
    case 'delete_caption': {
      const { captionId } = action.params as { captionId: string };
      return { ...plan, captions: plan.captions.filter((c) => c.id !== captionId) };
    }
    case 'insert_overlay': {
      const { startMs, endMs, text } = action.params as { startMs: number; endMs: number; text?: string };
      if (!(endMs > startMs)) return plan;
      const ov: Overlay = { id: randomId('ovl'), text: text ?? 'Text', startMs, endMs };
      const next = [...(plan.overlays ?? []), ov].sort((a, b) => a.startMs - b.startMs);
      return { ...plan, overlays: next };
    }
    case 'update_overlay': {
      const { overlayId, text } = action.params as { overlayId: string; text: string };
      return { ...plan, overlays: (plan.overlays ?? []).map((o) => (o.id === overlayId ? { ...o, text } : o)) };
    }
    case 'set_overlay_time': {
      const { overlayId, startMs, endMs } = action.params as { overlayId: string; startMs: number; endMs: number };
      if (!(endMs > startMs)) return plan;
      const next = (plan.overlays ?? [])
        .map((o) => (o.id === overlayId ? { ...o, startMs, endMs } : o))
        .sort((a, b) => a.startMs - b.startMs);
      return { ...plan, overlays: next };
    }
    case 'patch_overlay_style': {
      const { overlayId, style } = action.params as { overlayId: string; style: Partial<CaptionStyle> };
      return {
        ...plan,
        overlays: (plan.overlays ?? []).map((o) =>
          o.id === overlayId ? { ...o, style: { ...(o.style ?? {}), ...style } } : o,
        ),
      };
    }
    case 'delete_overlay': {
      const { overlayId } = action.params as { overlayId: string };
      return { ...plan, overlays: (plan.overlays ?? []).filter((o) => o.id !== overlayId) };
    }
    case 'set_header': {
      return { ...plan, header: action.params as HeaderConfig };
    }
    case 'clear_header': {
      return { ...plan, header: null };
    }
    case 'update_filler_words': {
      const { fillerWords } = action.params as { fillerWords: string[] };
      return { ...plan, fillerWords };
    }
    case 'set_caption_style': {
      const patch = action.params as Partial<CaptionStyle>;
      const prev = plan.captionStyle ?? DEFAULT_CAPTION_STYLE;
      return { ...plan, captionStyle: { ...prev, ...patch } };
    }
    case 'set_caption_style_all': {
      // Same as set_caption_style, but also strips the patched keys from
      // every per-caption override so the new global actually takes
      // effect everywhere (including captions that previously held an
      // override for those same fields).
      const patch = action.params as Partial<CaptionStyle>;
      const prev = plan.captionStyle ?? DEFAULT_CAPTION_STYLE;
      const patchKeys = Object.keys(patch) as (keyof CaptionStyle)[];
      const captions = plan.captions.map((c) => {
        if (!c.style) return c;
        const filtered: Partial<CaptionStyle> = {};
        let kept = false;
        for (const [k, v] of Object.entries(c.style)) {
          if (patchKeys.includes(k as keyof CaptionStyle)) continue;
          (filtered as Record<string, unknown>)[k] = v;
          kept = true;
        }
        if (kept) return { ...c, style: filtered };
        const { style: _omit, ...rest } = c;
        return rest;
      });
      return { ...plan, captionStyle: { ...prev, ...patch }, captions };
    }
    case 'set_caption_style_override': {
      const { captionId, style } = action.params as {
        captionId: string;
        style: Partial<CaptionStyle> | null;
      };
      return {
        ...plan,
        captions: plan.captions.map((c) => {
          if (c.id !== captionId) return c;
          if (style === null) {
            // Clear override — strip `style` entirely
            const { style: _omit, ...rest } = c;
            return rest;
          }
          return { ...c, style: { ...(c.style ?? {}), ...style } };
        }),
      };
    }
    case 'set_caption_emphasized_word': {
      const { captionId, index } = action.params as { captionId: string; index: number | null };
      return {
        ...plan,
        captions: plan.captions.map((c) => {
          if (c.id !== captionId) return c;
          if (index === null) {
            const { emphasizedWordIndex: _omit, ...rest } = c;
            return rest;
          }
          return { ...c, emphasizedWordIndex: index };
        }),
      };
    }
    case 'merge_caption_with_next': {
      const { captionId } = action.params as { captionId: string };
      const idx = plan.captions.findIndex((c) => c.id === captionId);
      // No-op if not found or this is the last caption.
      if (idx === -1 || idx >= plan.captions.length - 1) return plan;
      const a = plan.captions[idx];
      const b = plan.captions[idx + 1];
      const merged: Caption = {
        ...a,
        text: `${a.text.trim()} ${b.text.trim()}`.replace(/\s+/g, ' ').trim(),
        startMs: Math.min(a.startMs, b.startMs),
        endMs: Math.max(a.endMs, b.endMs),
      };
      const next = [...plan.captions];
      next.splice(idx, 2, merged);
      return { ...plan, captions: next };
    }
    case 'flip_retake_choice': {
      const { groupId, alternativeId } = action.params as {
        groupId: string;
        alternativeId: string;
      };
      const groups = plan.retakeGroups ?? [];
      const group = groups.find((g) => g.id === groupId);
      if (!group) return plan;
      const newAlt = group.alternatives.find((a) => a.id === alternativeId);
      const oldAlt = group.alternatives.find((a) => a.id === group.keptAlternativeId);
      if (!newAlt || !oldAlt || newAlt.id === oldAlt.id) return plan;

      // Range surgery: clips[] holds merged keep-ranges, so the old keeper's
      // utterance is cut OUT of whichever clip(s) contain it, and the chosen
      // alternative's range is spliced back IN at its chronological spot.
      // Tiny remnants left by the subtraction are dropped. Captions are not
      // shifted (same policy as trim_clip) — regenerate captions after
      // flipping if timing drifts.
      const MIN_REMNANT_SECONDS = 0.3;
      const clips: Clip[] = [];
      for (const c of plan.clips) {
        if (c.sourceEnd <= oldAlt.sourceStart || c.sourceStart >= oldAlt.sourceEnd) {
          clips.push(c);
          continue;
        }
        // Left remnant keeps the original id (captions referencing it hold).
        if (oldAlt.sourceStart - c.sourceStart >= MIN_REMNANT_SECONDS) {
          const { group: _g, reason: _r, ...rest } = c;
          clips.push({ ...rest, sourceEnd: oldAlt.sourceStart });
        }
        if (c.sourceEnd - oldAlt.sourceEnd >= MIN_REMNANT_SECONDS) {
          clips.push({
            id: randomId('clip'),
            sourceStart: oldAlt.sourceEnd,
            sourceEnd: c.sourceEnd,
            ...(c.speed !== undefined ? { speed: c.speed } : {}),
          });
        }
      }
      const newClip: Clip = {
        id: randomId('clip'),
        sourceStart: newAlt.sourceStart,
        sourceEnd: newAlt.sourceEnd,
        reason: 'retake',
        group: groupId,
      };
      const insertIdx = clips.findIndex((c) => c.sourceStart > newClip.sourceStart);
      if (insertIdx === -1) clips.push(newClip);
      else clips.splice(insertIdx, 0, newClip);

      const retakeGroups = groups.map((g) =>
        g.id === groupId ? { ...g, keptAlternativeId: alternativeId, flagged: false } : g,
      );
      return { ...plan, clips, retakeGroups };
    }
    case 'set_clip_speed': {
      const { clipId, speed } = action.params as { clipId: string; speed: number };
      if (!(typeof speed === 'number' && Number.isFinite(speed) && speed > 0)) return plan;
      return {
        ...plan,
        clips: plan.clips.map((c) => {
          if (c.id !== clipId) return c;
          if (speed === 1) {
            // Normal speed is the absence of the field — keeps plans clean
            // and byte-identical to their pre-speed form.
            const { speed: _omit, ...rest } = c;
            return rest;
          }
          return { ...c, speed };
        }),
      };
    }
    case 'set_custom_spellings': {
      const { spellings } = action.params as { spellings: SpellingCorrection[] };
      // Normalize: trim both sides, drop entries where either half is empty.
      const clean = spellings
        .map((s) => ({ from: s.from.trim(), to: s.to.trim() }))
        .filter((s) => s.from && s.to);
      return { ...plan, customSpellings: clean };
    }
    default:
      return plan;
  }
}

// ── Utilities ──────────────────────────────────────────────────────

export function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
