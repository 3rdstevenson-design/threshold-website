import { describe, it, expect, vi } from 'vitest';

// Keep the durable job registry (data/editor-jobs.json in the REAL repo) out
// of unit tests — a stale entry there would flag real projects as interrupted.
vi.mock('../jobPersistence', () => ({
  recordJobStart: () => {},
  recordJobEnd: () => {},
  sweepInterruptedJobs: () => {},
}));

import { startJob, subscribe, getJobSnapshot, cancelJob, getJob, activeJobs } from '../jobRunner';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('jobRunner snapshots + cancel', () => {
  it('tracks lastStage/progress and replays buffered events to a late subscriber', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const job = startJob('snap-test', async (emit, signal) => {
      emit('stage', { name: 'transcribing', expectedMs: 1000 });
      emit('progress', { stage: 'transcribing', pct: 40 });
      await gate;
      if (!signal.aborted) emit('done', { ok: true });
    });
    await wait(10);
    const snap = getJobSnapshot('snap-test');
    expect(snap).toMatchObject({ active: true, stage: 'transcribing', progressPct: 40, queuePosition: 0 });
    expect(Object.keys(activeJobs())).toContain('snap-test');

    const seen: string[] = [];
    subscribe(job, (e) => seen.push(e.event));
    expect(seen).toEqual(['stage', 'progress']);

    release();
    await wait(20);
    expect(getJobSnapshot('snap-test')).toBeNull();
    expect(seen).toEqual(['stage', 'progress', 'done']);
    expect(getJob('snap-test')?.settled).toBe(true);
  });

  it('cancelJob aborts a running job and reports false when nothing runs', async () => {
    let aborted = false;
    startJob('cancel-test', async (emit, signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true });
      });
      emit('error', { msg: 'Canceled' });
    });
    await wait(10);
    expect(cancelJob('cancel-test')).toBe(true);
    await wait(20);
    expect(aborted).toBe(true);
    expect(cancelJob('cancel-test')).toBe(false);
    expect(cancelJob('never-started')).toBe(false);
  });
});
