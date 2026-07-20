/**
 * ffmpeg.ts — wrappers around native ffmpeg/ffprobe for the editor API.
 *
 * These are the ONLY wrappers that shell out from the Next.js server
 * process. They all take absolute paths and return structured results
 * so API routes stay terse.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type SpawnResult = {
  code: number;
  stdout: string;
  stderr: string;
};

// Kill a spawned child when an AbortSignal fires: SIGTERM, then SIGKILL
// as a fallback. Lets a client disconnect / Cancel actually stop the
// underlying ffmpeg / whisper / remotion work instead of orphaning it.
function killProc(proc: ReturnType<typeof spawn>): void {
  // Kill the whole process GROUP, not just the direct child. Spawns use
  // `detached: true` so the child is a group leader; `process.kill(-pid)`
  // then takes down its descendants too (npx → node → whisper, or
  // remotion → compositor + chrome-headless), which a plain proc.kill()
  // would orphan.
  const pid = proc.pid;
  const killGroup = (sig: NodeJS.Signals) => {
    try {
      if (pid) process.kill(-pid, sig);
    } catch {
      try { proc.kill(sig); } catch {}
    }
  };
  killGroup('SIGTERM');
  const t = setTimeout(() => killGroup('SIGKILL'), 3000);
  if (typeof t.unref === 'function') t.unref();
}

/**
 * Wire an AbortSignal to kill a spawned child; returns a cleanup fn to
 * detach the listener once the process settles. For the direct spawn
 * sites (ingest, analyze) that don't go through run/runStreaming.
 */
