/**
 * reframe.ts — orchestrates scripts/reframe.py to produce a time-varying
 * 9:16 crop track for a child clip extracted from a wide-shot long-form
 * source.
 *
 * The Python script handles the heavy lifting (MediaPipe face detection +
 * crop math + smoothing). This wrapper just spawns it, streams logs, and
 * returns the produced reframe.json path. If Python or MediaPipe aren't
 * installed the script gracefully degrades to a center crop — the caller
 * can proceed without failing the whole extract.
 *
 * Typical usage inside extract-clips SSE handler:
 *
 *     await reframeClip({
 *       videoPath: childSource,
 *       outPath: path.join(childDir, 'reframe.json'),
 *       diarizationPath: path.join(childDir, 'diarization.json'),
 *       onLog: log,
 *     });
 */
import * as fs from 'fs';
import * as path from 'path';
import { runStreaming } from './ffmpeg';

export type ReframeInput = {
  videoPath: string;
  outPath: string;
  diarizationPath?: string;
  sampleFps?: number;
  onLog?: (msg: string) => void;
};

export type ReframeKeyframe = {
  tSec: number;
  cx: number;
  cy: number;
  scale: number;
};

export type ReframeFile = {
  fps: number;
  sourceWidth: number;
  sourceHeight: number;
  targetAspect: number;
  keyframes: ReframeKeyframe[];
  note?: string;
};

export async function reframeClip(input: ReframeInput): Promise<void> {
  const log = input.onLog ?? (() => {});
  const scriptPath = path.resolve(
    process.cwd(),
    'scripts',
    'reframe.py',
  );
  if (!fs.existsSync(scriptPath)) {
    log(`WARN: reframe.py not found at ${scriptPath} — skipping reframing.`);
    return;
  }

  const args = [
    scriptPath,
    '--video', input.videoPath,
    '--out', input.outPath,
    '--sample-fps', String(input.sampleFps ?? 10),
  ];
  if (input.diarizationPath && fs.existsSync(input.diarizationPath)) {
    args.push('--diarization', input.diarizationPath);
  }

  log(`Running reframe.py on ${path.basename(input.videoPath)}…`);

  // Allow the user to override the Python binary (e.g. a venv) via env.
  const python = process.env.REFRAME_PYTHON ?? 'python3';
  const r = await runStreaming(python, args, (line) => log(line));

  if (r.code !== 0) {
    log(`WARN: reframe.py exited ${r.code}; continuing without reframing.`);
    // Best-effort: write an empty reframe.json so downstream steps know
    // reframing was attempted but unavailable. Don't overwrite a valid
    // one produced by an earlier run.
    if (!fs.existsSync(input.outPath)) {
      fs.writeFileSync(
        input.outPath,
        JSON.stringify(
          { fps: 10, sourceWidth: 0, sourceHeight: 0, targetAspect: 9 / 16, keyframes: [], note: 'reframe script failed' } satisfies ReframeFile,
          null,
          2,
        ),
      );
    }
  }
}

/**
 * Parse a reframe.json file. Returns null if missing or malformed — the
 * render step should fall back to non-reframed output in that case.
 */
export function readReframeFile(absPath: string): ReframeFile | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(absPath, 'utf-8')) as ReframeFile;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.keyframes) || parsed.keyframes.length === 0) return null;
    if (!parsed.sourceWidth || !parsed.sourceHeight) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build the ffmpeg filter expression for a time-varying crop using the
 * reframe keyframes. Uses ffmpeg's `crop` filter with piecewise-linear
 * `cx(t)` and `cy(t)` expressions backed by `sendcmd` commands so the
 * crop window animates smoothly.
 *
 * We return a filter chain string that:
 *   1. Applies the time-varying crop.
 *   2. Scales the crop output to an exact 1080×1920 vertical frame.
 *
 * Usage (in an ffmpeg invocation):
 *   ffmpeg -i in.mp4 -filter_complex "<buildReframeFilter()>" -c:a copy out.mp4
 */
