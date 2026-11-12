import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendMessage } from '../telegram';

type Captured = { method: string; body: any };

function mockFetchOk(): { calls: Captured[] } {
  const calls: Captured[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: any) => {
      const method = String(url).split('/').pop()!;
      calls.push({ method, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as any;
    }),
  );
  return { calls };
}

describe('sendMessage', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'TEST_TOKEN';
    delete process.env.TELEGRAM_CHAT_ID;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the text to the default chat', async () => {
    const { calls } = mockFetchOk();
    await sendMessage('hello');
    expect(calls).toEqual([{ method: 'sendMessage', body: { chat_id: '8685910630', text: 'hello' } }]);
  });

  it('honors TELEGRAM_CHAT_ID override', async () => {
    process.env.TELEGRAM_CHAT_ID = '999';
    const { calls } = mockFetchOk();
    await sendMessage('hi');
    expect(calls[0].body.chat_id).toBe('999');
  });

  it('throws when the bot token is missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    mockFetchOk();
    await expect(sendMessage('x')).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it('throws when Telegram returns a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ ok: false, description: 'Bad Request' }) }) as any),
    );
    await expect(sendMessage('x')).rejects.toThrow(/Telegram sendMessage failed/);
  });
});
