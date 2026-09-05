import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { tmp, TAKES_ROOT } = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'status-'));
  return { tmp, TAKES_ROOT: path.join(tmp, 'takes') };
});
vi.mock('@/lib/editor/paths', () => ({ TAKES_ROOT, DRAFTS_DIR: tmp + '/drafts', VIDEO_PROJECT_ROOT: tmp }));
vi.mock('../paths', () => ({ TAKES_ROOT, DRAFTS_DIR: tmp + '/drafts', VIDEO_PROJECT_ROOT: tmp }));

import { readProject, writeStatus } from '../status';

beforeAll(() => fs.mkdirSync(TAKES_ROOT, { recursive: true }));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('stage precedence with review', () => {
  it('needs-review beats the file-derived stage, error beats needs-review, resolved review falls through', () => {
    const slug = 'rv-test';
    fs.mkdirSync(path.join(TAKES_ROOT, slug), { recursive: true });
    fs.writeFileSync(path.join(TAKES_ROOT, slug, 'analysis.json'), '{}');
    fs.writeFileSync(path.join(TAKES_ROOT, slug, 'edit-plan.json'), '{}');
    writeStatus(slug, { category: 'talking-head' });
    expect(readProject(slug)?.stage).toBe('editing');

    writeStatus(slug, { review: { required: true, reasons: [{ code: 'retake-flagged', detail: 'x' }], createdAt: 'now' } });
    expect(readProject(slug)?.stage).toBe('needs-review');
    expect(readProject(slug)?.review?.reasons[0].code).toBe('retake-flagged');

    writeStatus(slug, { error: 'boom' });
    expect(readProject(slug)?.stage).toBe('error');

    writeStatus(slug, { error: null, review: { required: false, reasons: [], createdAt: 'now', resolvedAt: 'later' } });
    expect(readProject(slug)?.stage).toBe('editing');
  });
});
