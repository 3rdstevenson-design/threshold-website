import { describe, it, expect } from 'vitest';
import { derivePipeline, type PipelineItem } from '../pipelineState';
import type { ProjectStatus } from '../editor/status';
import type { LocalFile } from '../localScan';
import type { QueuePost } from '../queue';

const NOW = new Date('2026-07-20T12:00:00.000Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString();

function post(overrides: Partial<QueuePost>): QueuePost {
  return {
    id: 'p1',
    status: 'pending',
    type: 'reel',
    pillar: 'exercise',
    caption: 'a real caption',
    scheduledTime: minsAgo(-60), // an hour in the future by default
    createdAt: minsAgo(5),
    approvedAt: null,
    publishedAt: null,
    metaPublishId: null,
    notes: 'my-reel.mp4',
    ...overrides,
  };
}

function file(overrides: Partial<LocalFile>): LocalFile {
  return {
    id: 'reel:my-reel.mp4',
    type: 'reel',
    name: 'my-reel.mp4',
    filePath: '/x/my-reel.mp4',
    previewUrl: '',
    mtimeMs: NOW.getTime() - 5 * 60000,
    ...overrides,
  };
}

function project(overrides: Partial<ProjectStatus>): ProjectStatus {
  return {
    slug: 'my-reel',
    stage: 'editing',
    updatedAt: minsAgo(30),
    hasThumb: false,
    error: null,
    category: 'talking-head',
    hasClipsProposal: false,
    ...overrides,
  };
}

function run(input: {
  projects?: ProjectStatus[];
  files?: LocalFile[];
  posts?: QueuePost[];
  offline?: boolean;
  queueUnknown?: boolean;
}): PipelineItem[] {
  return derivePipeline({
    projects: input.projects ?? [],
    files: input.files ?? [],
    posts: input.posts ?? [],
    offline: input.offline ?? false,
    queueUnknown: input.queueUnknown,
    now: NOW,
  });
}

describe('derivePipeline — one item per video, furthest source wins', () => {
  it('queue post claims its file and project: exactly one item', () => {
    const items = run({
      projects: [project({ stage: 'rendered' })],
      files: [file({})],
      posts: [post({})],
    });
    expect(items).toHaveLength(1);
    expect(items[0].stage).toBe('needs-review');
    expect(items[0].editorSlug).toBe('my-reel'); // still deep-links back
  });

  it('file with no post: rendered, stuck + queue action once old', () => {
    const fresh = run({ files: [file({ mtimeMs: NOW.getTime() - 60_000 })] })[0];
    expect(fresh.stage).toBe('rendered');
    expect(fresh.stuck).toBe(false);
    const old = run({ files: [file({ mtimeMs: NOW.getTime() - 30 * 60000 })] })[0];
    expect(old.stuck).toBe(true);
    expect(old.action?.kind).toBe('queue-file');
  });

  it('file with no post while queue is unknown: reported, never flagged', () => {
    const item = run({
      files: [file({ mtimeMs: NOW.getTime() - 30 * 60000 })],
      queueUnknown: true,
    })[0];
    expect(item.stuck).toBe(false);
    expect(item.action).toBeUndefined();
  });

  it('file with no post while offline (stale snapshot): reported, never flagged', () => {
    const item = run({
      files: [file({ mtimeMs: NOW.getTime() - 30 * 60000 })],
      offline: true,
    })[0];
    expect(item.stuck).toBe(false);
    expect(item.action).toBeUndefined();
    expect(item.detail).toContain('Offline');
  });
});

describe('derivePipeline — queue statuses', () => {
  it('stale placeholder caption: captioning + stuck + recaption action', () => {
    const item = run({
      posts: [post({ caption: '✏️ Add caption before approving', createdAt: minsAgo(30) })],
    })[0];
    expect(item.stage).toBe('captioning');
    expect(item.stuck).toBe(true);
    expect(item.action?.kind).toBe('recaption');
  });

  it('approved overdue offline: publishing, waiting, NOT stuck', () => {
    const item = run({
      posts: [post({ status: 'approved', scheduledTime: minsAgo(300) })],
      offline: true,
    })[0];
    expect(item.stage).toBe('publishing');
    expect(item.stuck).toBe(false);
    expect(item.detail).toContain('offline');
  });

  it('approved overdue online past threshold: stuck', () => {
    const item = run({
      posts: [post({ status: 'approved', scheduledTime: minsAgo(300) })],
    })[0];
    expect(item.stuck).toBe(true);
  });

  it('processing past reaper age: stuck; failed: stuck + retry-publish', () => {
    const processing = run({
      posts: [post({ status: 'processing', lastAttemptAt: minsAgo(60), metaContainerId: 'c1' })],
    })[0];
    expect(processing.stage).toBe('publishing');
    expect(processing.stuck).toBe(true);

    const failed = run({ posts: [post({ status: 'failed', publishAttempts: 5 })] })[0];
    expect(failed.stage).toBe('failed');
    expect(failed.stuck).toBe(true);
    expect(failed.action?.kind).toBe('retry-publish');
  });

  it('published + sent_to_telegram + rejected are terminal, never stuck', () => {
    const items = run({
      posts: [
        post({ id: 'a', notes: 'a.mp4', status: 'published', publishedAt: minsAgo(10) }),
        post({ id: 'b', notes: 'b.mp4', status: 'sent_to_telegram', telegramSentAt: minsAgo(10) }),
        post({ id: 'c', notes: 'c.mp4', status: 'rejected' }),
      ],
    });
    expect(items.every((i) => !i.stuck)).toBe(true);
    expect(items.map((i) => i.stage).sort()).toEqual(['published', 'published', 'rejected']);
  });
});

describe('derivePipeline — editor projects', () => {
  it('error project: edit-failed, stuck, links to editor', () => {
    const item = run({ projects: [project({ stage: 'error', error: 'boom' })] })[0];
    expect(item.stage).toBe('edit-failed');
    expect(item.stuck).toBe(true);
    expect(item.editorSlug).toBe('my-reel');
  });

  it('active project with no file/post: processing, not stuck', () => {
    const item = run({ projects: [project({ stage: 'transcribed' })] })[0];
    expect(item.stage).toBe('processing');
    expect(item.stuck).toBe(false);
  });

  it('stuck items sort first', () => {
    const items = run({
      projects: [project({ stage: 'error', error: 'boom', slug: 'broken' })],
      posts: [post({})],
    });
    expect(items[0].stuck).toBe(true);
    expect(items[0].key).toBe('project:broken');
  });
});
