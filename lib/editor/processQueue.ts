/**
 * processQueue.ts — a singleton FIFO serial queue for heavy pipeline jobs.
 *
 * Why this exists: Whisper, ffmpeg, and Remotion rendering all saturate
 * the GPU and CPU. Running two pipelines in parallel doesn't halve the
 * per-job runtime — it doubles each one while fighting over Metal/CPU
 * cores and potentially OOMing on long sources. Far better to upload
 * all videos at once, then process them one at a time.
 *
 * Usage pattern:
 *
 *     await processQueue.run(slug, async (report) => {
 *       // your heavy pipeline code here
 *       // call report() whenever queue position changes, if desired
 *     });
 *
 * The `report` callback is invoked immediately with `position: 0` when
 * the job actually starts, so callers can emit an SSE stage transition
 * from 'queued' to 'preparing'. While queued, the caller receives
 * periodic position updates until the mutex is free.
 *
 * Concurrency = 1 globally. Jobs are dequeued in FIFO order. The queue
 * survives across requests because it's a module-level singleton —
 * every /process and /extract-clips invocation shares the same instance.
 *
 * If the caller's AbortSignal fires while queued, the job is removed
 * from the queue without ever running.
 */

export type PositionReport = {
  /** 0 when running; 1 = next up; N = (N-1) ahead. */
  position: number;
  /** Total items ahead (same as `position` while queued, 0 while running). */
  ahead: number;
};

type Waiter = {
  slug: string;
  resolve: () => void;
  reject: (e: Error) => void;
  report: (p: PositionReport) => void;
  signal?: AbortSignal;
  /** Cached cleanup so abort can remove this waiter from the queue. */
  cleanup: () => void;
};

class ProcessQueue {
  private running: Waiter | null = null;
  private queue: Waiter[] = [];

  async run<T>(
    slug: string,
    fn: (report: (p: PositionReport) => void) => Promise<T>,
    options: {
      /** Called with position updates while queued. */
      onPosition?: (p: PositionReport) => void;
      /** Aborts the wait. Has no effect once the job is running. */
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const report = options.onPosition ?? (() => {});
    await this.acquire(slug, report, options.signal);
    try {
      // Tell the caller they're now running (position 0).
      report({ position: 0, ahead: 0 });
      return await fn(report);
    } finally {
      this.release();
    }
  }

  /**
   * Read-only status snapshot. Useful for the /queue-status route if
   * we ever expose queue state to the client for debugging.
   */
  status(): {
    runningSlug: string | null;
    waiting: string[];
  } {
    return {
      runningSlug: this.running?.slug ?? null,
      waiting: this.queue.map((w) => w.slug),
    };
  }

  private acquire(
    slug: string,
    report: (p: PositionReport) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        slug,
        resolve,
        reject,
        report,
        signal,
        cleanup: () => {},
      };
      waiter.cleanup = () => {
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        // Remove from queue if still waiting; no-op if already running.
        const idx = this.queue.indexOf(waiter);
        if (idx >= 0) {
          this.queue.splice(idx, 1);
          waiter.cleanup();
          reject(new Error('aborted'));
          this.emitPositions();
        }
      };
      if (signal) {
        if (signal.aborted) {
          waiter.cleanup();
          reject(new Error('aborted'));
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      if (!this.running) {
        this.running = waiter;
        resolve();
        return;
      }
      this.queue.push(waiter);
      this.emitPositions();
    });
  }

  private release(): void {
    if (this.running) this.running.cleanup();
    this.running = null;
    const next = this.queue.shift();
    if (next) {
      this.running = next;
      next.resolve();
      this.emitPositions();
    }
  }

  /**
   * Push a fresh position to every queued waiter so the client-visible
   * badges stay in sync as entries are added/removed/promoted.
   */
  private emitPositions(): void {
    for (let i = 0; i < this.queue.length; i++) {
      const w = this.queue[i];
      try {
        w.report({ position: i + 1, ahead: i + 1 });
      } catch {
        // caller's SSE stream may have closed — ignore
      }
    }
  }
}

// Pin the instance to globalThis. In Next.js dev, per-route module
// evaluation + hot-reload can otherwise create MULTIPLE ProcessQueue
// instances — jobs on different instances wouldn't see each other and
// would run in parallel, saturating the machine. One process = one queue.
const globalForQueue = globalThis as unknown as {
  __thresholdProcessQueue?: ProcessQueue;
};
export const processQueue =
  globalForQueue.__thresholdProcessQueue ??
  (globalForQueue.__thresholdProcessQueue = new ProcessQueue());
