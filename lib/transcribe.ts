import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import OpenAI from 'openai';
import { generateAndValidateCaption } from './caption';
import { lintVoiceDna } from './voice/voiceDnaLint';
import { deepgramPost } from './editor/deepgramFetch';

const WHISPER_SIZE_LIMIT = 25 * 1024 * 1024;

const DRAFT_VIDEO_DIRS = [
  path.join(os.homedir(), 'Code', 'Social Media', 'Reels', 'Final'),
  path.join(os.homedir(), 'Social Media', 'Reels', 'Final'),
];

export function resolveDraftFile(filename: string): string | null {
  for (const dir of DRAFT_VIDEO_DIRS) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Read one hand-written caption sidecar verbatim. Shared by the reel sidecar
 * lookup below and the carousel folder's `caption.txt` (see
 * `readCarouselCaptionSidecar`) so both surfaces treat Lars's own words the
 * same way: returned as-is, never rewritten.
 */
export function readSidecarFile(sidecarPath: string): string | null {
  try {
    if (!fs.existsSync(sidecarPath)) return null;
    const text = fs.readFileSync(sidecarPath, 'utf-8').trim();
    if (!text) return null;
    // Warn-only lint: Lars's hand-written sidecars may be intentionally
    // off-template. Never rewrite or reject them — just surface it.
    const hard = lintVoiceDna(text).violations.filter((v) => v.hard);
    if (hard.length > 0) {
      console.warn(
        `[voice-dna] sidecar ${path.basename(sidecarPath)} has ${hard.length} lint violation(s) (kept verbatim): ` +
          hard.map((v) => `[${v.category}] "${v.match}"`).join('; '),
      );
    }
    return text;
  } catch {
    /* ignore unreadable sidecar */
    return null;
  }
}

/**
 * A caption sidecar next to the video (`<name>.caption.txt`, falling back to
 * `<name>.txt`) lets a human-written, already-voice-DNA-clean caption bypass
 * transcription. This is how silent StoryReel / loop / timelapse reels get
 * captioned — they have no audio, so Whisper yields empty or hallucinated text.
 */
export function readCaptionSidecar(filePath: string): string | null {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  for (const cand of [`${base}.caption.txt`, `${base}.txt`]) {
    const text = readSidecarFile(path.join(dir, cand));
    if (text) return text;
  }
  return null;
}

/**
 * The carousel equivalent: `Carousels/Final/<Title>/caption.txt`, written by
 * the export scripts from the deck's own caption panel. For carousels the
 * scanner's `filePath` is the folder, not a file.
 */
export function readCarouselCaptionSidecar(folderPath: string): string | null {
  return readSidecarFile(path.join(folderPath, 'caption.txt'));
}

/**
 * Transcribe with Deepgram Nova-3 (same call shape as the video pipeline's
 * ingest-takes.ts). Extracts a loudnorm'd 16kHz mono Opus first when ffmpeg
 * is available — faint across-the-gym speech needs the boost, and raw PCM
 * WAV bodies hit Deepgram's upload window (408 SLOW_UPLOAD) past ~1 min —
 * and falls back to posting the container as-is when it isn't (Deepgram
 * demuxes). Returns '' when there's no speech, null on API failure.
 */
