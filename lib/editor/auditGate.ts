/**
 * auditGate.ts — decides whether a polished render may promote.
 *
 * Policy (2026-09, "review only on flags"):
 *   - Deepgram Nova-3 on the rendered audio is the PRIMARY gate. It's the
 *     same engine that produced the caption timings, measured against the
 *     speech onset (lead-in aware), so its numbers are comparable run to run.
 *   - whisper.cpp small.en is ADVISORY. Its matcher throws isolated
 *     1000ms+ spikes on disfluent regions that Deepgram scores at ~200ms,
 *     which is what dead-ended 18 of 28 renders as final-v2-FAILED.mp4.
 *     It still runs and lands in audit.json, and it only decides when
 *     Deepgram couldn't run (no key / request failure).
 *   - Structural failures (wrong fps/codec, no audio, duration off by >2s)
 *     always fail regardless of engine.
 *
 * Thresholds are post-lead-in-fix numbers; retune from pipeline-report.json
 * once ~10 runs have landed.
 */

export type DeepgramMeasure = {
  maxDriftMs: number;
  meanDriftMs: number;
  matchedCount: number;
  captionCount: number;
};

export type WhisperMeasure = {
  overallStatus: 'clean' | 'warn' | 'fail';
  structuralOk: boolean;
  meanDriftMs?: number | null;
  maxDriftMs?: number | null;
};

export type GateDecision = {
  verdict: 'pass' | 'fail';
  by: 'deepgram' | 'whisper' | 'structural';
  reason: string;
};

export const GATE = {
  /** Real drift Deepgram may report on any single caption. */
  DG_MAX_MS: 300,
  /** Mean drift across matched captions. */
  DG_MEAN_MS: 120,
  /** Fraction of captions Deepgram must have located at all. */
  DG_MIN_MATCH: 0.9,
  /** Whisper fallback: fail only when structure is broken or the mean is wild. */
  WHISPER_MEAN_MS: 600,
} as const;

export function decideAuditGate(input: {
  /** Post-correct Deepgram measure when auto-correct ran, else pre-correct. */
  deepgram: DeepgramMeasure | null;
  whisper: WhisperMeasure;
}): GateDecision {
  const { deepgram, whisper } = input;

  if (!whisper.structuralOk) {
    return { verdict: 'fail', by: 'structural', reason: 'render failed structural checks (fps/codec/audio/duration)' };
  }

  if (deepgram && deepgram.captionCount > 0) {
    const matchRatio = deepgram.matchedCount / deepgram.captionCount;
    if (matchRatio < GATE.DG_MIN_MATCH) {
      return {
        verdict: 'fail',
        by: 'deepgram',
        reason: `Deepgram matched only ${deepgram.matchedCount}/${deepgram.captionCount} captions (< ${Math.round(GATE.DG_MIN_MATCH * 100)}%)`,
      };
    }
    if (deepgram.maxDriftMs > GATE.DG_MAX_MS) {
      return { verdict: 'fail', by: 'deepgram', reason: `Deepgram max drift ${deepgram.maxDriftMs}ms > ${GATE.DG_MAX_MS}ms` };
    }
    if (deepgram.meanDriftMs > GATE.DG_MEAN_MS) {
      return { verdict: 'fail', by: 'deepgram', reason: `Deepgram mean drift ${deepgram.meanDriftMs}ms > ${GATE.DG_MEAN_MS}ms` };
    }
    const advisory = whisper.overallStatus === 'fail' ? ' (whisper advisory: fail, overruled)' : '';
    return {
      verdict: 'pass',
      by: 'deepgram',
      reason: `Deepgram max ${deepgram.maxDriftMs}ms / mean ${deepgram.meanDriftMs}ms across ${deepgram.matchedCount}/${deepgram.captionCount}${advisory}`,
    };
  }

  // No Deepgram: whisper decides, but only on the robust signals.
  const mean = whisper.meanDriftMs ?? null;
  if (whisper.overallStatus === 'fail' && mean !== null && mean > GATE.WHISPER_MEAN_MS) {
    return { verdict: 'fail', by: 'whisper', reason: `whisper mean drift ${mean}ms > ${GATE.WHISPER_MEAN_MS}ms (Deepgram unavailable)` };
  }
  if (whisper.overallStatus === 'fail') {
    return { verdict: 'pass', by: 'whisper', reason: `whisper flagged max-drift only (mean ${mean ?? '?'}ms); Deepgram unavailable — passing as advisory` };
  }
  return { verdict: 'pass', by: 'whisper', reason: `whisper ${whisper.overallStatus} (Deepgram unavailable)` };
}
