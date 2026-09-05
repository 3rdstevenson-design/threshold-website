import { describe, it, expect } from 'vitest';
import {
  measureCaptionDrift,
  autoCorrectCaptions,
  parseDeepgramResponse,
  rechunkFromDeepgram,
  findClosestWord,
  type DeepgramWord,
} from '../captionSync';
import type { Caption } from '../editPlan';

// Fixture captions carry word timing whose first word starts AT startMs,
// i.e. no lead-in — so drift numbers below compare speech onset to speech
// onset. Captions with no `words` are assumed to have the 150ms house
// lead-in (see CAPTION_LEAD_IN_MS) and are covered by the lead-in suite.
const cap = (id: string, startMs: number, endMs: number, text: string): Caption => ({
  id,
  startMs,
  endMs,
  text,
  words: text.trim()
    ? text.trim().split(/\s+/).map((t, i, arr) => {
        const span = (endMs - startMs) / arr.length;
        return { text: t, startMs: Math.round(startMs + span * i), endMs: Math.round(startMs + span * (i + 1)) };
      })
    : undefined,
});

describe('parseDeepgramResponse', () => {
  it('flattens nested results.channels.alternatives.words into DeepgramWord[]', () => {
    const raw = {
      results: {
        channels: [
          {
            alternatives: [
              {
                words: [
                  { word: 'hello', start: 0.1, end: 0.5, confidence: 0.99 },
                  { word: 'world', start: 0.6, end: 1.0, confidence: 0.98 },
                ],
              },
            ],
          },
        ],
      },
    };
    const parsed = parseDeepgramResponse(raw);
    expect(parsed.words).toHaveLength(2);
    expect(parsed.words[0].text).toBe('hello');
    expect(parsed.words[0].norm).toBe('hello');
    expect(parsed.words[0].startMs).toBe(100);
    expect(parsed.words[0].endMs).toBe(500);
    expect(parsed.words[1].startMs).toBe(600);
  });

  it('tolerates missing alternatives', () => {
    const parsed = parseDeepgramResponse({ results: { channels: [{ alternatives: [] }] } });
    expect(parsed.words).toEqual([]);
  });
});

