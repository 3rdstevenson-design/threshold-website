/**
 * captionSync.ts
 *
 * Third-layer caption-sync audit + auto-correct using Deepgram Nova-3.
 *
 * Purpose: after the polish pipeline renders `final-v2.mp4`, re-transcribe
 * the EDITED audio with Deepgram (independent of our Whisper pass) and
 * compare per-word timings against the existing caption track. If drift
 * exceeds the threshold, overwrite caption timestamps with Deepgram's
 * word-level timings — captions then match the actual rendered audio.
 *
 * Why Deepgram (not WhisperX / ElevenLabs / AssemblyAI):
 *   - 30-47% lower WER than AssemblyAI on production benchmarks.
 *   - Word-level timestamp precision is called out as a Nova-3 feature.
 *   - Per-second billing (matters for 15-60s Reels).
 *   - Truly independent from the Whisper used for transcription upstream
 *     — different model family = different failure modes.
 *
 * This module is isomorphic (no Node-only imports at top-level). The
 * `transcribeWithDeepgram()` function uses global fetch, available in
 * both Node (18+) and the Edge runtime. The file-read helper is exported
 * separately so callers can choose how to load the audio bytes.
 */

import type { Caption } from './editPlan';
import { normalizeWord, type Word } from './autoCut';
import { chunkCaptions, type CaptionChunkOptions } from './captionChunker';

export type DeepgramWord = {
  /** Word text (punctuation may be attached depending on request params). */
  text: string;
  /** Start time on the edited timeline, in milliseconds. */
  startMs: number;
  /** End time on the edited timeline, in milliseconds. */
  endMs: number;
  /** Normalized form (lowercase, no punctuation). */
  norm: string;
  /** Deepgram confidence (0..1) if available. */
  confidence?: number;
};

export type DeepgramResponse = {
  words: DeepgramWord[];
  /** Raw transcript string (joined from Deepgram's top alternative). */
  transcript: string;
  /** Request duration, if reported. */
  audioDurationSec: number | null;
};

export type SyncDriftResult = {
  /** Per-caption drift in milliseconds. null = no matching word found. */
  perCaption: Array<{
    id: string;
    text: string;
    expectedStartMs: number;
    matchedStartMs: number | null;
    driftMs: number | null;
  }>;
  maxDriftMs: number;
  meanDriftMs: number;
  captionCount: number;
  matchedCount: number;
};

export type AutoCorrectResult = {
  captions: Caption[];
  rewritten: number;
  untouched: number;
};

// ── Deepgram call ───────────────────────────────────────────────────

const DEEPGRAM_ENDPOINT =
  'https://api.deepgram.com/v1/listen?model=nova-3&punctuate=false&smart_format=false&utterances=false';

/**
 * Send an audio buffer to Deepgram Nova-3, return flat word-level
 * timestamps in edited-timeline milliseconds.
 *
 * The audio file should be the rendered final video's audio track (e.g.
 * a WAV extracted with ffmpeg). Deepgram returns timings relative to the
 * start of the audio — which matches our edited timeline.
 */