export function buildReframeFilter(
  reframe: ReframeFile,
  outputWidth = 1080,
  outputHeight = 1920,
  /**
   * Seconds to add to the ffmpeg `t` variable before evaluating
   * keyframes. Use this when the filter runs on a cut segment whose
   * output timeline is 0-based but whose keyframes are parent-source-
   * timed — e.g., per-clip cuts inside the render pipeline.
   */
  timeOffsetSec = 0,
): string {
  const { keyframes, sourceHeight, targetAspect } = reframe;
  if (keyframes.length === 0) {
    return `scale=${outputWidth}:${outputHeight}`;
  }

  // We express the crop center and height as piecewise-linear ffmpeg
  // expressions in `t` (seconds). ffmpeg's `crop` filter accepts expr
  // for x / y / w / h — we'll feed it `cx(t) - w/2`, etc.
  //
  // For simplicity + reliability, we use the `lerp` pattern with
  // `between(t, a, b)` terms. This is robust and doesn't require the
  // sendcmd filter (which is finicky with quoting).

  let cxExpr = buildPiecewiseExpr(keyframes.map((k) => [k.tSec, k.cx]));
  let cyExpr = buildPiecewiseExpr(keyframes.map((k) => [k.tSec, k.cy]));
  let scaleExpr = buildPiecewiseExpr(keyframes.map((k) => [k.tSec, k.scale]));

  if (timeOffsetSec > 0) {
    const replacement = `(t+${timeOffsetSec})`;
    cxExpr = cxExpr.replace(/\bt\b/g, replacement);
    cyExpr = cyExpr.replace(/\bt\b/g, replacement);
    scaleExpr = scaleExpr.replace(/\bt\b/g, replacement);
  }

  const cropHExpr = `(${scaleExpr})*${sourceHeight}`;
  const cropWExpr = `(${cropHExpr})*${targetAspect}`;
  const cropXExpr = `(${cxExpr})-(${cropWExpr})/2`;
  const cropYExpr = `(${cyExpr})-(${cropHExpr})/2`;

  return [
    `crop=w='${cropWExpr}':h='${cropHExpr}':x='${cropXExpr}':y='${cropYExpr}'`,
    `scale=${outputWidth}:${outputHeight}`,
    'setsar=1',
  ].join(',');
}

/**
 * Build an ffmpeg expression that linearly interpolates a value between
 * keyframes. Evaluated in `t` (seconds).
 *
 * For keyframes (t0, v0), (t1, v1), ..., (tn, vn):
 *
 *   if t <= t0           → v0
 *   if t0 < t <= t1      → lerp(v0, v1, (t-t0)/(t1-t0))
 *   ...
 *   if t > tn            → vn
 *
 * Implemented with a chain of `if(lt(t, tX), ..., ...)` ffmpeg expr calls.
 */
export function buildPiecewiseExpr(points: Array<[number, number]>): string {
  if (points.length === 0) return '0';
  if (points.length === 1) return String(points[0][1]);

  // Downsample heavily — ffmpeg expressions have a length cap and we don't
  // need 10 fps precision (that's ~600 keyframes for a 60s clip). Keep at
  // most 60 anchor points (one per second for a 60s clip).
  const maxAnchors = 60;
  const stride = Math.max(1, Math.ceil(points.length / maxAnchors));
  const ds: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i += stride) ds.push(points[i]);
  // Always include the last point so animation finishes on the final pose.
  if (ds[ds.length - 1] !== points[points.length - 1]) ds.push(points[points.length - 1]);

  // Build from the end backwards using nested if()s.
  let expr = String(ds[ds.length - 1][1]); // default = last value (held past end)
  for (let i = ds.length - 1; i >= 1; i--) {
    const [t0, v0] = ds[i - 1];
    const [t1, v1] = ds[i];
    const lerp = `(${v0}+(${v1}-${v0})*(t-${t0})/(${t1 - t0 || 1}))`;
    // if t < t1: lerp, else: previous-expr (which will handle t >= t1)
    expr = `if(lt(t,${t1}),${lerp},${expr})`;
  }
  // Before the first keyframe, hold the first value.
  const [t0, v0] = ds[0];
  expr = `if(lt(t,${t0}),${v0},${expr})`;
  return expr;
}
