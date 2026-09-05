import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { buildConcatFilter, CONCAT_ENCODE_ARGS } from '../concatFilter';
import type { Clip } from '../editPlan';

const clip = (id: string, s: number, e: number, speed?: number): Clip =>
  ({ id, sourceStart: s, sourceEnd: e, ...(speed ? { speed } : {}) }) as Clip;

describe('buildConcatFilter', () => {
  it('one clip', () => {
    const g = buildConcatFilter([clip('a', 1, 3)]);
    expect(g.filterComplex).toBe(
      '[0:v]split=1[vs0];[0:a]asplit=1[as0];' +
      '[vs0]trim=start=1:end=3,setpts=PTS-STARTPTS[v0];[as0]atrim=start=1:end=3,asetpts=PTS-STARTPTS[a0];' +
      '[v0][a0]concat=n=1:v=1:a=1[v][a]',
    );
    expect(g.videoLabel).toBe('[v]');
  });

  it('three clips with a 1.5x segment carry setpts + atempo', () => {
    const g = buildConcatFilter([clip('a', 0, 2), clip('b', 5, 7, 1.5), clip('c', 9, 10)]);
    expect(g.filterComplex).toContain('[vs1]trim=start=5:end=7,setpts=PTS-STARTPTS,setpts=PTS/1.5[v1]');
    expect(g.filterComplex).toContain('[as1]atrim=start=5:end=7,asetpts=PTS-STARTPTS,atempo=1.5[a1]');
    expect(g.filterComplex.endsWith('[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][a]')).toBe(true);
  });

  it('reframe crop is time-shifted by each segment start', () => {
    const reframe = { version: 1, sourceWidth: 1920, sourceHeight: 1080, targetAspect: 9 / 16,
      keyframes: [{ tSec: 0, cx: 900, cy: 540, scale: 1 }, { tSec: 10, cx: 1000, cy: 540, scale: 0.9 }] } as never;
    const g = buildConcatFilter([clip('a', 4, 6)], { reframe });
    expect(g.filterComplex).toContain('(t+4)');
    expect(g.filterComplex).toContain('scale=1080:1920,setsar=1');
  });

  it('throws on empty', () => {
    expect(() => buildConcatFilter([])).toThrow();
  });
});

// Real ffmpeg run on an actual source, when both are available. Verifies the
// graph is accepted by ffmpeg and the output duration equals the plan's
// edited duration (the whole point of the single-pass encode).
const SOURCE = path.join(os.homedir(), 'Code', 'Social Media', 'my-video-projects', 'data', 'takes', 'teleprompter-2026-25-0719-18-44mp4-202607260118', 'source.mp4');
const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const canRun = haveFfmpeg && fs.existsSync(SOURCE);

describe.skipIf(!canRun)('buildConcatFilter — ffmpeg smoke', () => {
  it('encodes three trimmed segments into one file of the expected length', () => {
    const clips = [clip('a', 1, 3), clip('b', 5, 7.5, 1.25), clip('c', 10, 12)];
    const g = buildConcatFilter(clips);
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'concat-')), 'out.mp4');
    const r = spawnSync('ffmpeg', ['-y', '-i', SOURCE, '-filter_complex', g.filterComplex, '-map', g.videoLabel, '-map', g.audioLabel, ...CONCAT_ENCODE_ARGS, out], { encoding: 'utf-8' });
    expect(r.status, r.stderr.slice(-400)).toBe(0);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf-8' });
    const dur = parseFloat(probe.stdout.trim());
    const expected = 2 + 2.5 / 1.25 + 2; // 6.0s
    expect(Math.abs(dur - expected)).toBeLessThan(0.15);
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  }, 120_000);
});
