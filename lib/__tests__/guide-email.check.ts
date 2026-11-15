// Self-contained check of the guide email flow against a fake Resend (no network, no real email).
// Run from the repo root: npx tsx lib/__tests__/guide-email.check.ts
import assert from 'node:assert/strict'

process.env.RESEND_API_KEY = 'test-key'
process.env.EMAIL_FROM = 'Dr. Lars Stevenson <lars@send.example.com>'
process.env.UNSUBSCRIBE_SECRET = 'x'.repeat(40)
process.env.TELEGRAM_BOT_TOKEN = 'test-token'
process.env.TELEGRAM_CHAT_ID = '1'

type Call = { method: string; url: string; body?: any }
const calls: Call[] = []
let contacts: Record<string, { unsubscribed: boolean }> = {}
let failContactCreate = false
let failCancelWith = 0
let emailId = 0

globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(init.body) : undefined
  calls.push({ method, url, body })
  const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  if (url.includes('api.telegram.org')) return json(200, { ok: true })
  const m = url.match(/\/contacts\/([^/?]+)$/)
  if (m && method === 'GET') {
    const c = contacts[decodeURIComponent(m[1])]
    return c ? json(200, { id: 'c1', email: decodeURIComponent(m[1]), unsubscribed: c.unsubscribed }) : json(404, { message: 'not found' })
  }
  if (m && method === 'PATCH') {
    const e = decodeURIComponent(m[1])
    if (!contacts[e]) return json(404, { message: 'not found' })
    contacts[e] = { ...contacts[e], ...body }
    return json(200, {})
  }
  if (url.endsWith('/contacts') && method === 'POST') {
    if (failContactCreate) return json(422, { message: 'contact limit reached' })
    contacts[body.email] = { unsubscribed: body.unsubscribed }
    return json(200, { id: 'c-new' })
  }
  if (url.endsWith('/emails') && method === 'POST') return json(200, { id: `em_${++emailId}` })
  if (url.includes('/cancel')) return failCancelWith ? json(failCancelWith, { message: 'boom' }) : json(200, {})
  return json(500, { message: `unmocked ${method} ${url}` })
}) as typeof fetch

