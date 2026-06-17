import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { QueuePost } from '../queue';
import { sendCarouselToTelegram } from '../telegram';

// Build a carousel QueuePost with `n` slide URLs.
function carousel(n: number, extra: Partial<QueuePost> = {}): QueuePost {
  return {
    id: 'test-id',
    status: 'approved',
    type: 'carousel',
    pillar: 'exercise',
    caption: 'Test caption — '.repeat(5),
    imageUrls: Array.from({ length: n }, (_, i) => `https://cdn.example.com/slide-${i + 1}.png`),
    scheduledTime: '2026-06-17T09:00:00Z',
    createdAt: '2026-06-17T08:00:00Z',
    approvedAt: null,
    publishedAt: null,
    metaPublishId: null,
    notes: 'my-carousel',
    ...extra,
  };
}

type Captured = { method: string; body: any };

function mockFetchOk(): { calls: Captured[] } {
  const calls: Captured[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: any) => {
      const method = String(url).split('/').pop()!; // sendMediaGroup | sendPhoto | sendMessage
      calls.push({ method, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as any;
    }),
  );
  return { calls };
}

describe('sendCarouselToTelegram', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'TEST_TOKEN';
    delete process.env.TELEGRAM_CHAT_ID;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends one album + header + caption for a typical 7-slide carousel', async () => {
    const { calls } = mockFetchOk();
    await sendCarouselToTelegram(carousel(7));

    expect(calls.map((c) => c.method)).toEqual(['sendMediaGroup', 'sendMessage', 'sendMessage']);
    // album carries all 7 slides as photo URLs
    expect(calls[0].body.media).toHaveLength(7);
    expect(calls[0].body.media[0]).toEqual({ type: 'photo', media: 'https://cdn.example.com/slide-1.png' });
    // every call targets the fixed default chat id
    expect(new Set(calls.map((c) => c.body.chat_id))).toEqual(new Set(['8685910630']));
    // last message is the caption alone (clean copy-paste)
    expect(calls[2].body.text).toBe(carousel(7).caption);
  });

  it('chunks >10 slides into multiple albums (12 → 10 + 2)', async () => {
    const { calls } = mockFetchOk();
    await sendCarouselToTelegram(carousel(12));

    expect(calls.map((c) => c.method)).toEqual([
      'sendMediaGroup',
      'sendMediaGroup',
      'sendMessage',
      'sendMessage',
    ]);
    expect(calls[0].body.media).toHaveLength(10);
    expect(calls[1].body.media).toHaveLength(2);
  });

  it('falls back to sendPhoto for a single-slide carousel', async () => {
    const { calls } = mockFetchOk();
    await sendCarouselToTelegram(carousel(1));

    expect(calls.map((c) => c.method)).toEqual(['sendPhoto', 'sendMessage', 'sendMessage']);
    expect(calls[0].body.photo).toBe('https://cdn.example.com/slide-1.png');
  });

  it('honors TELEGRAM_CHAT_ID override', async () => {
    process.env.TELEGRAM_CHAT_ID = '999';
    const { calls } = mockFetchOk();
    await sendCarouselToTelegram(carousel(2));
    expect(new Set(calls.map((c) => c.body.chat_id))).toEqual(new Set(['999']));
  });

  it('throws when the bot token is missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    mockFetchOk();
    await expect(sendCarouselToTelegram(carousel(3))).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it('throws when the carousel has no images', async () => {
    mockFetchOk();
    await expect(sendCarouselToTelegram(carousel(0))).rejects.toThrow(/no imageUrls/);
  });

  it('throws when Telegram returns a non-ok response (so the caller can retry)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ ok: false, description: 'Bad Request' }) }) as any),
    );
    await expect(sendCarouselToTelegram(carousel(3))).rejects.toThrow(/Telegram sendMediaGroup failed/);
  });
});
