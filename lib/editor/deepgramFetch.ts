/**
 * deepgramFetch.ts — single POST path to Deepgram with retry/backoff.
 *
 * Every Deepgram upload in this repo goes through here so transient
 * failures (408 SLOW_UPLOAD, 429, 5xx, network drops) retry instead of
 * killing a whole pipeline run. Auth/validation failures (400/401/403)
 * are returned to the caller immediately — retrying can't fix those.
 */

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1000; // 1s → 2s → 4s (+ jitter)

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('aborted')); return; }
    const t = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); cleanup(); reject(new Error('aborted')); };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function deepgramPost(input: {
  url: string;
  apiKey: string;
  contentType: string;
  body: Buffer | Uint8Array | ArrayBuffer;
  signal?: AbortSignal;
  /** Surfaced in the SSE log panel — retries must be visible, not silent. */
  onRetry?: (msg: string) => void;
}): Promise<Response> {
  const { url, apiKey, contentType, body, signal, onRetry } = input;
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY missing');

  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error('aborted');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': contentType,
        },
        body: body as BodyInit,
        signal,
      });
      if (res.ok || !isRetryableStatus(res.status)) return res;
      const text = await res.text().catch(() => '');
      lastError = `Deepgram ${res.status}: ${text.slice(0, 200) || res.statusText}`;
    } catch (e) {
      if (signal?.aborted) throw new Error('aborted');
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt < MAX_ATTEMPTS) {
      const delay =
        BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      onRetry?.(
        `Deepgram attempt ${attempt}/${MAX_ATTEMPTS} failed (${lastError}) — retrying in ${Math.round(delay / 1000)}s…`,
      );
      await sleep(delay, signal);
    }
  }
  throw new Error(`Deepgram failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}
