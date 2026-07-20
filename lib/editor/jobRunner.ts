/**
 * jobRunner.ts — runs a project's heavy pipeline DECOUPLED from the HTTP
 * request that triggered it.
 *
 * Why this exists: the long-form / talking-head pipelines used to run
 * inside the /process SSE request with `req.signal` threaded into the
 * ffmpeg/whisper spawns. So the moment the browser tab closed (or the user
 * navigated away), the signal fired, killOnAbort SIGTERM'd the child, and
 * the job died half-done — leaving the project stuck looking like
 * "Processing…" forever (the 'ingest exited 143' / 'aborted' failures).
 *
 * Now a job runs on the server event loop with its OWN AbortController,
 * tracked in a module-level registry. The /process request merely OBSERVES
 * the job and streams its events to the client; a client disconnect only
 * unsubscribes the observer — the job runs to completion and writes its
 * files + status. The dashboard is a long-lived launchd Node process, so a
 * detached promise survives well past the response close.
 *
 * Starting a job for a slug that's already running is a no-op that returns
 * the existing job (idempotent), so a double-click / upload auto-trigger +
 * manual retry can't spawn two pipelines for the same source.
 *
 * If the dashboard process itself restarts mid-job, the in-memory job is
 * lost (analysis.json may be partial/absent) — but jobPersistence records
 * every in-flight slug on disk, and the next boot's sweep marks those
 * projects as interrupted-with-Retry instead of leaving them stuck on
 * "Processing…". Retry re-runs the pipeline; run closures can't be
 * persisted, so full crash-resume stays out of scope by design.
 */
import { processQueue, type PositionReport } from './processQueue';
import {
  recordJobStart,
  recordJobEnd,
  sweepInterruptedJobs,
} from './jobPersistence';

export type JobEvent = { event: string; data: unknown };
export type Emit = (event: string, data: unknown) => void;
type Subscriber = (e: JobEvent) => void;

export type Job = {
  slug: string;
  /** Job-owned — NEVER the request's. Only an explicit cancel aborts it. */
  controller: AbortController;
  /** Recent events, replayed to late/reconnecting observers. */
  buffer: JobEvent[];
  subscribers: Set<Subscriber>;
  settled: boolean;
};

const MAX_BUFFER = 600;
const SETTLED_TTL_MS = 30_000;

// Pin to globalThis so Next.js dev hot-reload + per-route module eval don't
// fork the registry (same reasoning as processQueue's singleton).
const globalForJobs = globalThis as unknown as {
  __thresholdEditorJobs?: Map<string, Job>;
};
const jobs =
  globalForJobs.__thresholdEditorJobs ??
  (globalForJobs.__thresholdEditorJobs = new Map<string, Job>());

export function isJobActive(slug: string): boolean {
  const j = jobs.get(slug);
  return !!j && !j.settled;
}

/**
 * Start (or attach to) the pipeline job for `slug`. `run` receives an
 * `emit` to push SSE-style events and a job-owned AbortSignal it should
 * thread into ffmpeg/whisper spawns. `run` is responsible for emitting its
 * own terminal 'done'/'error' event (matching the prior route behavior).
 * Fire-and-forget — the job is NOT awaited here.
 */
export function startJob(
  slug: string,
  run: (emit: Emit, signal: AbortSignal) => Promise<void>,
): Job {
  // A leftover registry entry from a previous process must be swept (flagged
  // as interrupted) before this slug records a fresh start, or the sweep
  // could later mis-flag the job we're about to run.
  sweepInterruptedJobs();

  const existing = jobs.get(slug);
  if (existing && !existing.settled) return existing;

  const controller = new AbortController();
  const job: Job = {
    slug,
    controller,
    buffer: [],
    subscribers: new Set(),
    settled: false,
  };
  jobs.set(slug, job);
  // Durable in-flight marker — removed on settle. Covers queued-but-not-yet-
  // running jobs too (they're just as lost on a restart as running ones).
  recordJobStart(slug);

  const emit: Emit = (event, data) => {
    const e: JobEvent = { event, data };
    job.buffer.push(e);
    if (job.buffer.length > MAX_BUFFER) job.buffer.shift();
    job.subscribers.forEach((sub) => {
      try {
        sub(e);
      } catch {
        /* a closed SSE stream — ignore */
      }
    });
  };

  const settle = () => {
    if (job.settled) return;
    job.settled = true;
    recordJobEnd(slug);
    // Keep the settled job (and its buffer) briefly so a just-too-late
    // observer can still replay the terminal events, then drop it.
    const t = setTimeout(() => {
      if (jobs.get(slug) === job) jobs.delete(slug);
    }, SETTLED_TTL_MS);
    if (typeof t.unref === 'function') t.unref();
  };

  // Fire-and-forget. The serial processQueue still throttles GPU/CPU; the
  // job's OWN signal (never the request's) governs cancellation, so a
  // browser disconnect can't kill it.
  void processQueue
    .run(slug, async () => { await run(emit, controller.signal); }, {
      signal: controller.signal,
      onPosition: (p: PositionReport) => {
        if (p.position > 0) {
          emit('stage', { name: 'queued' });
          emit('queue', { position: p.position, ahead: p.ahead });
        }
      },
    })
    .catch((err) => {
      // run() emits its own 'error'; this only guards an unexpected throw
      // from the queue wrapper itself so observers still get a terminal
      // event and their streams close.
      emit('error', { msg: err instanceof Error ? err.message : String(err) });
    })
    .finally(settle);

  return job;
}

/**
 * Observe a job: replays buffered events (so a late / reconnecting client
 * catches up), then streams new ones. Returns an unsubscribe fn. If the job
 * has already settled, only the replay happens.
 */
export function subscribe(job: Job, sub: Subscriber): () => void {
  for (const e of job.buffer) {
    try {
      sub(e);
    } catch {
      /* ignore */
    }
  }
  if (job.settled) return () => {};
  job.subscribers.add(sub);
  return () => {
    job.subscribers.delete(sub);
  };
}