async function transcribeWithDeepgram(filePath: string): Promise<string | null> {
  let bodyPath = filePath;
  let tmpAudio: string | null = null;
  try {
    tmpAudio = path.join(os.tmpdir(), `dg-${Date.now()}.ogg`);
    execSync(
      `ffmpeg -y -i "${filePath}" -vn -ac 1 -ar 16000 -af "highpass=f=80,loudnorm=I=-18:TP=-2:LRA=11" -c:a libopus -b:a 32k -application voip "${tmpAudio}" 2>/dev/null`,
    );
    bodyPath = tmpAudio;
  } catch {
    if (tmpAudio && fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio);
    tmpAudio = null; // no ffmpeg — send the original container
  }
  try {
    const res = await deepgramPost({
      url: 'https://api.deepgram.com/v1/listen?model=nova-3&punctuate=true&smart_format=true&language=en',
      apiKey: process.env.DEEPGRAM_API_KEY ?? '',
      contentType: bodyPath === tmpAudio ? 'audio/ogg' : 'application/octet-stream',
      body: fs.readFileSync(bodyPath),
      onRetry: (msg) => console.warn(`[transcribe] ${msg}`),
    });
    if (!res.ok) {
      console.warn(`[transcribe] Deepgram ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data: any = await res.json();
    return (data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '').trim();
  } catch (e: any) {
    console.warn(`[transcribe] Deepgram error: ${e?.message ?? e}`);
    return null;
  } finally {
    if (tmpAudio && fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio);
  }
}

/**
 * True if the media file has at least one audio stream. Silent reels have none,
 * so there's nothing for Whisper to transcribe. Best-effort: if ffprobe is
 * missing or errors, assume audio and let Whisper try.
 */
function hasAudioStream(filePath: string): boolean {
  try {
    const out = execSync(
      `ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8' },
    ).trim();
    return out.length > 0;
  } catch {
    return true;
  }
}

export async function transcribeVideoToCaption(
  filePath: string,
  captionHint?: string,
): Promise<string | null> {
  const { caption } = await transcribeVideoToCaptionDetailed(filePath, captionHint);
  return caption;
}

/**
 * Like transcribeVideoToCaption but reports provenance, so callers queueing
 * the caption can set `voiceOverride` for human-written sidecar text (which
 * the queue's Voice-DNA gate must not block).
 */
export async function transcribeVideoToCaptionDetailed(
  filePath: string,
  captionHint?: string,
): Promise<{ caption: string | null; fromSidecar: boolean }> {
  if (!fs.existsSync(filePath)) return { caption: null, fromSidecar: false };

  // A human-written caption sidecar (`<name>.caption.txt`) wins outright — the
  // caption is already approved, so skip Whisper + the LLM.
  const sidecar = readCaptionSidecar(filePath);
  if (sidecar) return { caption: sidecar, fromSidecar: true };
  return { caption: await transcribeAudioToCaption(filePath, captionHint), fromSidecar: false };
}

async function transcribeAudioToCaption(
  filePath: string,
  captionHint?: string,
): Promise<string | null> {
  // Silent reels have no audio track — nothing to transcribe, bail to the
  // placeholder (the sidecar path is how silent reels get captioned).
  if (!hasAudioStream(filePath)) return null;

  // Deepgram Nova-3 first ("one ASR everywhere" — same engine as the editor
  // pipeline), with loudnorm pre-normalization when ffmpeg is available.
  // Whisper remains as fallback for environments without DEEPGRAM_API_KEY
  // (e.g. Vercel until the env var is added there).
  if (process.env.DEEPGRAM_API_KEY) {
    const transcript = await transcribeWithDeepgram(filePath);
    if (transcript === null) return null; // API error — don't double-spend on Whisper
    if (!transcript) return null;         // genuinely no speech
    return generateAndValidateCaption(transcript, captionHint);
  }

  if (!process.env.OPENAI_API_KEY) return null;

  const stat = fs.statSync(filePath);
  let fileToSend = filePath;
  let tmpAudio: string | null = null;

  if (stat.size > WHISPER_SIZE_LIMIT) {
    tmpAudio = path.join(os.tmpdir(), `whisper-${Date.now()}.mp3`);
    try {
      execSync(`ffmpeg -y -i "${filePath}" -vn -ar 16000 -ac 1 -b:a 64k "${tmpAudio}" 2>/dev/null`);
      fileToSend = tmpAudio;
    } catch {
      if (fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio);
      return null;
    }
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await openai.audio.transcriptions.create({
      file: fs.createReadStream(fileToSend),
      model: 'whisper-1',
    });
    const transcript = res.text?.trim();
    if (!transcript) return null;
    return await generateAndValidateCaption(transcript, captionHint);
  } catch {
    return null;
  } finally {
    if (tmpAudio && fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio);
  }
}
