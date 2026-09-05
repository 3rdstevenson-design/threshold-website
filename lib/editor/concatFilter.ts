/**
 * concatFilter.ts — ONE ffmpeg filter_complex that trims every clip from the
 * source and concatenates them in a single continuous encode.
 *
 * Why single-pass: the old export path re-encoded each clip to its own AAC
 * mp4 and then `concat -c copy`'d them. Every splice added AAC encoder
 * priming (~21–42ms) plus 1024-sample frame rounding, so caption drift
 * grew monotonically across a reel (115 → 901ms over 12 cuts on 2026-07-25).
 * The polish pipeline switched to this graph then; the v1 Export button —
 * the path that actually lands in Reels/Final — kept the drift-prone one
 * until now.
 *
 * Per-clip speed (`setpts` + `atempo` chain) and the long-form 9:16 reframe
 * crop (time-shifted to each segment's sourceStart) are applied per segment
 * inside the graph, so the output is bit-for-bit what the per-clip path
 * produced, minus the splice error.
 *
 * Pure string builder — exported for tests.
 */
import type { Clip } from './editPlan';
import { clipSpeed } from './editPlan';
import { atempoChain } from './ffmpeg';
import { buildReframeFilter, type ReframeFile } from './reframe';

export type ConcatFilterOptions = {
  reframe?: ReframeFile | null;
  outputWidth?: number;
  outputHeight?: number;
};

export type ConcatFilter = {
  filterComplex: string;
  /** Output pad labels to `-map`. */
  videoLabel: string;
  audioLabel: string;
};

export function buildConcatFilter(clips: Clip[], options: ConcatFilterOptions = {}): ConcatFilter {
  if (clips.length === 0) throw new Error('buildConcatFilter: no clips');
  const n = clips.length;
  const w = options.outputWidth ?? 1080;
  const h = options.outputHeight ?? 1920;
  const vSplits = clips.map((_, i) => `[vs${i}]`).join('');
  const aSplits = clips.map((_, i) => `[as${i}]`).join('');
  const parts: string[] = [`[0:v]split=${n}${vSplits}`, `[0:a]asplit=${n}${aSplits}`];

  for (let i = 0; i < n; i++) {
    const c = clips[i];
    const speed = clipSpeed(c);
    const v: string[] = [
      `trim=start=${c.sourceStart}:end=${c.sourceEnd}`,
      'setpts=PTS-STARTPTS',
    ];
    if (options.reframe) {
      // After setpts the segment's `t` restarts at 0; keyframes are in
      // parent-source seconds, so shift by sourceStart.
      v.push(buildReframeFilter(options.reframe, w, h, c.sourceStart));
    }
    if (speed !== 1) v.push(`setpts=PTS/${speed}`);
    const a: string[] = [
      `atrim=start=${c.sourceStart}:end=${c.sourceEnd}`,
      'asetpts=PTS-STARTPTS',
    ];
    if (speed !== 1) a.push(atempoChain(speed));
    parts.push(`[vs${i}]${v.join(',')}[v${i}]`, `[as${i}]${a.join(',')}[a${i}]`);
  }

  const pairs = clips.map((_, i) => `[v${i}][a${i}]`).join('');
  parts.push(`${pairs}concat=n=${n}:v=1:a=1[v][a]`);
  return { filterComplex: parts.join(';'), videoLabel: '[v]', audioLabel: '[a]' };
}

/** Encoder args shared by polish + export so both outputs match. */
export const CONCAT_ENCODE_ARGS = [
  '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
  '-g', '30', '-keyint_min', '30',
  '-pix_fmt', 'yuv420p',
  '-r', '30',
  '-c:a', 'aac', '-b:a', '128k',
];
