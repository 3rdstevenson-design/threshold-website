'use client';

/**
 * uploadManager.ts — module-level upload engine for the editor.
 *
 * Why this exists: uploads used to live inside ProjectList as fetch()+
 * FormData tied to the component's lifetime — no byte progress (only a
 * file-count bar, so a multi-GB upload looked frozen), the first failure
 * killed the whole batch, and navigating anywhere in the dashboard
 * unmounted the component and ABORTED the transfer.
 *
 * Now the queue, the XHRs, and the progress state all live at module level:
 *  - XHR upload.onprogress → real byte %, MB/s (EMA-smoothed) and ETA.
 *  - Stall detection: no progress for STALL_MS flips the job to 'stalled'
 *    (the transfer keeps trying; it recovers or errors, never lies).
 *  - Per-file isolation: a failed file marks itself 'error' with a Retry,
 *    the rest of the batch keeps going.
 *  - In-dashboard navigation can't kill a transfer (nothing aborts on
 *    unmount), and a beforeunload warning guards real tab-closes.
 *
 * React reads it through useUploads() (useSyncExternalStore).
 */

import { useSyncExternalStore } from 'react';
import { dashKey } from './useEditor';

export type UploadStatus = 'queued' | 'uploading' | 'stalled' | 'done' | 'error' | 'canceled';

export type UploadJob = {
  id: string;
  name: string;
  /** Total bytes. */
  size: number;
  /** Bytes on the wire so far. */
  sent: number;
  /** 0–100. */
  pct: number;
  /** Estimated seconds remaining, null until the rate settles. */
  etaSec: number | null;
  status: UploadStatus;
  error?: string;
};

type InternalJob = UploadJob & {
  file: File;
  category: string;
  xhr?: XMLHttpRequest;
  lastProgressAt: number;
  /** Bytes/sec, exponentially smoothed. */
  rate: number;
};

const STALL_MS = 20_000;
const STALL_POLL_MS = 5_000;
const DONE_LINGER_MS = 4_000;

const jobs = new Map<string, InternalJob>();
const listeners = new Set<() => void>();
let snapshot: UploadJob[] = [];
let pumping = false;
let stallTimer: ReturnType<typeof setInterval> | null = null;
let nextId = 1;

let onUploadedCb: ((slug: string, category: string) => void) | null = null;
// Completions that finished while no editor page was mounted — delivered on
// the next registerOnUploaded so auto-processing still kicks off.
const pendingUploaded: { slug: string; category: string }[] = [];

function toPublic(j: InternalJob): UploadJob {
  const { file: _f, category: _c, xhr: _x, lastProgressAt: _l, rate: _r, ...pub } = j;
  return pub;
}

function hasActive(): boolean {
  for (const j of Array.from(jobs.values())) {
    if (j.status === 'queued' || j.status === 'uploading' || j.status === 'stalled') return true;
  }
  return false;
}

function beforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  // Chrome requires returnValue to be set for the dialog to show.
  e.returnValue = '';
}

function emit() {
  snapshot = Array.from(jobs.values()).map(toPublic);
  if (typeof window !== 'undefined') {
    if (hasActive()) {
      window.addEventListener('beforeunload', beforeUnload);
      if (!stallTimer) stallTimer = setInterval(checkStalls, STALL_POLL_MS);
    } else {
      window.removeEventListener('beforeunload', beforeUnload);
      if (stallTimer) { clearInterval(stallTimer); stallTimer = null; }
    }
  }
  listeners.forEach((l) => { try { l(); } catch {} });
}

function checkStalls() {
  const now = Date.now();
  let changed = false;
  for (const j of Array.from(jobs.values())) {
    if (j.status === 'uploading' && now - j.lastProgressAt > STALL_MS) {
      j.status = 'stalled';
      changed = true;
    }
  }
  if (changed) emit();
}

function deliverUploaded(slug: string, category: string) {
  if (onUploadedCb) {
    try { onUploadedCb(slug, category); } catch {}
  } else {
    pendingUploaded.push({ slug, category });
  }
}

