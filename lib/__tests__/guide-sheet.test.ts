import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildEmails, GUIDE_PDF_URL, sendTime } from '../email/sheet-sequence'
import { callScript, ScriptError } from '../email/guide-script'
import { readToken } from '../email/unsubscribe-token'
import { formatGuideMessage, parseForm, type ConsentRecord } from '../guide-lead'

// The guide signup through the Sheet and Gmail (2026-11-27). The script's own checks are in
// apps-script/guide-signups/check.mjs; these cover the website's side.

const NOW = new Date('2026-11-27T19:00:00Z') // Friday, 2:00 PM ET
const consent: ConsentRecord = { at: NOW.toISOString(), version: '2026-11-14b', page: '/physical-therapy', ip: '203.0.113.9', userAgent: 'test' }

type Call = { url: string; body: any }

function mockFetch(handler: (url: string, body: any) => { status?: number; json?: unknown; text?: string }) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any, init: any) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(init.body) : undefined
      calls.push({ url, body })
      const r = handler(url, body)
      const text = r.text ?? JSON.stringify(r.json ?? {})
      return new Response(text, { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
  return calls
}

beforeEach(() => {
  process.env.UNSUBSCRIBE_SECRET = 'u'.repeat(40)
  process.env.GUIDE_SCRIPT_URL = 'https://script.google.com/macros/s/TEST/exec'
  process.env.GUIDE_SCRIPT_KEY = 'k'.repeat(64)
  process.env.TELEGRAM_BOT_TOKEN = 'TEST_TOKEN'
  delete process.env.RESEND_API_KEY
})
afterEach(() => vi.unstubAllGlobals())

describe('buildEmails', () => {
  it('renders the guide, day 2 and day 5 with one Gmail-era unsubscribe link', () => {
    const emails = buildEmails({ firstName: 'Pat', email: ' Pat@Example.com ' }, 'https://www.thresholdhp.com', NOW)
    expect(emails.map((e) => e.step)).toEqual(['thanks', 'd2', 'd5'])
    const links = new Set(emails.map((e) => e.unsubscribeUrl))
    expect(links.size).toBe(1)
    const [link] = Array.from(links)
    expect(link.startsWith('https://www.thresholdhp.com/api/unsubscribe?t=')).toBe(true)
    expect(readToken(new URL(link).searchParams.get('t')!)).toEqual({ e: 'pat@example.com', ids: [], src: 'g' })
    for (const e of emails) {
      expect(e.text).toContain('Hey Pat,')
      expect(e.html).toContain('Unsubscribe</a>')
      expect(e.text).toContain(`Unsubscribe: ${link}`)
    }
  })

  it('attaches the PDF from the live site to the guide only, even on a preview', () => {
    const emails = buildEmails({ firstName: 'Pat', email: 'pat@example.com' }, 'https://preview.vercel.app', NOW)
    expect(emails[0].attach).toEqual({ url: GUIDE_PDF_URL, name: 'Stretch-Smarter-The-BAAD-Model.pdf' })
    expect(GUIDE_PDF_URL).toBe('https://www.thresholdhp.com/guides/stretch-smarter-k7q2m9.pdf')
    expect(emails[1].attach).toBeUndefined()
    expect(emails[2].attach).toBeUndefined()
    expect(emails[0].due).toBeUndefined()
  })

  it('sends day 2 and day 5 at 9:00 AM Eastern', () => {
    const [, d2, d5] = buildEmails({ firstName: 'Pat', email: 'pat@example.com' }, 'https://www.thresholdhp.com', NOW)
    expect(d2.due).toBe('2026-11-29T14:00:00.000Z') // Sunday 9:00 AM EST
    expect(d5.due).toBe('2026-12-02T14:00:00.000Z')
  })

  it('sends a +baadtest address its follow-ups 3 and 6 minutes out', () => {
    expect(sendTime(2, NOW, true)?.toISOString()).toBe('2026-11-27T19:03:00.000Z')
    expect(sendTime(5, NOW, true)?.toISOString()).toBe('2026-11-27T19:06:00.000Z')
    expect(sendTime(0, NOW, true)).toBeUndefined()
  })
})

describe('callScript', () => {
  it('posts the key and the action, and returns the answer', async () => {
    const calls = mockFetch(() => ({ json: { ok: true, version: 'v' } }))
    const r = await callScript<{ version: string }>('ping')
    expect(r.version).toBe('v')
    expect(calls[0].url).toBe('https://script.google.com/macros/s/TEST/exec')
    expect(calls[0].body).toEqual({ key: 'k'.repeat(64), action: 'ping' })
  })

  it("throws the script's own error", async () => {
    mockFetch(() => ({ json: { ok: false, error: 'forbidden' } }))
    await expect(callScript('ping')).rejects.toThrow('The signup script said: forbidden')
  })

  it('throws on an HTML error page', async () => {
    mockFetch(() => ({ status: 404, text: '<html>Page Not Found</html>' }))
    await expect(callScript('ping')).rejects.toBeInstanceOf(ScriptError)
  })

  it('refuses to run without its settings', async () => {
    delete process.env.GUIDE_SCRIPT_KEY
    await expect(callScript('ping')).rejects.toThrow('GUIDE_SCRIPT_URL or GUIDE_SCRIPT_KEY is not set')
  })
})

describe('the Telegram line for a Sheet signup', () => {
  const lead = { firstName: 'Pat', email: 'pat@example.com' }
  const base = { contact: 'new' as const, repeat: false, test: false, queued: [{ step: 'd2' as const, due: '2026-11-29T14:00:00.000Z' }] }

  it('says where it came from and what went out', () => {
    const msg = formatGuideMessage(lead, consent, { via: 'sheet', form: 'popup', error: null, result: { ...base, guide: { sent: true, id: 'm1' } } })
    expect(msg).toContain('Emails: guide sent from Gmail; d2 queued Nov 29, 2026, 9:00 AM. Logged in the Threshold guide signups Sheet.')
    expect(msg).toContain('Signup: popup form on /physical-therapy (form v2026-11-14b)')
  })

  it('says when the script will try again', () => {
    const msg = formatGuideMessage(lead, consent, {
      via: 'sheet',
      form: 'inline',
      error: null,
      result: { ...base, queued: [], guide: { sent: false, error: 'Gmail is down', retry: true } },
    })
    expect(msg).toContain('guide NOT sent yet (Gmail is down); the script tries again within 5 minutes')
  })

  it('tells Lars to send it by hand when the script is unreachable', () => {
    const msg = formatGuideMessage(lead, consent, { via: 'sheet', form: 'inline', error: 'timeout', result: null })
    expect(msg).toContain('Send the guide by hand.')
  })
})

describe('parseForm', () => {
  it('keeps the three doorways and defaults to inline', () => {
    expect(['inline', 'popup', 'button', 'sidebar', undefined].map(parseForm)).toEqual(['inline', 'popup', 'button', 'inline', 'inline'])
  })
})

describe('POST /api/guide through the Sheet', () => {
  const request = (body: unknown) =>
    new Request('https://www.thresholdhp.com/api/guide', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
  const signup = { firstName: 'Pat', email: 'pat+baadtest1@gmail.com', company: '', page: '/', form: 'popup' }

  it('sends the rendered emails to the script and pings Telegram', async () => {
    const calls = mockFetch((url) =>
      url.includes('api.telegram.org')
        ? { json: { ok: true } }
        : { json: { ok: true, contact: 'new', repeat: false, test: true, guide: { sent: true, id: 'm1' }, queued: [] } },
    )
    const { POST } = await import('../../app/api/guide/route')
    const res = await POST(request(signup))
    expect(res.status).toBe(200)
    const script = calls.find((c) => c.url.includes('script.google.com'))!
    expect(script.body.action).toBe('signup')
    expect(script.body.lead).toEqual({ firstName: 'Pat', email: 'pat+baadtest1@gmail.com' })
    expect(script.body.signup).toEqual({ page: '/', form: 'popup', version: '2026-11-14b' })
    expect(script.body.emails).toHaveLength(3)
    expect(calls.some((c) => c.url.includes('api.telegram.org'))).toBe(true)
  })

  it('still thanks the reader when the script is down but Telegram reached Lars', async () => {
    mockFetch((url) => (url.includes('api.telegram.org') ? { json: { ok: true } } : { status: 500, text: 'oops' }))
    const { POST } = await import('../../app/api/guide/route')
    expect((await POST(request(signup))).status).toBe(200)
  })

  it('fails when neither the email nor the Telegram ping went out', async () => {
    mockFetch(() => ({ status: 500, text: 'oops' }))
    const { POST } = await import('../../app/api/guide/route')
    expect((await POST(request(signup))).status).toBe(502)
  })

  it('accepts a bot quietly without calling anything', async () => {
    const calls = mockFetch(() => ({ json: { ok: true } }))
    const { POST } = await import('../../app/api/guide/route')
    expect((await POST(request({ ...signup, company: 'Acme' }))).status).toBe(200)
    expect(calls).toHaveLength(0)
  })
})

describe('POST /api/unsubscribe for a Gmail-era link', () => {
  const link = () => buildEmails({ firstName: 'Pat', email: 'pat@example.com' }, 'https://www.thresholdhp.com', NOW)[0].unsubscribeUrl

  it('marks the address in the Sheet', async () => {
    const calls = mockFetch((url) =>
      url.includes('api.telegram.org') ? { json: { ok: true } } : { json: { ok: true, found: true, already: false, canceled: 2 } },
    )
    const { POST } = await import('../../app/api/unsubscribe/route')
    const res = await POST(new Request(link(), { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(calls.find((c) => c.url.includes('script.google.com'))!.body).toEqual({ key: 'k'.repeat(64), action: 'unsubscribe', email: 'pat@example.com' })
    expect(calls.find((c) => c.url.includes('api.telegram.org'))!.body.text).toContain('Sheet: marked unsubscribed, 2 queued email(s) canceled')
  })

  it('shows an error and alerts Lars when the Sheet is unreachable', async () => {
    const calls = mockFetch((url) => (url.includes('api.telegram.org') ? { json: { ok: true } } : { status: 500, text: 'oops' }))
    const { POST } = await import('../../app/api/unsubscribe/route')
    const res = await POST(new Request(link(), { method: 'POST' }))
    expect(res.status).toBe(502)
    expect(calls.find((c) => c.url.includes('api.telegram.org'))!.body.text).toContain('Unsubscribe FAILED for pat@example.com')
  })

  it('answers a mail app one-click request without a page', async () => {
    mockFetch((url) => (url.includes('api.telegram.org') ? { json: { ok: true } } : { json: { ok: true, found: true, already: true, canceled: 0 } }))
    const { POST } = await import('../../app/api/unsubscribe/route')
    const res = await POST(new Request(link(), { method: 'POST', body: 'List-Unsubscribe=One-Click' }))
    expect(await res.text()).toBe('Unsubscribed')
  })
})
