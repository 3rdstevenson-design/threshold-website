/**
 * snap.ts — magnetic snapping for timeline drags.
 *
 * Both trim-edge drags (source-time seconds) and caption drags
 * (edited-time ms) snap to nearby targets when the candidate value lands
 * within a tolerance (~8px converted to the drag's time space).
 *
 * Isomorphic — no DOM. The callers convert px → time before snapping.
 */

export type SnapResult = {
  value: number;
  snapped: boolean;
  /** The target that won, when snapped. */
  target?: number;
};

/**
 * Snap `candidate` to the nearest target within `tolerance`. Ties go to
 * the earlier target. Targets equal to `exclude` are ignored — used so a
 * dragged edge never snaps back to its own starting position (which
 * would make sub-tolerance adjustments impossible).
 */
export function snapValue(
  candidate: number,
  targets: readonly number[],
  tolerance: number,
  exclude?: readonly number[],
): SnapResult {
  if (!(tolerance > 0)) return { value: candidate, snapped: false };
  let best: number | undefined;
  let bestDist = Infinity;
  for (const t of targets) {
    if (exclude && exclude.some((x) => Math.abs(x - t) < 1e-9)) continue;
    const d = Math.abs(t - candidate);
    if (d <= tolerance && d < bestDist) {
      best = t;
      bestDist = d;
    }
  }
  if (best === undefined) return { value: candidate, snapped: false };
  return { value: best, snapped: true, target: best };
}
