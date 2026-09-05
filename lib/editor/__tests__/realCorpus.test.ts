/**
 * Real-recording regression corpus. Three of Lars's own transcripts
 * (analysis.json words + silences, plus the plan's filler list / settings)
 * run through the deterministic cut stages. The snapshot is the contract:
 * any tuning change to silence / filler / stutter / retake detection shows
 * up here as a concrete diff on real speech instead of only on synthetic
 * fixtures. Update the snapshot deliberately (`vitest -u`) after reviewing.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runCutStages } from '../cutPipeline';
import { resolveCutSettings } from '../editPlan';
import { chunkCaptions } from '../captionChunker';

const DIR = path.join(__dirname, 'fixtures', 'real');
const fixtures = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();

describe.each(fixtures)('real corpus: %s', (file) => {
  const fx = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf-8'));

  it('cut stages produce a stable result', () => {
    const r = runCutStages({
      duration: fx.duration,
      words: fx.words,
      silences: fx.silences,
      fillerWords: fx.fillerWords,
      settings: resolveCutSettings({ cutSettings: fx.cutSettings }),
    });
    const summary = {
      clips: r.clips.length,
      keptSeconds: Math.round(r.clips.reduce((s, c) => s + (c.sourceEnd - c.sourceStart), 0) * 100) / 100,
      silences: r.stages.silences.cutCount,
      fillers: r.stages.fillers.cutCount,
      stutters: r.stages.stutters.phrasesRemoved + r.stages.stutters.singleWordsRemoved,
      retakeGroups: r.stages.retakes.groupsFound,
      retakeFlagged: r.stages.retakes.flaggedGroups,
      cutLog: r.cutLog.map((c) => `${c.reason}@${c.start.toFixed(2)}-${c.end.toFixed(2)}`),
    };
    expect(summary).toMatchSnapshot();
  });

  it('captions keep the lead-in invariant on every chunk', () => {
    const r = runCutStages({
      duration: fx.duration, words: fx.words, silences: fx.silences,
      fillerWords: fx.fillerWords, settings: resolveCutSettings({ cutSettings: fx.cutSettings }),
    });
    const caps = chunkCaptions(fx.words, r.clips, {});
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) {
      expect(c.words?.length).toBeGreaterThan(0);
      // first word starts at or after the caption start (lead-in is ≤ 150ms)
      const lead = c.words![0].startMs - c.startMs;
      expect(lead).toBeGreaterThanOrEqual(0);
      expect(lead).toBeLessThanOrEqual(150);
    }
  });
});
