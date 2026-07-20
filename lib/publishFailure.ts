import type { QueuePost } from './queue';

/**
 * Shared failure accounting for every publish path (Instagram reels/images,
 * Telegram hand-offs, and the processing-reaper).
 *
 * Two failure classes:
 *  - Network/offline (fetch failed, DNS, refused, timeout): the machine can't
 *    reach R2/Meta/Telegram right now. This is Lars's work-network state, not
 *    a bad post — the post stays 'approved', attempts are NOT incremented,
 *    and the next autopublish tick retries. publishError gets an 'offline:'
 *    prefix the queue UI renders as "waiting to publish (offline)".
 *  - Real errors (Meta rejected the container, bad media URL, …): attempts
 *    increment; past MAX_PUBLISH_ATTEMPTS the post moves to 'failed' so it
 *    stops burning ticks and surfaces for a human look.
 *
 * Only ever called from an actual publish attempt — never from a migration or
 * sweep — so pre-existing 'approved' posts can't be mass-flagged.
 */

export const MAX_PUBLISH_ATTEMPTS = 5;

/** publishError prefix the UI uses to render the offline-waiting state. */
export const OFFLINE_ERROR_PREFIX = 'offline: ';

const NETWORK_ERROR_CODES: string[] = [
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
];

export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = (err as Error & { cause?: { code?: string } }).cause;
  if (cause?.code && NETWORK_ERROR_CODES.includes(cause.code)) return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    NETWORK_ERROR_CODES.some((c) => msg.includes(c.toLowerCase()))
  );
}

/**
 * Build the updatePost patch for a failed publish attempt. `resetStatus` is
 * where a non-terminal retry should land (usually 'approved'; the reaper also
 * clears metaContainerId via extraOnRetry).
 */
export function publishFailurePatch(
  post: QueuePost,
  err: unknown,
  opts: { extraOnRetry?: Partial<QueuePost> } = {},
): Partial<QueuePost> {
  const message = err instanceof Error ? err.message : String(err);
  const now = new Date().toISOString();

  if (isNetworkError(err)) {
    // Offline is a machine state, not a post failure: stay 'approved', don't
    // count the attempt, catch up on the next tick that has connectivity.
    return {
      publishError: `${OFFLINE_ERROR_PREFIX}${message}`,
      lastAttemptAt: now,
    };
  }

  const attempts = (post.publishAttempts ?? 0) + 1;
  if (attempts >= MAX_PUBLISH_ATTEMPTS) {
    return {
      status: 'failed',
      publishError: message,
      publishAttempts: attempts,
      lastAttemptAt: now,
    };
  }
  return {
    status: 'approved',
    publishError: message,
    publishAttempts: attempts,
    lastAttemptAt: now,
    ...(opts.extraOnRetry ?? {}),
  };
}
