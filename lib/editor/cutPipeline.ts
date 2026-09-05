/**
 * cutPipeline.ts
 *
 * The four auto-cut detection stages (silences → fillers → stutters →
 * retakes) as ONE shared function, so the server pipeline
 * (talkingHeadPipeline.ts) and the client "Analyze audio" re-run
 * (useEditor.ts) cut byte-identically from the same analysis.json and the
 * same plan-level CutSettings. Detection is pure JS over the stored
 * transcript — no transcription, no API calls, so re-running with new
 * settings is instant.
 *
 * Isomorphic: no Node-only imports (same constraint as editPlan.ts).
 */

import {
  removeSilences,
  removeFillers,
  removeStutters,
  removeRetakes,
  newCutRanges,
  TALKING_HEAD_CUT_OPTIONS,
  type Silence,
  type Word,
  type StageStats,
  type StutterStageResult,
  type RetakeStageResult,
} from './autoCut';
import { detectRepeatStutters } from './stutterDetection';
import { detectRetakesFromWords } from './retakeDetection';
import {
  randomId,
  resolveCutSettings,
  type Clip,
  type CutLogEntry,
  type CutSettings,
  type RetakeGroup,
} from './editPlan';

export type CutStageName = 'silences' | 'fillers' | 'stutters' | 'retakes';

export type CutStagesResult = {
  clips: Clip[];
  /** RetakeGroup[] with ids assigned, ready for plan.retakeGroups. */
  retakeGroups: RetakeGroup[];
  /** Source ranges removed, tagged by stage — ready for plan.cutLog. */
  cutLog: CutLogEntry[];
  stages: {
    silences: StageStats;
    fillers: StageStats;
    stutters: StutterStageResult['stats'];
    retakes: RetakeStageResult['stats'];
  };
  stats: { removedCount: number; removedSeconds: number };
};

export function runCutStages(input: {
  duration: number;
  words: Word[];
  silences: Silence[];
  fillerWords: string[];
  settings?: Partial<CutSettings>;
  /** Called as each stage completes (drives the SSE progress events). */
  onStage?: (name: CutStageName, stats: StageStats) => void;
}): CutStagesResult {
  const settings = resolveCutSettings({ cutSettings: input.settings });
  const options = {
    ...TALKING_HEAD_CUT_OPTIONS,
    minSilenceSeconds: settings.minSilenceSeconds,
  };
  const cutLog: CutLogEntry[] = [];
  const logStage = (prev: Clip[], next: Clip[], reason: CutLogEntry['reason']) => {
    for (const r of newCutRanges(prev, next, input.duration)) {
      cutLog.push({ start: r.start, end: r.end, reason });
    }
  };
  const fullClip: Clip[] = [
    { id: randomId('clip'), sourceStart: 0, sourceEnd: input.duration },
  ];

  const a = removeSilences({ duration: input.duration, silences: input.silences, options });
  logStage(fullClip, a.clips, 'silence');
  input.onStage?.('silences', a.stats);

  const b = removeFillers({
    clips: a.clips,
    words: input.words,
    fillerWords: input.fillerWords,
    duration: input.duration,
    options,
  });
  logStage(a.clips, b.clips, 'filler');
  input.onStage?.('fillers', b.stats);

  const c = removeStutters({
    clips: b.clips,
    words: input.words,
    duration: input.duration,
    detector: (survivingWords) =>
      detectRepeatStutters(survivingWords, {
        singleWordRepeats: true,
        // Partial-word fragment removal over-fires on casual speech
        // (clipping real short words), so it's off. Single-word repeats
        // ("the the") stay on.
        partialWordFragments: false,
      }),
    options,
  });
  logStage(b.clips, c.clips, 'stutter');
  input.onStage?.('stutters', c.stats);

  const d = removeRetakes({
    clips: c.clips,
    words: input.words,
    duration: input.duration,
    detector: (survivingWords) => {
      const detection = detectRetakesFromWords(survivingWords, {
        keeperPreference: settings.retakePreference,
      });
      return {
        removeRanges: detection.removeRanges,
        groups: detection.groups.map((g) => ({
          alternatives: g.alternatives.map((alt) => ({
            start: alt.start,
            end: alt.end,
            transcript: alt.transcript,
            meanConfidence: alt.meanConfidence,
          })),
          keptIndex: g.keptIndex,
          flagged: g.flagged,
          reason: g.reason,
        })),
      };
    },
    options,
  });
  logStage(c.clips, d.clips, 'retake');
  input.onStage?.('retakes', d.stats);

  const retakeGroups: RetakeGroup[] = d.groups.map((g) => {
    const alternatives = g.alternatives.map((alt) => ({
      id: randomId('alt'),
      sourceStart: alt.start,
      sourceEnd: alt.end,
      transcript: alt.transcript,
      meanConfidence: alt.meanConfidence,
    }));
    return {
      id: randomId('rtg'),
      alternatives,
      keptAlternativeId:
        alternatives[g.keptIndex]?.id ?? alternatives[alternatives.length - 1].id,
      flagged: g.flagged,
      reason: g.reason,
    };
  });

  return {
    clips: d.clips,
    retakeGroups,
    cutLog,
    stages: { silences: a.stats, fillers: b.stats, stutters: c.stats, retakes: d.stats },
    stats: {
      removedCount:
        a.stats.cutCount + b.stats.cutCount + c.stats.cutCount + d.stats.cutCount,
      removedSeconds:
        a.stats.secondsRemoved + b.stats.secondsRemoved +
        c.stats.secondsRemoved + d.stats.secondsRemoved,
    },
  };
}