export function killOnAbort(
  proc: ReturnType<typeof spawn>,
  signal?: AbortSignal,
): () => void {
  if (!signal) return () => {};
  if (signal.aborted) { killProc(proc); return () => {}; }
  const onAbort = () => killProc(proc);
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

export function run(cmd: string, args: string[], options: RunOptions = {}): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('aborted')); return; }
    const proc = spawn(cmd, args, { cwd: options.cwd, env: options.env, detached: true });
    let stdout = '';
    let stderr = '';
    const onAbort = () => killProc(proc);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort);
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => { cleanup(); reject(e); });
    proc.on('close', (code) => { cleanup(); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

export type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** When it fires, the spawned child is killed (SIGTERM → SIGKILL). */
  signal?: AbortSignal;
};

export function runStreaming(
  cmd: string,
  args: string[],
  onLog: (line: string) => void,
  options: RunOptions = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('aborted')); return; }
    const proc = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    const onAbort = () => killProc(proc);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort);
    const forward = (chunk: Buffer, collect: (s: string) => void) => {
      const s = chunk.toString();
      collect(s);
      for (const line of s.split(/\r?\n/)) {
        if (line.trim().length > 0) onLog(line);
      }
    };
    proc.stdout.on('data', (d) => forward(d, (s) => { stdout += s; }));
    proc.stderr.on('data', (d) => forward(d, (s) => { stderr += s; }));
    proc.on('error', (e) => { cleanup(); reject(e); });
    proc.on('close', (code) => { cleanup(); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

export async function probeDurationSec(videoPath: string): Promise<number> {
  const r = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    videoPath,
  ]);
  if (r.code !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return parseFloat(r.stdout.trim());
}

export async function probeVideoCodec(videoPath: string): Promise<string> {
  const r = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name',
    '-of', 'default=nw=1:nk=1',
    videoPath,
  ]);
  if (r.code !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * Render a horizontal waveform PNG suitable for the timeline. The output
 * is intentionally small (800×80) — the UI scales it to the timeline width.
 */
export async function renderWaveformPng(input: {
  videoPath: string;
  outputPath: string;
  width?: number;
  height?: number;
  color?: string;
}): Promise<void> {
  const width = input.width ?? 1600;
  const height = input.height ?? 80;
  const color = input.color ?? '0x9B30D9';
  const r = await run('ffmpeg', [
    '-y',
    '-i', input.videoPath,
    '-filter_complex',
    `[0:a]aformat=channel_layouts=mono,showwavespic=s=${width}x${height}:colors=${color}[v]`,
    '-map', '[v]',
    '-frames:v', '1',
    input.outputPath,
  ]);
  if (r.code !== 0) throw new Error(`ffmpeg waveform failed: ${r.stderr.slice(-500)}`);
}

/**
 * Render the timeline filmstrip: `frames` evenly-spaced frames tiled into
 * one wide JPEG (see lib/editor/filmstrip.ts for the client-side math).
 *
 * Frame i is extracted with an independent input-seek (`-ss` before
 * `-i`), NOT a single fps-filter pass — a one-pass scan must read the
 * whole file, which took minutes on a 2-hour 7 GB source, while a
 * keyframe seek is ~0.5s no matter where it lands. Seeks run with
 * bounded concurrency, then one tile pass joins the strip. Frame i sits
 * at exactly i/(frames-1) × duration, matching filmstripFrameIndex().
 */
export async function renderFilmstripJpg(input: {
  videoPath: string;
  outputPath: string;
  durationSec: number;
  frames: number;
  frameHeight: number;
}): Promise<void> {
  const { frames, frameHeight } = input;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filmstrip-'));
  const frameFile = (i: number) => path.join(tmpDir, `f_${String(i).padStart(3, '0')}.jpg`);
  try {
    // Keep the last sample a hair inside the file so seeking never lands
    // past the final frame.
    const span = Math.max(0, input.durationSec - 0.2);
    const CONCURRENCY = 6;
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const i = cursor++;
        if (i >= frames) return;
        const t = frames > 1 ? (i / (frames - 1)) * span : 0;
        await run('ffmpeg', [
          '-y',
          '-ss', t.toFixed(3),
          '-i', input.videoPath,
          '-frames:v', '1',
          '-vf', `scale=-2:${frameHeight}:flags=fast_bilinear`,
          '-q:v', '5',
          frameFile(i),
        ]);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // A failed/empty seek (corrupt tail, zero-length edge) must not break
    // the image2 sequence — fill every gap from the nearest good frame
    // (leading gaps from the first good one) so f_000..f_NNN is contiguous.
    const good = (i: number) => {
      const f = frameFile(i);
      return fs.existsSync(f) && fs.statSync(f).size > 0;
    };
    const firstGoodIdx = Array.from({ length: frames }, (_, i) => i).find(good);
    if (firstGoodIdx === undefined) throw new Error('filmstrip: no frames could be extracted');
    let lastGood = frameFile(firstGoodIdx);
    for (let i = 0; i < frames; i++) {
      if (good(i)) { lastGood = frameFile(i); continue; }
      fs.copyFileSync(lastGood, frameFile(i));
    }

    const r = await run('ffmpeg', [
      '-y',
      '-i', path.join(tmpDir, 'f_%03d.jpg'),
      '-vf', `tile=${frames}x1`,
      '-frames:v', '1',
      '-q:v', '5',
      input.outputPath,
    ]);
    if (r.code !== 0) throw new Error(`ffmpeg filmstrip tile failed: ${r.stderr.slice(-500)}`);
  } finally {
    try {
      for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir, f));
      fs.rmdirSync(tmpDir);
    } catch {}
  }
}

/**
 * Build an ffmpeg audio-filter chain that retimes audio by `speed`.
 * A single atempo instance only accepts [0.5, 2.0] portably, so factors
 * outside that range are decomposed into a chain (0.3 → 0.5 × 0.6,
 * 4 → 2 × 2). Pure string builder — exported for tests.
 */
export function atempoChain(speed: number): string {
  const parts: number[] = [];
  let r = speed;
  while (r > 2) { parts.push(2); r /= 2; }
  while (r < 0.5) { parts.push(0.5); r /= 0.5; }
  parts.push(r);
  return parts.map((p) => `atempo=${trimFloat(p)}`).join(',');
}

function trimFloat(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

/**
 * Extract a single thumbnail frame.
 */
export async function extractThumb(
  src: string,
  dst: string,
  atSec: number,
  width = 320,
): Promise<void> {
  const r = await run('ffmpeg', [
    '-y',
    '-ss', String(atSec),
    '-i', src,
    '-frames:v', '1',
    '-vf', `scale=${width}:-2`,
    '-q:v', '4',
    dst,
  ]);
  if (r.code !== 0) throw new Error(`ffmpeg thumb failed: ${r.stderr.slice(-500)}`);
}
