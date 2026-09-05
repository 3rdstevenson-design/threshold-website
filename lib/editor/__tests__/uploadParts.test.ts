import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assembleParts,
  expectedPartBytes,
  missingParts,
  partCount,
  partPath,
  readManifest,
  receivedParts,
  sweepStaleUploads,
  uploadIdFor,
  writeManifest,
  type UploadManifest,
} from '../uploadParts';

describe('uploadParts — pure bookkeeping', () => {
  it('partCount rounds up and the last part carries the remainder', () => {
    expect(partCount(0, 8)).toBe(0);
    expect(partCount(8, 8)).toBe(1);
    expect(partCount(9, 8)).toBe(2);
    expect(partCount(24, 8)).toBe(3);
    expect(expectedPartBytes(0, 20, 8)).toBe(8);
    expect(expectedPartBytes(1, 20, 8)).toBe(8);
    expect(expectedPartBytes(2, 20, 8)).toBe(4);
    expect(expectedPartBytes(3, 20, 8)).toBe(-1);
    expect(expectedPartBytes(-1, 20, 8)).toBe(-1);
  });

  it('missingParts lists every index not received', () => {
    expect(missingParts([], 20, 8)).toEqual([0, 1, 2]);
    expect(missingParts([0, 2], 20, 8)).toEqual([1]);
    expect(missingParts([0, 1, 2], 20, 8)).toEqual([]);
  });

  it('uploadIdFor is stable and hex', () => {
    const a = uploadIdFor('IMG_1.MOV:123');
    expect(a).toBe(uploadIdFor('IMG_1.MOV:123'));
    expect(a).toMatch(/^[a-f0-9]{16}$/);
    expect(uploadIdFor('IMG_1.MOV:124')).not.toBe(a);
  });
});

describe('uploadParts — on disk', () => {
  let root: string;
  const manifest = (over: Partial<UploadManifest> = {}): UploadManifest => ({
    uploadId: 'abcdef0123456789',
    name: 'a.mov',
    size: 20,
    category: null,
    chunkSize: 8,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  });

  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('only counts parts with the exact expected byte length', () => {
    const m = manifest();
    writeManifest(root, m);
    expect(readManifest(root, m.uploadId)?.size).toBe(20);
    fs.writeFileSync(partPath(root, m.uploadId, 0), Buffer.alloc(8, 1));
    fs.writeFileSync(partPath(root, m.uploadId, 1), Buffer.alloc(5, 2)); // truncated
    fs.writeFileSync(partPath(root, m.uploadId, 2), Buffer.alloc(4, 3));
    fs.writeFileSync(`${partPath(root, m.uploadId, 1)}.tmp`, Buffer.alloc(8, 9)); // in flight
    expect(receivedParts(root, m)).toEqual([0, 2]);
  });

  it('assembles parts in order and rejects an incomplete set', async () => {
    const m = manifest();
    writeManifest(root, m);
    fs.writeFileSync(partPath(root, m.uploadId, 0), Buffer.from('AAAAAAAA'));
    fs.writeFileSync(partPath(root, m.uploadId, 2), Buffer.from('CCCC'));
    const dest = path.join(root, 'out', 'source.mp4');
    await expect(assembleParts(root, m, dest)).rejects.toThrow(/missing part\(s\) 1/);
    expect(fs.existsSync(dest)).toBe(false);
    fs.writeFileSync(partPath(root, m.uploadId, 1), Buffer.from('BBBBBBBB'));
    await assembleParts(root, m, dest);
    expect(fs.readFileSync(dest, 'utf-8')).toBe('AAAAAAAABBBBBBBBCCCC');
    expect(fs.existsSync(`${dest}.tmp`)).toBe(false);
  });

  it('sweeps uploads older than 48h and leaves fresh ones', () => {
    const old = manifest({ uploadId: '0000000000000001', updatedAt: new Date(Date.now() - 50 * 3600e3).toISOString() });
    const fresh = manifest({ uploadId: '0000000000000002' });
    writeManifest(root, old);
    writeManifest(root, fresh);
    expect(sweepStaleUploads(root)).toEqual(['0000000000000001']);
    expect(readManifest(root, '0000000000000002')).not.toBeNull();
  });
});