export async function transcribeWithDeepgram(
  audio: ArrayBuffer | Buffer | Uint8Array,
  apiKey: string,
  options: { contentType?: string; signal?: AbortSignal } = {},
): Promise<DeepgramResponse> {
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY missing');
  const contentType = options.contentType ?? 'audio/wav';

  const body = toBodyInit(audio);
  const res = await fetch(DEEPGRAM_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': contentType,
    },
    body,
    signal: options.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Deepgram ${res.status}: ${text.slice(0, 300) || res.statusText}`,
    );
  }
  const json = (await res.json()) as DeepgramApiResponse;
  return parseDeepgramResponse(json);
}

/**
 * Parse the Deepgram Listen API response into our flat word-timing shape.
 * Exported so tests can drive it with mock payloads.
 */
export function parseDeepgramResponse(json: DeepgramApiResponse): DeepgramResponse {
  const alt = json?.results?.channels?.[0]?.alternatives?.[0];
  const transcript = alt?.transcript ?? '';
  const rawWords = alt?.words ?? [];
  const words: DeepgramWord[] = rawWords
    .map((w) => {
      const text = (w.punctuated_word ?? w.word ?? '').trim();
      const norm = normalizeWord(text);
      return {
        text,
        startMs: Math.round((w.start ?? 0) * 1000),
        endMs: Math.round((w.end ?? 0) * 1000),
        norm,
        confidence: typeof w.confidence === 'number' ? w.confidence : undefined,
      };
    })
    .filter((w) => w.norm.length > 0 && w.endMs > w.startMs);
  const audioDurationSec = json?.metadata?.duration ?? null;
  return { words, transcript, audioDurationSec };
}

// ── Drift measurement ──────────────────────────────────────────────

/**
 * Measure caption-vs-Deepgram drift without modifying captions. Used to
 * gate whether auto-correction is needed.
 */
export function measureCaptionDrift(
  captions: Caption[],
  deepgramWords: DeepgramWord[],
): SyncDriftResult {
  const perCaption: SyncDriftResult['perCaption'] = [];
  const drifts: number[] = [];
  let matchedCount = 0;

  for (const cap of captions) {
    const capWords = cap.text.split(/\s+/).map(normalizeWord).filter(Boolean);
    if (capWords.length === 0) {
      perCaption.push({
        id: cap.id,
        text: cap.text,
        expectedStartMs: cap.startMs,
        matchedStartMs: null,
        driftMs: null,
      });
      continue;
    }
    const needle = capWords[0];
    const match = findClosestWord(deepgramWords, needle, cap.startMs, 2000, 5000);
    if (match === null) {
      perCaption.push({
        id: cap.id,
        text: cap.text,
        expectedStartMs: cap.startMs,
        matchedStartMs: null,
        driftMs: null,
      });
      continue;
    }
    const driftMs = Math.abs(match.startMs - cap.startMs);
    drifts.push(driftMs);
    matchedCount++;
    perCaption.push({
      id: cap.id,
      text: cap.text,
      expectedStartMs: cap.startMs,
      matchedStartMs: match.startMs,
      driftMs,
    });
  }

  const maxDriftMs = drifts.length > 0 ? Math.max(...drifts) : 0;
  const meanDriftMs =
    drifts.length > 0
      ? Math.round(drifts.reduce((a, b) => a + b, 0) / drifts.length)
      : 0;

  return {
    perCaption,
    maxDriftMs,
    meanDriftMs,
    captionCount: captions.length,
    matchedCount,
  };
}

// ── Auto-correction ────────────────────────────────────────────────

export type AutoCorrectOptions = {
  /** Rewrite a caption only if its drift exceeds this, in ms. Default 80. */
  driftThresholdMs?: number;
  /** Search window for the first-word match, in ms. Default 2000. */
  searchWindowMs?: number;
};

/**
 * Rewrite caption timestamps to match Deepgram's word timings. Only
 * captions whose first-word drift exceeds `driftThresholdMs` are
 * rewritten; others are left untouched so we preserve manually-tuned
 * captions that were already in sync.
 *
 * We rewrite `startMs`, `endMs`, and (when present) `words[]` timings.
 * The original caption text is preserved — this is a pure timing fix.
 */
export function autoCorrectCaptions(
  captions: Caption[],
  deepgramWords: DeepgramWord[],
  options: AutoCorrectOptions = {},
): AutoCorrectResult {
  const threshold = options.driftThresholdMs ?? 80;
  const window = options.searchWindowMs ?? 2000;

  let rewritten = 0;
  let untouched = 0;
  const out: Caption[] = captions.map((cap) => {
    const capTokens = cap.text.split(/\s+/);
    const capNorms = capTokens.map(normalizeWord).filter(Boolean);
    if (capNorms.length === 0) {
      untouched++;
      return cap;
    }

    // 1. Find the caption's first word in the Deepgram stream. Fall back
    //    to a 2.5x extended window so heavily-drifted captions still get
    //    rewritten (otherwise they stay drifted forever).
    const firstMatch = findClosestWord(
      deepgramWords,
      capNorms[0],
      cap.startMs,
      window,
      window * 2.5,
    );
    if (!firstMatch) {
      untouched++;
      return cap;
    }
    const firstDrift = Math.abs(firstMatch.startMs - cap.startMs);
    if (firstDrift < threshold) {
      untouched++;
      return cap;
    }

    // 2. Walk Deepgram words forward starting at firstMatch and pull the
    //    next N-1 words that match each caption token. If the transcript
    //    diverges, stop consuming — we'll still use whatever we matched.
    const startIdx = deepgramWords.indexOf(firstMatch);
    const matchedWords: DeepgramWord[] = [firstMatch];
    let cursor = startIdx + 1;
    for (let i = 1; i < capNorms.length; i++) {
      const needle = capNorms[i];
      // Allow small lookahead to skip Deepgram interjections.
      let found = -1;
      for (let j = cursor; j < Math.min(deepgramWords.length, cursor + 3); j++) {
        if (deepgramWords[j].norm === needle) {
          found = j;
          break;
        }
      }
      if (found < 0) break;
      matchedWords.push(deepgramWords[found]);
      cursor = found + 1;
    }

    // 3. Reconstruct caption timing from matched Deepgram words.
    const newStart = matchedWords[0].startMs;
    const newEnd = matchedWords[matchedWords.length - 1].endMs;

    // 4. If the caption had per-word timing (karaoke mode), rewrite that
    //    too. Fall back to even distribution across the new span for any
    //    tokens we couldn't match.
    let newWords = cap.words;
    if (cap.words && cap.words.length > 0) {
      const span = Math.max(1, newEnd - newStart);
      newWords = cap.words.map((cw, idx) => {
        if (idx < matchedWords.length) {
          return { text: cw.text, startMs: matchedWords[idx].startMs, endMs: matchedWords[idx].endMs };
        }
        const frac = idx / cap.words!.length;
        return {
          text: cw.text,
          startMs: Math.round(newStart + span * frac),
          endMs: Math.round(newStart + span * ((idx + 1) / cap.words!.length)),
        };
      });
    }

    rewritten++;
    return {
      ...cap,
      startMs: newStart,
      endMs: Math.max(newStart + 1, newEnd),
      words: newWords,
    };
  });

  return { captions: out, rewritten, untouched };
}

// ── Re-chunk from Deepgram (text-truth from rendered audio) ────────

/**
 * Build fresh captions whose TEXT and TIMING both come from Deepgram's
 * transcription of the rendered audio. Use this when caption text drift
 * (not just timing) is suspected — `autoCorrectCaptions()` only rewrites
 * timing, so missing/extra words in the source captions persist through
 * that pass and keep showing up as Whisper drift on the next audit.
 *
 * The Deepgram words are already in edited-timeline ms (their stream is
 * the rendered audio). We synthesize a passthrough clip that maps
 * source-time = edited-time so we can reuse `chunkCaptions`'s full
 * post-processing (lead-in, gap-fill, fragment merging, customSpellings).
 */
export function rechunkFromDeepgram(
  deepgramWords: DeepgramWord[],
  options: CaptionChunkOptions = {},
): Caption[] {
  if (deepgramWords.length === 0) return [];
  const words: Word[] = deepgramWords.map((w) => ({
    text: w.text,
    start: w.startMs / 1000,
    end: w.endMs / 1000,
  }));
  const lastEndSec = words.reduce((m, w) => Math.max(m, w.end), 0);
  const passthroughClip = {
    id: 'rechunk-passthrough',
    sourceStart: 0,
    sourceEnd: lastEndSec + 1,
  };
  return chunkCaptions(words, [passthroughClip], options);
}

// ── Internals ──────────────────────────────────────────────────────

/**
 * Find the Deepgram word closest in time to `targetMs` whose normalized
 * text matches `needle`. Three-pass strategy:
 *
 *   1. Exact `norm` match within `windowMs`.
 *   2. Substring match (either side starts-with the other) within
 *      `windowMs`. Catches splits like Whisper "kierke" vs Deepgram
 *      "kierkegaard", or Whisper "rorschach" vs Deepgram "rorshack".
 *   3. Extended-window pass (both exact + substring) up to
 *      `fallbackWindowMs` if provided. Used as a last-resort for
 *      captions that drifted far from their expected position.
 *
 * Exported so other callers (re-chunking, manual sync tools) can reuse
 * the same matching policy.
 */
export function findClosestWord(
  words: DeepgramWord[],
  needle: string,
  targetMs: number,
  windowMs: number,
  fallbackWindowMs?: number,
): DeepgramWord | null {
  if (!needle) return null;

  const search = (limit: number, fuzzy: boolean): DeepgramWord | null => {
    let best: DeepgramWord | null = null;
    let bestDelta = Infinity;
    for (const w of words) {
      const matches = fuzzy
        ? w.norm.length >= 3 &&
          needle.length >= 3 &&
          (w.norm.startsWith(needle) || needle.startsWith(w.norm))
        : w.norm === needle;
      if (!matches) continue;
      const delta = Math.abs(w.startMs - targetMs);
      if (delta > limit) continue;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = w;
      }
    }
    return best;
  };

  return (
    search(windowMs, false) ??
    search(windowMs, true) ??
    (fallbackWindowMs && fallbackWindowMs > windowMs
      ? (search(fallbackWindowMs, false) ?? search(fallbackWindowMs, true))
      : null)
  );
}

function toBodyInit(audio: ArrayBuffer | Buffer | Uint8Array): BodyInit {
  // Node's fetch accepts ArrayBuffer / Uint8Array / Buffer directly via
  // BodyInit. We widen to BodyInit so TS doesn't complain under the
  // strict DOM fetch typing.
  return audio as unknown as BodyInit;
}

// ── Raw response types (narrow subset of the Deepgram Listen API) ──

export type DeepgramApiResponse = {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        words?: Array<{
          word?: string;
          punctuated_word?: string;
          start?: number;
          end?: number;
          confidence?: number;
        }>;
      }>;
    }>;
  };
};
