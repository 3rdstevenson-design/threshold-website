import { describe, it, expect } from 'vitest';
import {
  isNetworkError,
  publishFailurePatch,
  MAX_PUBLISH_ATTEMPTS,
  OFFLINE_ERROR_PREFIX,
} from '../publishFailure';
import type { QueuePost } from '../queue';

function post(overrides: Partial<QueuePost> = {}): QueuePost {
  return {
    id: 'p1',
    status: 'approved',
    type: 'reel',
    pillar: 'exercise',
    caption: 'test',
    scheduledTime: '2026-07-01T12:00:00.000Z',
    createdAt: '2026-06-30T12:00:00.000Z',
    approvedAt: '2026-06-30T13:00:00.000Z',
    publishedAt: null,
    metaPublishId: null,
    ...overrides,
  };
}

describe('isNetworkError', () => {
  it('classifies undici fetch failures and DNS errors as network', () => {
    const fetchFailed = new Error('fetch failed');
    expect(isNetworkError(fetchFailed)).toBe(true);
    const dns = new Error('request failed');
    (dns as Error & { cause?: { code?: string } }).cause = { code: 'ENOTFOUND' };
    expect(isNetworkError(dns)).toBe(true);
  });

  it('does not classify Meta API rejections as network', () => {
    expect(isNetworkError(new Error('Meta API error (/media): {"message":"Invalid video"}'))).toBe(false);
    expect(isNetworkError('not an error')).toBe(false);
  });
});

describe('publishFailurePatch', () => {
  it('offline: stays approved, no attempt counted, offline-prefixed error', () => {
    const patch = publishFailurePatch(post(), new Error('fetch failed'));
    expect(patch.status).toBeUndefined(); // untouched → stays 'approved'
    expect(patch.publishAttempts).toBeUndefined();
    expect(patch.publishError).toBe(`${OFFLINE_ERROR_PREFIX}fetch failed`);
  });

  it('real error below ceiling: back to approved with attempts counted', () => {
    const patch = publishFailurePatch(post({ publishAttempts: 1 }), new Error('bad media'));
    expect(patch.status).toBe('approved');
    expect(patch.publishAttempts).toBe(2);
    expect(patch.publishError).toBe('bad media');
  });

  it('real error at ceiling: goes failed', () => {
    const patch = publishFailurePatch(
      post({ publishAttempts: MAX_PUBLISH_ATTEMPTS - 1 }),
      new Error('bad media'),
    );
    expect(patch.status).toBe('failed');
    expect(patch.publishAttempts).toBe(MAX_PUBLISH_ATTEMPTS);
  });

  it('offline failures can never reach the failed state, no matter how many', () => {
    let p = post({ publishAttempts: 999 });
    const patch = publishFailurePatch(p, new Error('fetch failed'));
    expect(patch.status).toBeUndefined();
    expect(patch.publishAttempts).toBeUndefined(); // still not counted
  });

  it('applies extraOnRetry only on the retry path', () => {
    const retry = publishFailurePatch(post(), new Error('bad media'), {
      extraOnRetry: { metaContainerId: undefined },
    });
    expect('metaContainerId' in retry).toBe(true);
    const failed = publishFailurePatch(
      post({ publishAttempts: MAX_PUBLISH_ATTEMPTS }),
      new Error('bad media'),
      { extraOnRetry: { metaContainerId: undefined } },
    );
    expect('metaContainerId' in failed).toBe(false);
  });
});
