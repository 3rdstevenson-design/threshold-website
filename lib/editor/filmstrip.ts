/**
 * filmstrip.ts — shared constants for the timeline filmstrip.
 *
 * The filmstrip is ONE wide JPEG of FILMSTRIP_FRAMES frames sampled
 * evenly across the full source video (frame i sits at
 * i/(FILMSTRIP_FRAMES-1) × sourceDuration). The server tiles it once per
 * project (ffmpeg fps+tile); the client picks frames out of it with
 * background-size / background-position math — no per-frame requests.
 *
 * Isomorphic: imported by both the API route and Timeline.tsx, so the
 * frame count can never drift between generator and consumer.
 */

export const FILMSTRIP_FRAMES = 48;

/** Height each tiled frame is scaled to (px). Width follows the source aspect. */
export const FILMSTRIP_FRAME_HEIGHT = 96;

/**
 * Index of the filmstrip frame nearest to `sourceSec`, clamped to range.
 */
export function filmstripFrameIndex(sourceSec: number, sourceDuration: number): number {
  if (!(sourceDuration > 0)) return 0;
  const idx = Math.round((sourceSec / sourceDuration) * (FILMSTRIP_FRAMES - 1));
  return Math.max(0, Math.min(FILMSTRIP_FRAMES - 1, idx));
}

/**
 * CSS background props that display exactly one filmstrip frame in an
 * element (the element should roughly match the frame's aspect ratio).
 */
export function filmstripFrameBackground(url: string, frameIndex: number): {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
} {
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: `${FILMSTRIP_FRAMES * 100}% 100%`,
    // Percentage positioning: p% aligns p% of the image with p% of the
    // container, so frame i lands exactly at i/(N-1) × 100%.
    backgroundPosition: `${(frameIndex / (FILMSTRIP_FRAMES - 1)) * 100}% 0`,
    backgroundRepeat: 'no-repeat',
  };
}
