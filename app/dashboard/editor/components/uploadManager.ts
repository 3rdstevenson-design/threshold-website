'use client';

/**
 * uploadManager.ts — module-level upload engine for the editor.
 *
 * Why this exists: uploads used to live inside ProjectList as fetch()+
 * FormData tied to the component's lifetime — no byte progress, the first
 * failure killed the whole batch, and navigating anywhere in the dashboard
 * unmounted the component and ABORTED the transfer.
 *
 * v2 (chunked + resumable): each file is sent as 8 MiB parts through
 *   POST /api/editor/upload/init → PUT …/[id]/chunk?index=N → POST …/[id]/finish
 *
 *  - XHR upload.onprogress per chunk → real byte %, MB/s (EMA) and ETA.
 *  - A failed chunk retries 3× with backoff before the file flips to 'error';
 *    Retry (or re-picking the same file after a reload) resumes from the
 *    parts already on the server — `init` is idempotent on name+size.
 *  - Manifests for unfinished uploads persist in localStorage so a reload
 *    shows "Resume: IMG_6521.MOV (62%)" and the user only has to re-pick
 *    the file (browsers can't hand a File back across reloads).
 *  - Mobile Safari suspends XHRs when the app is backgrounded; on
 *    visibilitychange → visible the pump resumes from the last good part.
 *  - Stall detection: no progress for STALL_MS flips the job to 'stalled'.
 *  - In-dashboard navigation can't kill a transfer; `pagehide` (iOS) /
 *    `beforeunload` guard real tab closes.
 *  - Non-video files are surfaced as error rows instead of silently dropped.
 *
 * React reads it through useUploads() (useSyncExternalStore).
 */

import { useSyncExternalStore } from 'react';
import { dashKey } from './useEditor';

export type UploadStatus =
  | 'queued'
  | 'uploading'
  | 'stalled'
  | 'finishing'
  | 'done'
  | 'error'
  | 'canceled'
  /** Manifest restored from a previous session; needs the file re-picked. */
  | 'resumable';

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
  category: string | null;
  error?: string;
};

type InternalJob = UploadJob & {
  file: File | null;
  fingerprint: string;
  uploadId?: string;
  chunkSize?: number;
  received: Set<number>;
  xhr?: XMLHttpRequest;
  lastProgressAt: number;
  /** Bytes/sec, exponentially smoothed. */
  rate: number;
  attempt: number;
};

const STALL_MS = 20_000;
const STALL_POLL_MS = 5_000;
const DONE_LINGER_MS = 4_000;
const CHUNK_RETRIES = 3;
const STORAGE_KEY = 'editor_uploads_v1';

const jobs = new Map<string, InternalJob>();
const listeners = new Set<() => void>();
let snapshot: UploadJob[] = [];
let pumping = false;
let stallTimer: ReturnType<typeof setInterval> | null = null;
let nextId = 1;
let restored = false;

let onUploadedCb: ((slug: string, category: string) => void) | null = null;
// Completions that finished while no editor page was mounted — delivered on
// the next registerOnUploaded so auto-processing still kicks off.
const pendingUploaded: { slug: string; category: string }[] = [];

function fingerprintOf(file: File): string {
  // name + size, NOT lastModified: iOS Photos re-exports on every pick and
  // stamps a new mtime, which would defeat resume.
  return `${file.name}:${file.size}`;
}

function toPublic(j: InternalJob): UploadJob {
  const {
    file: _f, fingerprint: _fp, uploadId: _u, chunkSize: _c, received: _r,
    xhr: _x, lastProgressAt: _l, rate: _rate, attempt: _a, ...pub
  } = j;
  return pub;
}

function isActive(j: InternalJob): boolean {
  return j.status === 'queued' || j.status === 'uploading' || j.status === 'stalled' || j.status === 'finishing';
}

function hasActive(): boolean {
  for (const j of Array.from(jobs.values())) if (isActive(j)) return true;
  return false;
}

function beforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  e.returnValue = '';
}

// ── localStorage manifests ───────────────────────────────────────────────────

type StoredManifest = { fingerprint: string; uploadId?: string; name: string; size: number; category: string | null };