describe('measureCaptionDrift', () => {
  const dgWords = (entries: Array<{ w: string; s: number; e: number }>): DeepgramWord[] =>
    entries.map((x) => ({
      text: x.w,
      norm: x.w.toLowerCase().replace(/[^a-z0-9']/g, ''),
      startMs: x.s,
      endMs: x.e,
      confidence: 1,
    }));

  it('reports zero drift when captions align perfectly', () => {
    const captions = [cap('c1', 100, 500, 'Hello world')];
    const words = dgWords([
      { w: 'hello', s: 100, e: 300 },
      { w: 'world', s: 300, e: 500 },
    ]);
    const drift = measureCaptionDrift(captions, words);
    expect(drift.maxDriftMs).toBe(0);
    expect(drift.meanDriftMs).toBe(0);
    expect(drift.matchedCount).toBe(1);
    expect(drift.captionCount).toBe(1);
  });

  it('detects drift when caption start is off from Deepgram', () => {
    const captions = [cap('c1', 200, 600, 'Hello world')];
    const words = dgWords([
      { w: 'hello', s: 100, e: 300 },
      { w: 'world', s: 300, e: 500 },
    ]);
    const drift = measureCaptionDrift(captions, words);
    expect(drift.maxDriftMs).toBe(100);
    expect(drift.matchedCount).toBe(1);
  });

  it('measures against speech onset, not the 150ms-early caption start', () => {
    // A chunkCaptions() caption: startMs is 150 before the first word.
    const chunked: Caption = { id: 'c1', startMs: 850, endMs: 1500, text: 'Hello world',
      words: [{ text: 'Hello', startMs: 1000, endMs: 1200 }, { text: 'world', startMs: 1200, endMs: 1500 }] };
    const words = dgWords([{ w: 'hello', s: 1000, e: 1200 }, { w: 'world', s: 1200, e: 1500 }]);
    expect(measureCaptionDrift([chunked], words).maxDriftMs).toBe(0);
    // Same caption without word timing: onset is inferred as startMs + 150.
    const bare: Caption = { id: 'c2', startMs: 850, endMs: 1500, text: 'Hello world' };
    expect(measureCaptionDrift([bare], words).maxDriftMs).toBe(0);
    // A genuinely late caption still reads as drift.
    const late: Caption = { ...bare, id: 'c3', startMs: 1150 };
    expect(measureCaptionDrift([late], words).maxDriftMs).toBe(300);
  });

  it('skips captions with no match inside the search window', () => {
    const captions = [cap('c1', 10000, 10400, 'Nevermore said the raven')];
    const words = dgWords([{ w: 'hello', s: 100, e: 300 }]);
    const drift = measureCaptionDrift(captions, words);
    expect(drift.matchedCount).toBe(0);
    expect(drift.perCaption[0].driftMs).toBe(null);
  });
});

describe('autoCorrectCaptions', () => {
  const dgWords = (entries: Array<{ w: string; s: number; e: number }>): DeepgramWord[] =>
    entries.map((x) => ({
      text: x.w,
      norm: x.w.toLowerCase().replace(/[^a-z0-9']/g, ''),
      startMs: x.s,
      endMs: x.e,
      confidence: 1,
    }));

  it('leaves captions alone when drift is below threshold', () => {
    const captions = [cap('c1', 102, 498, 'Hello world')];
    const words = dgWords([
      { w: 'hello', s: 100, e: 300 },
      { w: 'world', s: 300, e: 500 },
    ]);
    const r = autoCorrectCaptions(captions, words, { driftThresholdMs: 80 });
    expect(r.rewritten).toBe(0);
    expect(r.untouched).toBe(1);
    expect(r.captions[0].startMs).toBe(102);
    expect(r.captions[0].endMs).toBe(498);
  });

  it('rewrites timing when drift exceeds threshold', () => {
    const captions = [cap('c1', 1000, 1400, 'Hello world')];
    const words = dgWords([
      { w: 'hello', s: 100, e: 300 },
      { w: 'world', s: 300, e: 500 },
    ]);
    const r = autoCorrectCaptions(captions, words, {
      driftThresholdMs: 80,
      searchWindowMs: 2000,
    });
    expect(r.rewritten).toBe(1);
    // Rewritten captions keep the house lead-in: onset 100 → display at 0.
    expect(r.captions[0].startMs).toBe(0);
    expect(r.captions[0].words?.[0].startMs).toBe(100);
    // endMs should shift to match the last matched word's end
    expect(r.captions[0].endMs).toBeGreaterThan(r.captions[0].startMs);
    // Original text preserved
    expect(r.captions[0].text).toBe('Hello world');
  });

  it('re-applies the lead-in when correcting a chunked caption', () => {
    const chunked: Caption = { id: 'c1', startMs: 850, endMs: 1500, text: 'Hello world',
      words: [{ text: 'Hello', startMs: 1000, endMs: 1200 }, { text: 'world', startMs: 1200, endMs: 1500 }] };
    // Rendered audio says the words land 400ms later.
    const words = dgWords([{ w: 'hello', s: 1400, e: 1600 }, { w: 'world', s: 1600, e: 1900 }]);
    const r = autoCorrectCaptions([chunked], words, { driftThresholdMs: 80 });
    expect(r.rewritten).toBe(1);
    expect(r.captions[0].startMs).toBe(1250);
    expect(r.captions[0].words?.[0].startMs).toBe(1400);
    // And a second measurement now reads clean, instead of a constant 150.
    expect(measureCaptionDrift(r.captions, words).maxDriftMs).toBe(0);
  });

  it('preserves caption id and text when rewriting', () => {
    const captions = [cap('original-id', 1000, 1400, 'Hello world')];
    const words = dgWords([
      { w: 'hello', s: 100, e: 300 },
      { w: 'world', s: 300, e: 500 },
    ]);
    const r = autoCorrectCaptions(captions, words);
    expect(r.captions[0].id).toBe('original-id');
    expect(r.captions[0].text).toBe('Hello world');
  });

  it('increments untouched for captions with empty text', () => {
    const captions = [cap('c1', 0, 100, '   ')];
    const r = autoCorrectCaptions(captions, []);
    expect(r.rewritten).toBe(0);
    expect(r.untouched).toBe(1);
  });

  it('leaves caption timing alone when first word has no Deepgram match', () => {
    const captions = [cap('c1', 1000, 1400, 'Zorb flimmer')];
    const words = dgWords([
      { w: 'hello', s: 100, e: 300 },
      { w: 'world', s: 300, e: 500 },
    ]);
    const r = autoCorrectCaptions(captions, words, { searchWindowMs: 2000 });
    expect(r.rewritten).toBe(0);
    expect(r.untouched).toBe(1);
    expect(r.captions[0].startMs).toBe(1000);
  });
});

describe('findClosestWord — fuzzy fallback', () => {
  const dgWords = (entries: Array<{ w: string; s: number; e: number }>): DeepgramWord[] =>
    entries.map((x) => ({
      text: x.w,
      norm: x.w.toLowerCase().replace(/[^a-z0-9']/g, ''),
      startMs: x.s,
      endMs: x.e,
      confidence: 1,
    }));

  it('finds an exact match within the primary window', () => {
    const words = dgWords([{ w: 'hello', s: 1000, e: 1300 }]);
    const m = findClosestWord(words, 'hello', 1100, 500);
    expect(m?.text).toBe('hello');
  });

  it('falls back to substring match when exact fails (Whisper "kierke" finds Deepgram "kierkegaard")', () => {
    const words = dgWords([{ w: 'kierkegaard', s: 1000, e: 1500 }]);
    const m = findClosestWord(words, 'kierke', 1100, 500);
    expect(m?.text).toBe('kierkegaard');
  });

  it('falls back to substring in the other direction (Deepgram split, Whisper full)', () => {
    const words = dgWords([{ w: 'soren', s: 1000, e: 1500 }]);
    const m = findClosestWord(words, 'sorenkierkegaard', 1100, 500);
    expect(m?.text).toBe('soren');
  });

  it('uses extended fallback window when primary returns nothing', () => {
    const words = dgWords([{ w: 'hello', s: 5000, e: 5300 }]);
    const close = findClosestWord(words, 'hello', 1000, 500);
    expect(close).toBeNull();
    const wide = findClosestWord(words, 'hello', 1000, 500, 6000);
    expect(wide?.text).toBe('hello');
  });
});

describe('rechunkFromDeepgram', () => {
  const dgWords = (entries: Array<{ w: string; s: number; e: number }>): DeepgramWord[] =>
    entries.map((x) => ({
      text: x.w,
      norm: x.w.toLowerCase().replace(/[^a-z0-9']/g, ''),
      startMs: x.s,
      endMs: x.e,
      confidence: 1,
    }));

  it('produces captions whose text matches the Deepgram input verbatim', () => {
    const words = dgWords([
      { w: 'hello', s: 100, e: 400 },
      { w: 'world', s: 500, e: 800 },
    ]);
    const caps = rechunkFromDeepgram(words, { leadInMs: 0, gapFillMs: 0 });
    const joined = caps.map((c) => c.text).join(' ').toLowerCase();
    expect(joined).toContain('hello');
    expect(joined).toContain('world');
    // Must NOT carry words that weren't in the Deepgram stream
    expect(joined).not.toContain('foo');
  });

  it('returns [] for empty input', () => {
    expect(rechunkFromDeepgram([])).toEqual([]);
  });

  it('respects customSpellings', () => {
    const words = dgWords([
      { w: 'coach', s: 100, e: 400 },
      { w: 'cav', s: 500, e: 800 },
    ]);
    const caps = rechunkFromDeepgram(words, {
      leadInMs: 0,
      gapFillMs: 0,
      customSpellings: [{ from: 'coach cav', to: 'Coach Kav' }],
    });
    const joined = caps.map((c) => c.text).join(' ');
    expect(joined).toContain('Coach Kav');
  });

  it('preserves Deepgram timing on the output captions', () => {
    const words = dgWords([
      { w: 'one', s: 1000, e: 1300 },
      { w: 'two', s: 1400, e: 1700 },
    ]);
    const caps = rechunkFromDeepgram(words, { leadInMs: 0, gapFillMs: 0, maxWords: 2 });
    expect(caps).toHaveLength(1);
    expect(caps[0].startMs).toBe(1000);
    expect(caps[0].endMs).toBe(1700);
  });
});