function uploadJob(job: InternalJob): Promise<void> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    job.xhr = xhr;
    job.status = 'uploading';
    job.lastProgressAt = Date.now();
    emit();

    let lastTime = Date.now();
    let lastSent = 0;

    xhr.upload.onprogress = (e) => {
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      if (dt > 0.2) {
        const instRate = (e.loaded - lastSent) / dt;
        job.rate = job.rate === 0 ? instRate : job.rate * 0.7 + instRate * 0.3;
        lastTime = now;
        lastSent = e.loaded;
      }
      job.sent = e.loaded;
      if (e.lengthComputable && e.total > 0) job.size = e.total;
      job.pct = job.size > 0 ? Math.min(100, Math.round((job.sent / job.size) * 100)) : 0;
      job.etaSec = job.rate > 1 ? Math.max(0, Math.round((job.size - job.sent) / job.rate)) : null;
      job.lastProgressAt = now;
      if (job.status === 'stalled') job.status = 'uploading';
      emit();
    };

    const finish = () => { job.xhr = undefined; emit(); resolve(); };

    xhr.onload = () => {
      let data: { slug?: string; category?: string; error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && data.slug) {
        job.status = 'done';
        job.pct = 100;
        job.sent = job.size;
        job.etaSec = 0;
        deliverUploaded(data.slug, data.category ?? job.category);
        // Done rows linger briefly, then clear themselves.
        setTimeout(() => { if (jobs.get(job.id)?.status === 'done') { jobs.delete(job.id); emit(); } }, DONE_LINGER_MS);
      } else {
        job.status = 'error';
        job.error = data.error ?? `upload failed (HTTP ${xhr.status})`;
      }
      finish();
    };
    xhr.onerror = () => {
      job.status = 'error';
      job.error = 'network error — check the connection and retry';
      finish();
    };
    xhr.onabort = () => {
      if (job.status !== 'canceled') job.status = 'canceled';
      finish();
    };

    xhr.open('POST', '/api/editor/upload');
    xhr.setRequestHeader('x-dashboard-key', dashKey());
    const fd = new FormData();
    fd.append('file', job.file);
    fd.append('category', job.category);
    xhr.send(fd);
  });
}

// Sequential pump: one file on the wire at a time (parallel uploads just
// fight for the same uplink), but the queue keeps draining past failures.
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const next = Array.from(jobs.values()).find((j) => j.status === 'queued');
      if (!next) break;
      await uploadJob(next);
    }
  } finally {
    pumping = false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function enqueueUploads(files: File[], category: string): void {
  const vids = files.filter((f) => !f.type || f.type.startsWith('video/'));
  for (const file of vids) {
    const id = `u${nextId++}`;
    jobs.set(id, {
      id,
      name: file.name,
      size: file.size,
      sent: 0,
      pct: 0,
      etaSec: null,
      status: 'queued',
      file,
      category,
      lastProgressAt: Date.now(),
      rate: 0,
    });
  }
  emit();
  void pump();
}

export function retryUpload(id: string): void {
  const job = jobs.get(id);
  if (!job || (job.status !== 'error' && job.status !== 'canceled')) return;
  job.status = 'queued';
  job.sent = 0;
  job.pct = 0;
  job.rate = 0;
  job.etaSec = null;
  job.error = undefined;
  emit();
  void pump();
}

export function cancelUpload(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  if (job.status === 'uploading' || job.status === 'stalled') {
    job.status = 'canceled';
    job.xhr?.abort();
  } else if (job.status === 'queued') {
    job.status = 'canceled';
  }
  emit();
}

export function dismissUpload(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  if (job.status === 'uploading' || job.status === 'stalled') return;
  jobs.delete(id);
  emit();
}

export function cancelAllUploads(): void {
  for (const j of Array.from(jobs.values())) {
    if (j.status === 'queued') j.status = 'canceled';
    if (j.status === 'uploading' || j.status === 'stalled') {
      j.status = 'canceled';
      j.xhr?.abort();
    }
  }
  emit();
}

/** The editor page registers its auto-process kick here; completions that
 *  landed while no page was mounted are delivered immediately. */
export function registerOnUploaded(cb: (slug: string, category: string) => void): void {
  onUploadedCb = cb;
  while (pendingUploaded.length > 0) {
    const p = pendingUploaded.shift()!;
    try { cb(p.slug, p.category); } catch {}
  }
}

const EMPTY: UploadJob[] = [];

export function useUploads(): UploadJob[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => EMPTY,
  );
}