async function main() {
  const { startSequence } = await import('@/lib/email/start-sequence')
  const { formatGuideMessage, SIGNUP_FORM } = await import('@/lib/guide-lead')
  const { readToken } = await import('@/lib/email/unsubscribe-token')
  const unsub = await import('@/app/api/unsubscribe/route')

  const now = new Date('2026-11-14T20:00:00Z')
  const sentEmails = () => calls.filter((c) => c.url.endsWith('/emails'))

  // 1. New contact: guide now, day 2 and day 5 at 9:00 AM ET.
  let r = await startSequence({ firstName: 'Pat', email: 'Pat@Example.com' }, 'https://preview.example', now)
  assert.equal(r.contact, 'new')
  assert.deepEqual(r.sent.map((s) => s.step), ['thanks', 'd2', 'd5'])
  assert.equal(r.sent[1].at, '2026-11-16T14:00:00.000Z') // 9:00 AM EST
  assert.equal(r.sent[2].at, '2026-11-19T14:00:00.000Z')
  const thanks = sentEmails().find((c) => c.body.tags?.some((t: any) => t.value === 'thanks'))!
  assert.ok(thanks.body.text.includes('https://preview.example/guides/stretch-smarter-k7q2m9.pdf'))
  assert.ok(thanks.body.text.includes('1908 Reston Metro Plaza'))
  assert.ok(thanks.body.text.includes("You're getting this because you asked for my Stretch Smarter guide"))
  assert.equal(thanks.body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
  // The guide email doesn't describe the sequence and isn't marked promotional; the follow-ups are.
  assert.ok(!thanks.body.text.includes('2 short emails'))
  assert.ok(!thanks.body.text.includes('This is a promotional email'))
  const d2 = sentEmails().find((c) => c.body.tags?.some((t: any) => t.value === 'd2'))!
  assert.ok(d2.body.text.includes('This is a promotional email from Threshold Health & Performance.'))
  assert.ok(d2.body.html.includes('This is a promotional email from Threshold Health &amp; Performance.'))
  assert.ok(!('scheduled_at' in thanks.body))
  // The guide email's unsubscribe token cancels both follow-ups.
  const tok = decodeURIComponent(thanks.body.headers['List-Unsubscribe'].match(/t=([^>]+)/)[1])
  assert.equal(readToken(tok)!.ids.length, 2)

  // 2. Already subscribed: guide only.
  calls.length = 0
  r = await startSequence({ firstName: 'Pat', email: 'pat@example.com' }, 'https://preview.example', now)
  assert.equal(r.contact, 'existing')
  assert.deepEqual(r.sent.map((s) => s.step), ['thanks'])

  // 3. Unsubscribed before: guide only, and they stay unsubscribed (no PATCH back to subscribed).
  contacts['gone@example.com'] = { unsubscribed: true }
  calls.length = 0
  r = await startSequence({ firstName: 'Gone', email: 'gone@example.com' }, 'https://preview.example', now)
  assert.equal(r.contact, 'previously-unsubscribed')
  assert.deepEqual(r.sent.map((s) => s.step), ['thanks'])
  assert.equal(contacts['gone@example.com'].unsubscribed, true)
  assert.ok(!calls.some((c) => c.method === 'PATCH'))

  // 4. Contact list full: the guide still goes out.
  failContactCreate = true
  r = await startSequence({ firstName: 'Full', email: 'full@example.com' }, 'https://preview.example', now)
  failContactCreate = false
  assert.equal(r.contact, 'not-saved')
  assert.deepEqual(r.sent.map((s) => s.step), ['thanks'])

  // 5. The Telegram message carries the consent record.
  const msg = formatGuideMessage(
    { firstName: 'Pat', email: 'pat@example.com' },
    { at: now.toISOString(), version: SIGNUP_FORM.version, page: '/', ip: '203.0.113.9', userAgent: 'test' },
    r,
    null,
  )
  assert.ok(msg.includes(`form v${SIGNUP_FORM.version} on /`))
  assert.ok(msg.includes('IP 203.0.113.9'))
  assert.ok(msg.includes('NOT saved to the list'))

  // 6. Unsubscribe: GET never unsubscribes; POST cancels, marks the contact, and reports failed cancels.
  const get = await unsub.GET(new Request(`https://preview.example/api/unsubscribe?t=${encodeURIComponent(tok)}`))
  assert.equal(get.status, 200)
  assert.equal(contacts['pat@example.com'].unsubscribed, false)
  failCancelWith = 500
  calls.length = 0
  const post = await unsub.POST(
    new Request(`https://preview.example/api/unsubscribe?t=${encodeURIComponent(tok)}`, {
      method: 'POST',
      body: 'List-Unsubscribe=One-Click',
    }),
  )
  failCancelWith = 0
  assert.equal(post.status, 200)
  assert.equal(contacts['pat@example.com'].unsubscribed, true)
  const tg = calls.find((c) => c.url.includes('api.telegram.org'))!
  assert.ok(tg.body.text.includes('could NOT be canceled'))

  // 7. A tampered token is refused.
  const bad = await unsub.POST(new Request('https://preview.example/api/unsubscribe?t=abc.def', { method: 'POST' }))
  assert.equal(bad.status, 400)

  // 8. With RESEND_API_KEY as the only secret (the live setup), tokens use a key derived from it. Adding
  //    UNSUBSCRIBE_SECRET later keeps those links working, and with no key at all signing fails loudly.
  const { makeToken } = await import('@/lib/email/unsubscribe-token')
  const own = process.env.UNSUBSCRIBE_SECRET
  delete process.env.UNSUBSCRIBE_SECRET
  calls.length = 0
  r = await startSequence({ firstName: 'Sam', email: 'sam@example.com' }, 'https://preview.example', now)
  assert.deepEqual(r.sent.map((s) => s.step), ['thanks', 'd2', 'd5'])
  const samThanks = sentEmails().find((c) => c.body.tags?.some((t: any) => t.value === 'thanks'))!
  const samTok = decodeURIComponent(samThanks.body.headers['List-Unsubscribe'].match(/t=([^>]+)/)[1])
  assert.equal(readToken(samTok)!.ids.length, 2)
  assert.equal(readToken(tok), null) // signed with the UNSUBSCRIBE_SECRET that's gone now
  const samGet = await unsub.GET(new Request(`https://preview.example/api/unsubscribe?t=${encodeURIComponent(samTok)}`))
  assert.equal(samGet.status, 200)
  process.env.UNSUBSCRIBE_SECRET = own
  assert.equal(readToken(samTok)!.ids.length, 2)
  const resendKey = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY
  delete process.env.UNSUBSCRIBE_SECRET
  assert.throws(() => makeToken({ e: 'x@example.com', ids: [] }), /No key for unsubscribe tokens/)
  const noKey = await unsub.GET(new Request(`https://preview.example/api/unsubscribe?t=${encodeURIComponent(samTok)}`))
  assert.equal(noKey.status, 400)
  process.env.RESEND_API_KEY = resendKey
  process.env.UNSUBSCRIBE_SECRET = own

  console.log('guide email flow: all checks passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
