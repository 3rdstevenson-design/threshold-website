/**
 * reviewFlags.ts — what makes the unattended pipeline stop and ask.
 *
 * Policy: "fully automatic, review only on flags". A clean run renders and
 * promotes with nobody watching. It pauses BEFORE the expensive render
 * when the deterministic + LLM stages surfaced a decision only a human can
 * make, and AFTER the render when the audit gate fails (handled in
 * polishPipeline.maybePromote → 'audit-fail').
 */
import type { RetakeGroup } from './editPlan';
import type { DisfluencyRange } from './disfluency';
import type { HookProposal } from './hookProposal';
import type { ReviewReason } from './pipelineReport';

/** A rejected LLM range at least this long is worth a human look. */
export const LONG_REJECTED_SECONDS = 2;

export function collectFlags(input: {
  retakeGroups?: RetakeGroup[] | null;
  disfluencyProposed?: DisfluencyRange[] | null;
  hook?: HookProposal | null;
}): ReviewReason[] {
  const out: ReviewReason[] = [];

  const flaggedGroups = (input.retakeGroups ?? []).filter((g) => g.flagged);
  if (flaggedGroups.length > 0) {
    out.push({
      code: 'retake-flagged',
      count: flaggedGroups.length,
      detail: `${flaggedGroups.length} retake group${flaggedGroups.length === 1 ? '' : 's'} where the preferred take looked truncated or low-confidence`,
    });
  }

  const longRejected = (input.disfluencyProposed ?? []).filter((r) => {
    if (!r.rejected) return false;
    const dur = r.endSec - r.startSec;
    return r.kind === 'restart' || r.kind === 'abandoned' || dur >= LONG_REJECTED_SECONDS;
  });
  if (longRejected.length > 0) {
    out.push({
      code: 'disfluency-long-rejected',
      count: longRejected.length,
      detail: `${longRejected.length} proposed cut${longRejected.length === 1 ? '' : 's'} (restart/abandoned or ≥${LONG_REJECTED_SECONDS}s) dropped by the caps: ${longRejected.slice(0, 2).map((r) => `"${r.preview}"`).join(', ')}`,
    });
  }

  if (input.hook) {
    if (input.hook.flags.includes('hook-lint')) {
      out.push({ code: 'hook-lint', detail: 'No hook-card candidate passed Voice DNA lint; header left empty' });
    } else if (input.hook.flags.includes('hook-low-score')) {
      const c = input.hook.candidates.find((x) => x.id === input.hook!.chosenId);
      out.push({ code: 'hook-low-score', detail: `Best hook card scored ${c?.rubric.hookStrength ?? '?'}/3 on hook strength: "${c?.text ?? ''}"` });
    }
  }

  return out;
}