function readStored(): StoredManifest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? (JSON.parse(raw) as StoredManifest[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeStored(list: StoredManifest[]) {
  try {
    if (list.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — resume just won't survive a reload */
  }
}

function rememberJob(j: InternalJob) {
  const list = readStored().filter((m) => m.fingerprint !== j.fingerprint);
  list.push({ fingerprint: j.fingerprint, uploadId: j.uploadId, name: j.name, size: j.size, category: j.category });
  writeStored(list);
}

function forgetJob(j: InternalJob) {
  writeStored(readStored().filter((m) => m.fingerprint !== j.fingerprint));
}

/** On first use in a session, surface unfinished uploads as 'resumable' rows. */
function restoreFromStorage() {
  if (restored || typeof window === 'undefined') return;
  restored = true;
  for (const m of readStored()) {
    if (Array.from(jobs.values()).some((j) => j.fingerprint === m.fingerprint)) continue;
    const id = `u${nextId++}`;
    jobs.set(id, {
      id,
      name: m.name,
      size: m.size,
      sent: 0,
      pct: 0,
      etaSec: null,
      status: 'resumable',
      category: m.category,
      file: null,
      fingerprint: m.fingerprint,
      uploadId: m.uploadId,
      received: new Set(),
      lastProgressAt: 0,
      rate: 0,
      attempt: 0,
    });
  }
}

// ── emit / stall ─────────────────────────────────────────────────────────────

function emit() {
  snapshot = Array.from(jobs.values()).map(toPublic);
  if (typeof window !== 'undefined') {
    if (hasActive()) {
      window.addEventListener('beforeunload', beforeUnload);
      window.addEventListener('pagehide', onPageHide);
      if (!stallTimer) stallTimer = setInterval(checkStalls, STALL_POLL_MS);
    } else {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      if (stallTimer) { clearInterval(stallTimer); stallTimer = null; }
    }
  }
  listeners.forEach((l) => { try { l(); } catch {} });
}

function onPageHide() {
  // iOS Safari: the page is going away (or being frozen). Persisted manifests
  // already cover resume; nothing else to do but keep the entry.
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

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function apiJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'x-dashboard-key': dashKey(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = (data as { error?: string } | null)?.error;
    throw new Error(err ?? `${method} ${url} failed (HTTP ${res.status})`);
  }
  return data as T;
}

function bytesBefore(j: InternalJob): number {
  const cs = j.chunkSize ?? 0;
  let total = 0;
  for (const idx of Array.from(j.received)) {
    total += Math.min(cs, j.size - idx * cs);
  }
  return total;
}

/** PUT one chunk with XHR so we get upload progress. Resolves on 2xx. */
function putChunk(j: InternalJob, index: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cs = j.chunkSize!;
    const start = index * cs;
    const end = Math.min(j.size, start + cs);
    const blob = j.file!.slice(start, end);
    const base = bytesBefore(j);

    const xhr = new XMLHttpRequest();
    j.xhr = xhr;
    let lastTime = Date.now();
    let lastLoaded = 0;

    xhr.upload.onprogress = (e) => {
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      if (dt > 0.2) {
        const instRate = (e.loaded - lastLoaded) / dt;
        j.rate = j.rate === 0 ? instRate : j.rate * 0.7 + instRate * 0.3;
        lastTime = now;
        lastLoaded = e.loaded;
      }
      j.sent = base + e.loaded;
      j.pct = j.size > 0 ? Math.min(100, Math.round((j.sent / j.size) * 100)) : 0;
      j.etaSec = j.rate > 1 ? Math.max(0, Math.round((j.size - j.sent) / j.rate)) : null;
      j.lastProgressAt = now;
      if (j.status === 'stalled') j.status = 'uploading';
      emit();
    };
    xhr.onload = () => {
      j.xhr = undefined;
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let msg = `chunk ${index} failed (HTTP ${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText).error ?? msg; } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => { j.xhr = undefined; reject(new Error('network error')); };
    xhr.onabort = () => { j.xhr = undefined; reject(new Error('aborted')); };

    xhr.open('PUT', `/api/editor/upload/${j.uploadId}/chunk?index=${index}`);
    xhr.setRequestHeader('x-dashboard-key', dashKey());
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.send(blob);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Status may be flipped to 'canceled' from outside while we await. */
const canceled = (j: InternalJob): boolean => (j.status as UploadStatus) === 'canceled';

async function uploadJob(j: InternalJob): Promise<void> {
  if (!j.file) { j.status = 'resumable'; emit(); return; }
  j.status = 'uploading';
  j.lastProgressAt = Date.now();
  j.error = undefined;
  emit();

  try {
    // 1. init (idempotent; returns parts already on the server)
    const init = await apiJson<{ uploadId: string; chunkSize: number; partCount: number; received: number[] }>(
      'POST',
      '/api/editor/upload/init',
      { name: j.name, size: j.size, category: j.category, fingerprint: j.fingerprint },
    );
    j.uploadId = init.uploadId;
    j.chunkSize = init.chunkSize;
    j.received = new Set(init.received);
    rememberJob(j);
    j.sent = bytesBefore(j);
    j.pct = j.size > 0 ? Math.round((j.sent / j.size) * 100) : 0;
    emit();

    // 2. parts, sequentially, each with its own retry budget
    for (let index = 0; index < init.partCount; index++) {
      if (canceled(j)) return;
      if (j.received.has(index)) continue;
      let attempt = 0;
      for (;;) {
        try {
          await putChunk(j, index);
          j.received.add(index);
          j.sent = bytesBefore(j);
          j.pct = Math.min(100, Math.round((j.sent / j.size) * 100));
          emit();
          break;
        } catch (e) {
          if (canceled(j)) return;
          const msg = e instanceof Error ? e.message : String(e);
          attempt++;
          if (attempt > CHUNK_RETRIES || document.visibilityState === 'hidden') {
            throw new Error(`${msg} — ${j.pct}% uploaded, retry to resume`);
          }
          await sleep(1000 * 2 ** (attempt - 1));
          if (canceled(j)) return;
        }
      }
    }

    // 3. finish
    j.status = 'finishing';
    j.etaSec = 0;
    emit();
    const fin = await apiJson<{ slug: string; category?: string }>(
      'POST',
      `/api/editor/upload/${j.uploadId}/finish`,
    );
    forgetJob(j);
    j.status = 'done';
    j.pct = 100;
    j.sent = j.size;
    deliverUploaded(fin.slug, fin.category ?? j.category ?? 'talking-head');
    setTimeout(() => { if (jobs.get(j.id)?.status === 'done') { jobs.delete(j.id); emit(); } }, DONE_LINGER_MS);
  } catch (e) {
    if (canceled(j)) return;
    j.status = 'error';
    j.error = e instanceof Error ? e.message : String(e);
  } finally {
    j.xhr = undefined;
    emit();
  }
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

if (typeof document !== 'undefined') {
  // Backgrounded mobile Safari suspends in-flight XHRs; when we come back,
  // anything left stalled/errored mid-transfer is requeued from its last
  // good part.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    let changed = false;
    for (const j of Array.from(jobs.values())) {
      if ((j.status === 'stalled' || j.status === 'error') && j.file && j.uploadId) {
        j.xhr?.abort();
        j.status = 'queued';
        j.error = undefined;
        changed = true;
      }
    }
    if (changed) { emit(); void pump(); }
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Queue files. `category` may be null to let the server pick by duration
 * (≥12 min → long-form). Non-video files are added as error rows so the
 * user sees why nothing happened.
 */
export function enqueueUploads(files: File[], category: string | null): void {
  restoreFromStorage();
  for (const file of files) {
    const fp = fingerprintOf(file);
    // Re-picking a file that has a resumable row: attach the File and resume.
    const existing = Array.from(jobs.values()).find((j) => j.fingerprint === fp && (j.status === 'resumable' || j.status === 'error'));
    if (existing) {
      existing.file = file;
      existing.category = category ?? existing.category;
      existing.status = 'queued';
      existing.error = undefined;
      continue;
    }
    const id = `u${nextId++}`;
    const isVideo = !file.type || file.type.startsWith('video/') || /\.(mov|mp4|m4v)$/i.test(file.name);
    jobs.set(id, {
      id,
      name: file.name,
      size: file.size,
      sent: 0,
      pct: 0,
      etaSec: null,
      status: isVideo ? 'queued' : 'error',
      error: isVideo ? undefined : 'not a video file (.mov, .mp4, .m4v)',
      category,
      file,
      fingerprint: fp,
      received: new Set(),
      lastProgressAt: Date.now(),
      rate: 0,
      attempt: 0,
    });
  }
  emit();
  void pump();
}

export function retryUpload(id: string): void {
  const job = jobs.get(id);
  if (!job || (job.status !== 'error' && job.status !== 'canceled' && job.status !== 'stalled')) return;
  if (!job.file) { job.status = 'resumable'; emit(); return; }
  job.xhr?.abort();
  job.status = 'queued';
  job.rate = 0;
  job.etaSec = null;
  job.error = undefined;
  emit();
  void pump();
}

export function cancelUpload(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  if (job.status === 'uploading' || job.status === 'stalled' || job.status === 'finishing') {
    job.status = 'canceled';
    job.xhr?.abort();
  } else if (job.status === 'queued' || job.status === 'resumable') {
    job.status = 'canceled';
  }
  if (job.uploadId) {
    void fetch(`/api/editor/upload/${job.uploadId}`, { method: 'DELETE', headers: { 'x-dashboard-key': dashKey() } }).catch(() => {});
  }
  forgetJob(job);
  emit();
}

export function dismissUpload(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  if (isActive(job)) return;
  if (job.status === 'resumable') forgetJob(job);
  jobs.delete(id);
  emit();
}

export function cancelAllUploads(): void {
  for (const j of Array.from(jobs.values())) {
    if (j.status === 'queued') j.status = 'canceled';
    if (j.status === 'uploading' || j.status === 'stalled' || j.status === 'finishing') {
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
      // Subscribe runs in the effect phase, so restoring resumable rows here
      // (and emitting) is safe — doing it during render would set state on
      // other subscribers mid-render.
      const before = jobs.size;
      restoreFromStorage();
      if (jobs.size !== before) queueMicrotask(emit);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => EMPTY,
  );
}
