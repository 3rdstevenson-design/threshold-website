/**
 * jobPersistence.ts — durable record of in-flight editor jobs, so a dashboard
 * restart can't silently strand them.
 *
 * jobRunner's registry and processQueue's waiters are in-memory: before this
 * existed, a restart mid-job left the project stuck on "Processing…" forever
 * (the run closure died with the process, and nothing recorded that). Now
 * every startJob() writes the slug here and every settle removes it; on the
 * next boot, sweepInterruptedJobs() marks whatever is left over as an error
 * on the project's durable status.json ("interrupted by restart"), which the
 * editor UI already surfaces as Failed-with-Retry. Retry re-runs the
 * pipeline — run closures can't be persisted, so resume = flag + one-click
 * re-run, never a silent stall.
 *
 * The registry lives next to the queue data (data/editor-jobs.json). Writes
 * are tiny and synchronous; per-process serialization comes from jobRunner
 * calling these on the event loop.
 */
import * as fs from 'fs';
import * as path from 'path';
import { writeStatus } from './status';

const JOBS_PATH = path.join(process.cwd(), 'data', 'editor-jobs.json');

type PersistedJobs = Record<string, { startedAt: string }>;

function readJobs(): PersistedJobs {
  try {
    if (!fs.existsSync(JOBS_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(JOBS_PATH, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeJobs(jobs: PersistedJobs): void {
  try {
    fs.mkdirSync(path.dirname(JOBS_PATH), { recursive: true });
    fs.writeFileSync(JOBS_PATH, JSON.stringify(jobs, null, 2));
  } catch {
    // Best-effort: a failed registry write must never fail the job itself.
  }
}

export function recordJobStart(slug: string): void {
  const jobs = readJobs();
  jobs[slug] = { startedAt: new Date().toISOString() };
  writeJobs(jobs);
}

export function recordJobEnd(slug: string): void {
  const jobs = readJobs();
  if (slug in jobs) {
    delete jobs[slug];
    writeJobs(jobs);
  }
}

// Once per process (pinned to globalThis so dev hot-reload doesn't re-run
// it). Called lazily from startJob() and listProjects() — the first editor
// touch after a restart runs the sweep before anything else can look stuck.
const globalForSweep = globalThis as unknown as {
  __thresholdEditorJobSweepDone?: boolean;
};

export function sweepInterruptedJobs(): void {
  if (globalForSweep.__thresholdEditorJobSweepDone) return;
  globalForSweep.__thresholdEditorJobSweepDone = true;

  const jobs = readJobs();
  const slugs = Object.keys(jobs);
  if (slugs.length === 0) return;

  for (const slug of slugs) {
    try {
      writeStatus(slug, {
        error:
          'Interrupted by a dashboard restart before it finished — press Retry to re-run.',
      });
      console.error(`editor jobs sweep: marked '${slug}' as interrupted (started ${jobs[slug].startedAt})`);
    } catch (err) {
      console.error(`editor jobs sweep: could not mark '${slug}': ${err instanceof Error ? err.message : err}`);
    }
  }
  writeJobs({});
}
