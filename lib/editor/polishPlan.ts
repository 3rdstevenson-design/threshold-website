/**
 * polishPlan.ts
 *
 * Given an existing EditPlan (the user's hand-tuned round-1 output) and
 * a list of additional source-time ranges to remove (from the Claude
 * disfluency pass), produce a NEW plan whose clips[] reflects BOTH the
 * user's existing cuts AND the polish cuts, with captions re-chunked
 * against the fresh clip structure.
 *
 * Purely compositional over lib/editor helpers — no I/O, no mutation
 * of the input plan.
 */
import {
  mergeRanges,
  invertRanges,
  type Range,
  type Word,
} from './autoCut';
import {
  EditPlan,
  Clip,
  Caption,
  clipEditedMs,
  editedMsToSource,
  randomId,
} from './editPlan';
import { chunkCaptions } from './captionChunker';

export type PolishStats = {
  /** Additional ranges removed on top of the user's existing cuts. */
  extraRanges: number;
  /** Total source-time seconds removed by the polish layer alone. */
  extraSecondsRemoved: number;
  /** Final clip count after merging. */
  clipCount: number;
  /** Final edited duration (ms) of the polished plan. */
  editedDurationMs: number;
};

/**
 * Build a polished plan from an existing plan + extra skip ranges.
 *
 * The process:
 *   1. Convert the user's existing clips[] into its complement — the
 *      set of source-time ranges they'd already removed.
 *   2. Merge the user's removals with the Claude-proposed skip ranges.
 *   3. Invert the merged removals back into a new keep[] over the full
 *      source duration. This is the polished clip list.
 *   4. Re-chunk captions from the original word transcript against the
 *      new clip structure. Word-level timestamps are preserved — only
 *      edited-timeline positions change.
 */
export function buildPolishedPlan(input: {
  basePlan: EditPlan;
  words: Word[];
  extraSkipRanges: Range[];
  minClipSeconds?: number;
}): { plan: EditPlan; stats: PolishStats } {
  const minClip = input.minClipSeconds ?? 1.0;
  const duration = input.basePlan.sourceDuration;

  // 1. Current cuts = complement of existing clips over [0, duration].
  const existingCuts = clipsToRemoveRanges(input.basePlan.clips, duration);

  // 2. Merge all removals.
  const allRemovals = mergeRanges([...existingCuts, ...input.extraSkipRanges]);

  // 3. Invert back to keep[].
  const keep = invertRanges(allRemovals, duration);

  // 4. Drop tiny clips (same safety valve as auto-cut).
  const polishedClips: Clip[] = keep
    .filter((r) => r.end - r.start >= minClip)
    .map((r) => ({
      id: randomId('clip'),
      sourceStart: r.start,
      sourceEnd: r.end,
    }));

  // 5. Re-chunk captions from the full word list against the polished
  // clips. We reuse the round-1 chunker for visual consistency with
  // every other part of the editor.
  const captions: Caption[] = carryCaptionEdits(
    input.basePlan,
    polishedClips,
    chunkCaptions(input.words, polishedClips, {
      customSpellings: input.basePlan.customSpellings,
    }),
  );

  const editedDurationMs = polishedClips.reduce(
    (sum, c) => sum + clipEditedMs(c),
    0,
  );

  // Carry over user-configured fields (captionStyle, header, fillerWords,
  // customSpellings, slug, sourceVideo). Replace clips + captions.
  // History gets a single audit-trail entry so future inspections know
  // this plan was produced by the polish layer.
  const plan: EditPlan = {
    ...input.basePlan,
    clips: polishedClips,
    captions,
    history: [
      ...input.basePlan.history,
      {
        id: randomId('act'),
        type: 'auto_cut',
        at: new Date().toISOString(),
        params: {
          source: 'polish',
          extraRanges: input.extraSkipRanges.length,
        },
      },
    ],
  };

  const baseRemoved = existingCuts.reduce((s, r) => s + (r.end - r.start), 0);
  const totalRemoved = allRemovals.reduce((s, r) => s + (r.end - r.start), 0);
  const stats: PolishStats = {
    extraRanges: input.extraSkipRanges.length,
    extraSecondsRemoved: Math.max(0, totalRemoved - baseRemoved),
    clipCount: polishedClips.length,
    editedDurationMs,
  };

  return { plan, stats };
}

/**
 * Turn a clips[] list into the removal-ranges that produced it.
 * clips[0].start → first cut is [0, clip0.start] if non-zero.
 * Between consecutive clips: [prev.end, next.start].
 * After last clip: [last.end, duration].
 */
function clipsToRemoveRanges(clips: Clip[], duration: number): Range[] {
  if (clips.length === 0) return [{ start: 0, end: duration }];
  const sorted = [...clips].sort((a, b) => a.sourceStart - b.sourceStart);
  const out: Range[] = [];
  if (sorted[0].sourceStart > 0) {
    out.push({ start: 0, end: sorted[0].sourceStart });
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].sourceStart - sorted[i].sourceEnd;
    if (gap > 0) {
      out.push({ start: sorted[i].sourceEnd, end: sorted[i + 1].sourceStart });
    }
  }
  const last = sorted[sorted.length - 1];
  if (last.sourceEnd < duration) {
    out.push({ start: last.sourceEnd, end: duration });
  }
  return out;
}


/**
 * Caption text edits made in the editor (during review, say) used to be
 * lost here because polish re-chunks from the raw words. Carry them over.
 *
 * Edits are found in the base plan's history (`update_caption` actions).
 * Because update_caption re-derives words[] from the new text, the only
 * invariant across runs is SOURCE time: map each edited base caption's
 * start back to source ms through the base clips, map each fresh chunk's
 * start through the polished clips, and match within a tolerance. Timing
 * always comes from the fresh chunk. Exported for tests.
 */
export function carryCaptionEdits(
  basePlan: Pick<EditPlan, 'captions' | 'clips' | 'history'>,
  polishedClips: Clip[],
  fresh: Caption[],
  toleranceMs = 60,
): Caption[] {
  const editedIds = new Set<string>();
  for (const a of basePlan.history ?? []) {
    if (a.type === 'update_caption') {
      const id = (a.params as { captionId?: string }).captionId;
      if (id) editedIds.add(id);
    }
  }
  if (editedIds.size === 0) return fresh;
  const basePlanForMap = { clips: basePlan.clips } as EditPlan;
  const polishedForMap = { clips: polishedClips } as EditPlan;
  const edited: { sourceMs: number; cap: Caption }[] = [];
  for (const c of basePlan.captions) {
    if (!editedIds.has(c.id)) continue;
    const m = editedMsToSource(basePlanForMap, c.startMs);
    if (m) edited.push({ sourceMs: m.sourceMs, cap: c });
  }
  if (edited.length === 0) return fresh;
  const used = new Set<number>();
  return fresh.map((f) => {
    const m = editedMsToSource(polishedForMap, f.startMs);
    if (!m) return f;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < edited.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(edited[i].sourceMs - m.sourceMs);
      if (d <= toleranceMs && d < bestD) { best = i; bestD = d; }
    }
    if (best < 0) return f;
    used.add(best);
    const hit = edited[best].cap;
    return { ...f, text: hit.text, ...(hit.style ? { style: hit.style } : {}) };
  });
}
