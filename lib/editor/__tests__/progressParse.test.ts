import { describe, it, expect } from 'vitest';
import {
  expectedStageMs,
  ffmpegProgress,
  ingestProgress,
  newRemotionState,
  remotionProgress,
} from '../progressParse';

describe('ingestProgress', () => {
  it('maps ingest-takes milestones to a rising percent', () => {
    const lines = [
      'Source: data/takes/x/source.mp4 (hevc)',
      'Extracting 16kHz mono Opus for transcription...',
      'Transcribing with Deepgram Nova-3 (word-level timestamps)...',
      '  ↳ 12 Deepgram utterance(s), 340 words',
      'Detecting silences (-32dB / 0.4s)...',
      'Wrote data/takes/x/analysis.json',
    ];
    const pcts = lines.map(ingestProgress);
    expect(pcts).toEqual([3, 10, 25, 70, 78, 100]);
    expect(ingestProgress('random chatter')).toBeNull();
  });
});

describe('remotionProgress', () => {
  it('weights render 70/encode 30 and never slides backwards', () => {
    const st = newRemotionState();
    expect(remotionProgress(st, 'Rendered 50%')).toBe(35);
    expect(remotionProgress(st, 'Rendered 100%')).toBe(70);
    expect(remotionProgress(st, 'Encoding 20%')).toBe(76);
    // a lower render figure after a higher one is ignored
    expect(remotionProgress(st, 'Rendered 10%')).toBe(76);
    expect(remotionProgress(st, 'Encoded 100%')).toBe(100);
    expect(remotionProgress(st, 'no percent here')).toBeNull();
  });
});

describe('ffmpegProgress', () => {
  it('reads out_time_us against the target duration', () => {
    expect(ffmpegProgress('out_time_us=5000000', 10_000)).toBe(50);
    expect(ffmpegProgress('out_time_ms=10000000', 10_000)).toBe(100);
    expect(ffmpegProgress('out_time_us=99000000', 10_000)).toBe(100);
    expect(ffmpegProgress('progress=end', 10_000)).toBe(100);
    expect(ffmpegProgress('frame=12', 10_000)).toBeNull();
    expect(ffmpegProgress('out_time_us=1', 0)).toBeNull();
  });
});

describe('expectedStageMs', () => {
  it('uses the median of history scaled by source seconds', () => {
    const hist = { transcribing: [100, 300, 200] };
    expect(expectedStageMs('transcribing', 60, hist)).toBe(200 * 60);
  });
  it('falls back to the ratio table with a floor', () => {
    expect(expectedStageMs('rendering', 100, null)).toBe(90_000);
    expect(expectedStageMs('unknown-stage', 100, null)).toBe(15_000);
    expect(expectedStageMs('silences', 1, null)).toBeGreaterThanOrEqual(1000);
  });
});
