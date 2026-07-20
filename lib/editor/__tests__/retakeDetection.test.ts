import { describe, expect, it } from 'vitest';
import {
  detectRetakes,
  detectRetakesFromWords,
  segmentUtterances,
} from '../retakeDetection';
import type { Word } from '../autoCut';

/** Build words spaced 0.2s apart starting at `at`, one word per token. */
function line(text: string, at: number, confidence?: number): Word[] {
  return text.split(' ').map((tok, i) => ({
    text: tok,
    start: at + i * 0.3,
    end: at + i * 0.3 + 0.25,
    ...(confidence !== undefined ? { confidence } : {}),
  }));
}

describe('segmentUtterances', () => {
  it('splits at gaps >= gapSeconds and keeps tight speech together', () => {
    const words = [...line('the shoulder needs load', 0), ...line('to adapt and grow', 2.5)];
    const utts = segmentUtterances(words, 0.5);
    expect(utts).toHaveLength(2);
    expect(utts[0].text).toBe('the shoulder needs load');
    expect(utts[1].text).toBe('to adapt and grow');
  });

  it('returns one utterance for continuous speech', () => {
    const utts = segmentUtterances(line('one two three four five', 0), 0.5);
    expect(utts).toHaveLength(1);
  });
});

describe('detectRetakes', () => {
  it('groups a 2-take repeat and keeps the last', () => {
    const words = [
      ...line('strong hips drive the serve forward', 0),
      ...line('strong hips drive the serve forward', 4),
    ];
    const { groups, removeRanges } = detectRetakesFromWords(words);
    expect(groups).toHaveLength(1);
    expect(groups[0].alternatives).toHaveLength(2);
    expect(groups[0].keptIndex).toBe(1);
    expect(groups[0].flagged).toBe(false);
    // Only the first take gets removed.
    expect(removeRanges).toHaveLength(1);
    expect(removeRanges[0].start).toBeCloseTo(0, 1);
  });

  it('extends a group across 3+ takes, keeping the final one', () => {
    const words = [
      ...line('the knee tracks over the toes here', 0),
      ...line('the knee tracks over the toes here', 4),
      ...line('the knee tracks over the toes here', 8),
    ];
    const { groups, removeRanges } = detectRetakesFromWords(words);
    expect(groups).toHaveLength(1);
    expect(groups[0].alternatives).toHaveLength(3);
    expect(groups[0].keptIndex).toBe(2);
    expect(removeRanges).toHaveLength(2);
  });

  it('tolerates word-order and small wording differences (token_sort_ratio)', () => {
    const words = [
      ...line('load the tissue then let it recover fully', 0),
      ...line('load the tissue then let it fully recover', 5),
    ];
    const { groups } = detectRetakesFromWords(words);
    expect(groups).toHaveLength(1);
  });

  it('flags and falls back when the last take is truncated', () => {
    const words = [
      ...line('every rep needs intent behind the movement pattern', 0),
      ...line('every rep needs intent', 6), // cut off mid-line
    ];
    // Force the pair to match despite the length difference by lowering
    // the threshold — mirrors a real trailing false-start.
    const { groups } = detectRetakes(segmentUtterances(words, 0.5), {
      similarityThreshold: 60,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].flagged).toBe(true);
    expect(groups[0].keptIndex).toBe(0);
  });

  it('prefers an earlier complete take when the last has anomalously low confidence', () => {
    const words = [
      ...line('control the descent on every single rep', 0, 0.95),
      ...line('control the descent on every single rep', 5, 0.5),
    ];
    const { groups } = detectRetakesFromWords(words);
    expect(groups).toHaveLength(1);
    expect(groups[0].flagged).toBe(true);
    expect(groups[0].keptIndex).toBe(0);
  });

  it('does not group different lines', () => {
    const words = [
      ...line('the shoulder is a mobile joint by design', 0),
      ...line('the ankle needs stiffness to transfer force', 5),
    ];
    const { groups } = detectRetakesFromWords(words);
    expect(groups).toHaveLength(0);
  });

  it('ignores short utterances (greetings, "okay")', () => {
    const words = [
      ...line('okay', 0),
      ...line('okay', 2),
      ...line('alright lets talk about the hips today', 4),
    ];
    const { groups } = detectRetakesFromWords(words);
    expect(groups).toHaveLength(0);
  });
});
