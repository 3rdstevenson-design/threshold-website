/**
 * progressParse.ts — pure parsers that turn child-process log lines into a
 * 0–100 percent for the CURRENT pipeline stage, so the editor's progress bar
 * moves during the long phases instead of sitting on a fixed stage number.
 *
 * Three sources:
 *   - ingest-takes.ts stdout milestones      → transcribing %
 *   - Remotion render lines ("Rendered 45%") → rendering %
 *   - ffmpeg `-progress pipe:1` key=value     → concatenating %
 *
 * All stateless-per-call except `remotionProgress`, which keeps the higher of
 * the render and encode passes so the bar never slides backwards when encode
 * restarts from 0%.
 */

/** Ordered milestones printed by my-video-projects/scripts/ingest-takes.ts. */
const INGEST_MILESTONES: { match: RegExp; pct: number }[] = [
  { match: /^Source:/, pct: 3 },
  { match: /thumbnail/, pct: 6 },
  { match: /^Extracting 16kHz/, pct: 10 },
  { match: /^Transcribing with Deepgram/, pct: 25 },
  { match: /Deepgram utterance\(s\)/, pct: 70 },
  { match: /^Detecting silences/, pct: 78 },
  { match: /take boundaries\)/, pct: 84 },
  { match: /^Detecting claps/, pct: 86 },
  { match: /^Splitting video into take/, pct: 92 },
  { match: /^Wrote /, pct: 100 },
];

/** Returns the milestone percent for an ingest log line, or null. */
export function ingestProgress(line: string): number | null {
  const t = line.trim();
  for (const m of INGEST_MILESTONES) if (m.match.test(t)) return m.pct;
  return null;
}

export type RemotionProgressState = { render: number; encode: number };

export function newRemotionState(): RemotionProgressState {
  return { render: 0, encode: 0 };
}

const PCT_RE = /(\d{1,3}(?:\.\d+)?)\s*%/;

/**
 * Feed one Remotion CLI line. Returns the combined 0–100 (render weighted
 * 70%, encode 30%) or null when the line carries no percent. Mutates `state`.
 */
export function remotionProgress(state: RemotionProgressState, line: string): number | null {
  const m = line.match(PCT_RE);
  if (!m) return null;
  const pct = Math.min(100, parseFloat(m[1]));
  if (!Number.isFinite(pct)) return null;
  if (line.toLowerCase().includes('encod')) state.encode = Math.max(state.encode, pct);
  else state.render = Math.max(state.render, pct);
  return Math.round(state.render * 0.7 + state.encode * 0.3);
}

/**
 * ffmpeg `-progress pipe:1 -nostats` prints `key=value` lines; `out_time_us`
 * (or `out_time_ms`, which despite the name is also microseconds) is the
 * encoded timestamp. Returns 0–100 against `totalMs`, or null.
 */
export function ffmpegProgress(line: string, totalMs: number): number | null {
  if (totalMs <= 0) return null;
  const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
  if (!m) {
    if (/^progress=end/.test(line.trim())) return 100;
    return null;
  }
  const us = Number(m[1]);
  if (!Number.isFinite(us)) return null;
  return Math.max(0, Math.min(100, Math.round((us / 1000 / totalMs) * 100)));
}

/**
 * Expected wall-clock for a stage, from prior runs when available (median of
 * `history` ms-per-source-second × this source's seconds) or from a fallback
 * ratio. Used by the client to tween stages that emit no progress lines.
 */
export function expectedStageMs(
  stage: string,
  sourceSec: number,
  history: Record<string, number[]> | null,
  fallbackRatio: Record<string, number> = DEFAULT_STAGE_RATIO,
): number {
  const hist = history?.[stage];
  if (hist && hist.length > 0 && sourceSec > 0) {
    const sorted = [...hist].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    return Math.max(1000, Math.round(med * sourceSec));
  }
  const ratio = fallbackRatio[stage];
  if (ratio === undefined) return 15_000;
  return Math.max(1000, Math.round(ratio * 1000 * Math.max(sourceSec, 5)));
}

/** Fallback seconds-of-work per second-of-source, measured on an M-series Mac. */
export const DEFAULT_STAGE_RATIO: Record<string, number> = {
  preparing: 0.02,
  transcribing: 0.12,
  silences: 0.005,
  fillers: 0.005,
  stutters: 0.005,
  retakes: 0.005,
  captioning: 0.01,
  hooking: 0.15,
  loading: 0.01,
  detecting: 0.25,
  polishing: 0.02,
  concatenating: 0.35,
  rendering: 0.9,
  auditing: 0.6,
  'sync-auditing': 0.2,
  'auto-correcting': 0.9,
  promoting: 0.02,
  diarizing: 0.15,
  'propose-clips': 0.2,
};
