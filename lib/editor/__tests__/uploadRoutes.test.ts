/**
 * Exercises the chunked upload route handlers end to end without a server:
 * init → chunk ×N (one truncated, one re-sent) → finish → project registered.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';

// vi.mock factories are hoisted, so the temp root has to come from vi.hoisted.
const { tmp, UPLOADS_ROOT, TAKES_ROOT, probe } = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-routes-'));
  return {
    tmp,
    UPLOADS_ROOT: path.join(tmp, 'uploads'),
    TAKES_ROOT: path.join(tmp, 'takes'),
    probe: { durationSec: 42, codec: 'h264' },
  };
});

vi.mock('@/lib/editor/paths', () => ({
  UPLOADS_ROOT,
  TAKES_ROOT,
  VIDEO_PROJECT_ROOT: tmp,
  DRAFTS_DIR: tmp + '/drafts',
  VIDEO_OUT_DIR: tmp + '/final',
  checkAuth: () => null,
  validateSlug: (s: string) => /^[a-z0-9][a-z0-9-]*[a-z0-9]$/i.test(s),
}));
vi.mock('@/lib/editor/ffmpeg', () => ({
  probeDurationSec: async () => probe.durationSec,
  probeVideoCodec: async () => probe.codec,
  extractThumb: async () => {},
}));

import { POST as init } from '@/app/api/editor/upload/init/route';
import { PUT as chunk } from '@/app/api/editor/upload/[id]/chunk/route';
import { POST as finish } from '@/app/api/editor/upload/[id]/finish/route';
import { DELETE as cancel } from '@/app/api/editor/upload/[id]/route';
import { readProject } from '@/lib/editor/status';

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(`http://x${url}`, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

beforeAll(() => { fs.mkdirSync(TAKES_ROOT, { recursive: true }); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('chunked upload routes', () => {
  it('init → chunks (with a truncated retry) → finish registers a project', async () => {
    const size = 8 * 1024 * 1024 * 2 + 12345; // 3 parts: 8MiB, 8MiB, 12345B
    const file = Buffer.alloc(size);
    for (let i = 0; i < size; i += 4096) file[i] = i % 251;

    const r1 = await init(json('/api/editor/upload/init', 'POST', { name: 'IMG_9.MOV', size, category: 'talking-head', fingerprint: `IMG_9.MOV:${size}` }));
    const j1 = await r1.json();
    expect(r1.status).toBe(200);
    expect(j1.partCount).toBe(3);
    expect(j1.received).toEqual([]);
    const id: string = j1.uploadId;
    const cs: number = j1.chunkSize;

    const put = (index: number, bytes: Buffer) =>
      chunk(new NextRequest(`http://x/api/editor/upload/${id}/chunk?index=${index}`, { method: 'PUT', body: new Uint8Array(bytes), headers: { 'content-type': 'application/octet-stream' } }), { params: { id } });

    // part 0 ok, part 1 truncated (rejected), part 2 ok
    expect((await put(0, file.subarray(0, cs))).status).toBe(200);
    const bad = await put(1, file.subarray(cs, cs + 100));
    expect(bad.status).toBe(400);
    expect((await put(2, file.subarray(2 * cs))).status).toBe(200);

    // resume: init again reports parts 0 and 2 only
    const r2 = await init(json('/api/editor/upload/init', 'POST', { name: 'IMG_9.MOV', size, category: 'talking-head', fingerprint: `IMG_9.MOV:${size}` }));
    expect((await r2.json()).received).toEqual([0, 2]);

    // finish before part 1 → 409
    const early = await finish(new NextRequest(`http://x/api/editor/upload/${id}/finish`, { method: 'POST' }), { params: { id } });
    expect(early.status).toBe(409);

    expect((await put(1, file.subarray(cs, 2 * cs))).status).toBe(200);
    const done = await finish(new NextRequest(`http://x/api/editor/upload/${id}/finish`, { method: 'POST' }), { params: { id } });
    const jd = await done.json();
    expect(done.status).toBe(200);
    expect(jd.slug).toMatch(/^img-9-\d{14}$/);
    expect(jd.category).toBe('talking-head');
    expect(jd.durationSec).toBe(42);

    const src = path.join(TAKES_ROOT, jd.slug, 'source.mp4');
    expect(fs.statSync(src).size).toBe(size);
    expect(Buffer.compare(fs.readFileSync(src), file)).toBe(0);
    expect(fs.existsSync(path.join(UPLOADS_ROOT, id))).toBe(false);
    expect(readProject(jd.slug)).toMatchObject({ category: 'talking-head', durationSec: 42, stage: 'editing' });
    expect(fs.existsSync(path.join(TAKES_ROOT, jd.slug, 'edit-plan.json'))).toBe(true);
  });

  it('auto category picks long-form for ≥12 min sources; size mismatch restarts; cancel removes', async () => {
    probe.durationSec = 900;
    const size = 10;
    const r1 = await init(json('/api/editor/upload/init', 'POST', { name: 'pod.mp4', size, fingerprint: 'pod.mp4:10' }));
    const id = (await r1.json()).uploadId;
    await chunk(new NextRequest(`http://x/api/editor/upload/${id}/chunk?index=0`, { method: 'PUT', body: new Uint8Array(10).fill(7) }), { params: { id } });
    // a re-exported file (different size, same name) restarts from scratch
    const r2 = await init(json('/api/editor/upload/init', 'POST', { name: 'pod.mp4', size: 11, fingerprint: 'pod.mp4:10' }));
    expect((await r2.json()).received).toEqual([]);
    const del = await cancel(new NextRequest(`http://x/api/editor/upload/${id}`, { method: 'DELETE' }), { params: { id } });
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(UPLOADS_ROOT, id))).toBe(false);

    // auto category (no explicit category) → long-form because probe says 900s
    const r3 = await init(json('/api/editor/upload/init', 'POST', { name: 'pod2.mp4', size: 5, fingerprint: 'pod2.mp4:5' }));
    const id3 = (await r3.json()).uploadId;
    await chunk(new NextRequest(`http://x/api/editor/upload/${id3}/chunk?index=0`, { method: 'PUT', body: new Uint8Array(5).fill(1) }), { params: { id: id3 } });
    const fin = await finish(new NextRequest(`http://x/api/editor/upload/${id3}/finish`, { method: 'POST' }), { params: { id: id3 } });
    const jf = await fin.json();
    expect(jf.category).toBe('long-form');
    expect(jf.categorySource).toBe('auto');
    expect(fs.existsSync(path.join(TAKES_ROOT, jf.slug, 'edit-plan.json'))).toBe(false);
  });
});
