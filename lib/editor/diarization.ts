/**
 * diarization.ts
 *
 * Speaker diarization via Deepgram Nova-3. Long-form video sources run
 * this pass after transcription so that downstream reframing can pick
 * the active speaker when two faces don't fit in a 9:16 crop.
 *
 * Input: an audio blob extracted from the long-form source (usually a
 * WAV pulled out via ffmpeg). Output: per-word speaker labels aligned
 * to source-time seconds.
 *
 *   { words: [{ startSec, endSec, speaker }], speakers: ['0', '1', ...] }
 *
 * Deepgram is an audio service — it cannot visually track a person
 * around the frame. The visual half of the reframing heuristic is
 * provided by MediaPipe in scripts/reframe.py; diarization here is
 * only the audio tiebreaker.
 */

export type DiarizedWord = {
  text: string;
  startSec: number;
  endSec: number;
  speaker: string;
};

export type DiarizationFile = {
  generatedAt: string;
  model: string;
  words: DiarizedWord[];
  speakers: string[];
  audioDurationSec: number | null;
};

const DEEPGRAM_DIARIZE_ENDPOINT =
  'https://api.deepgram.com/v1/listen?model=nova-3&punctuate=false&smart_format=false&utterances=false&diarize=true';

type RawDeepgramDiarizeResponse = {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        words?: Array<{
          word?: string;
          punctuated_word?: string;
          start?: number;
          end?: number;
          speaker?: number;
        }>;
      }>;
    }>;
  };
};

export async function diarizeWithDeepgram(
  audio: ArrayBuffer | Buffer | Uint8Array,
  apiKey: string,
  options: { contentType?: string; signal?: AbortSignal } = {},
): Promise<DiarizationFile> {
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY missing');
  const contentType = options.contentType ?? 'audio/wav';

  const res = await fetch(DEEPGRAM_DIARIZE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': contentType,
    },
    body: audio as unknown as BodyInit,
    signal: options.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Deepgram diarize ${res.status}: ${text.slice(0, 300) || res.statusText}`,
    );
  }
  const json = (await res.json()) as RawDeepgramDiarizeResponse;
  return parseDiarizationResponse(json);
}

export function parseDiarizationResponse(
  json: RawDeepgramDiarizeResponse,
): DiarizationFile {
  const rawWords = json?.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  const speakerSet = new Set<string>();
  const words: DiarizedWord[] = rawWords
    .map((w) => {
      const speaker = String(w.speaker ?? 0);
      speakerSet.add(speaker);
      return {
        text: (w.punctuated_word ?? w.word ?? '').trim(),
        startSec: typeof w.start === 'number' ? w.start : 0,
        endSec: typeof w.end === 'number' ? w.end : 0,
        speaker,
      };
    })
    .filter((w) => w.text.length > 0 && w.endSec > w.startSec);

  return {
    generatedAt: new Date().toISOString(),
    model: 'nova-3',
    words,
    speakers: Array.from(speakerSet).sort(),
    audioDurationSec: json?.metadata?.duration ?? null,
  };
}

/**
 * Return the speaker active at `tSec`, or null if nobody is talking
 * (silence or between-word gap). Used by reframe.py via reframe.ts to
 * pick which face to center when two don't fit in a 9:16 window.
 */
export function activeSpeakerAt(
  file: DiarizationFile,
  tSec: number,
): string | null {
  for (const w of file.words) {
    if (tSec >= w.startSec && tSec <= w.endSec) return w.speaker;
  }
  return null;
}

/**
 * Return a new DiarizationFile with words filtered to [startSec, endSec]
 * and all timestamps shifted so the sub-range starts at 0. Used by
 * extractClip.ts to carry diarization forward into the child clip's
 * folder.
 */
export function subsetDiarization(
  file: DiarizationFile,
  startSec: number,
  endSec: number,
): DiarizationFile {
  const shifted: DiarizedWord[] = [];
  const speakerSet = new Set<string>();
  for (const w of file.words) {
    if (w.endSec < startSec || w.startSec > endSec) continue;
    const s = Math.max(0, w.startSec - startSec);
    const e = Math.min(endSec - startSec, w.endSec - startSec);
    if (e <= s) continue;
    speakerSet.add(w.speaker);
    shifted.push({ text: w.text, startSec: s, endSec: e, speaker: w.speaker });
  }
  return {
    generatedAt: file.generatedAt,
    model: file.model,
    words: shifted,
    speakers: Array.from(speakerSet).sort(),
    audioDurationSec: Math.max(0, endSec - startSec),
  };
}
