import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatLeadMessage, MAX_MESSAGE, parseContact } from '../contact-lead';
import { POST } from '../../app/api/contact/route';

const valid = {
  firstName: ' Jane ',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '(703) 555-0100',
  message: 'Knee hurts after runs',
  smsConsent: true,
  marketingConsent: false,
  company: '',
};

describe('parseContact', () => {
  it('flags a filled honeypot as a bot', () => {
    expect(parseContact({ ...valid, company: 'Acme' })).toEqual({ kind: 'bot' });
  });

  it('requires name, email and phone', () => {
    for (const field of ['firstName', 'email', 'phone'] as const) {
      const r = parseContact({ ...valid, [field]: '  ' });
      expect(r).toEqual({ kind: 'invalid', error: 'Please provide your name, email, and phone.' });
    }
  });

  it('rejects a malformed email and a short phone', () => {
    expect(parseContact({ ...valid, email: 'jane@' }).kind).toBe('invalid');
    expect(parseContact({ ...valid, phone: '555-0100' })).toEqual({
      kind: 'invalid',
      error: 'Please enter a valid phone number.',
    });
  });

  it('normalizes the lead and only accepts consent when it is exactly true', () => {
    const r = parseContact({ ...valid, marketingConsent: 'on' });
    expect(r).toEqual({
      kind: 'lead',
      lead: {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phone: '+17035550100',
        message: 'Knee hurts after runs',
        smsConsent: true,
        marketingConsent: false,
      },
    });
  });

  it('caps the message length', () => {
    const r = parseContact({ ...valid, message: 'x'.repeat(5000) });
    expect(r.kind === 'lead' && r.lead.message.length).toBe(MAX_MESSAGE);
  });
});

describe('formatLeadMessage', () => {
  it('carries the contact details, the consent flags and the time', () => {
    const r = parseContact(valid);
    if (r.kind !== 'lead') throw new Error('expected a lead');
    const text = formatLeadMessage(r.lead, new Date('2026-11-06T19:05:00Z'));
    expect(text).toContain('New website lead (thresholdhp.com/contact)');
    expect(text).toContain('Name: Jane Doe');
    expect(text).toContain('Phone: +17035550100');
    expect(text).toContain('Email: jane@example.com');
    expect(text).toContain('Texts OK: transactional YES, marketing no');
    expect(text).toContain('Message: Knee hurts after runs');
    expect(text).toContain('2:05 PM ET (2026-11-06T19:05:00.000Z)');
  });

  it('says so when there is no message', () => {
    const r = parseContact({ ...valid, message: '' });
    if (r.kind !== 'lead') throw new Error('expected a lead');
    expect(formatLeadMessage(r.lead, new Date())).toContain('Message: (none)');
  });
});

describe('POST /api/contact', () => {
  type Call = { url: string; body: { chat_id: string; text: string } };
  let calls: Call[];
  let telegramOk: boolean;

  function request(body: unknown): Request {
    return new Request('https://www.thresholdhp.com/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  beforeEach(() => {
    calls = [];
    telegramOk = true;
    process.env.TELEGRAM_BOT_TOKEN = 'TEST_TOKEN';
    delete process.env.TELEGRAM_CHAT_ID;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return new Response(
          JSON.stringify(telegramOk ? { ok: true } : { ok: false, description: 'Bad Request: chat not found' }),
          { status: telegramOk ? 200 : 400 },
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('sends a valid lead to Lars on Telegram and answers ok', async () => {
    const res = await POST(request(valid));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.telegram.org/botTEST_TOKEN/sendMessage');
    expect(calls[0].body.chat_id).toBe('8685910630');
    expect(calls[0].body.text).toContain('Name: Jane Doe');
  });

  it('answers ok to a bot without sending anything', async () => {
    const res = await POST(request({ ...valid, company: 'Acme' }));
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(0);
  });

  it('returns 400 for missing fields and for a body that is not JSON', async () => {
    const missing = await POST(request({ ...valid, email: '' }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe('Please provide your name, email, and phone.');
    expect((await POST(request('not json'))).status).toBe(400);
    expect((await POST(request([1, 2]))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('returns 502 with the email fallback when Telegram refuses', async () => {
    telegramOk = false;
    const res = await POST(request(valid));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('email dr.lars@thresholdhp.com');
  });

  it('returns 502 when the bot token is missing, without calling Telegram', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const res = await POST(request(valid));
    expect(res.status).toBe(502);
    expect(calls).toHaveLength(0);
  });
});
