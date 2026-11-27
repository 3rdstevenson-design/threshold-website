// Runs Code.gs against a fake Google (Sheets, Gmail, Utilities, triggers) and checks every path: a new signup, a
// repeat, the follow-ups, unsubscribes, failures and retries, late follow-ups and bad input.
// Plain Node, no dependencies:  node apps-script/guide-signups/check.mjs
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const code = readFileSync(new URL('./Code.gs', import.meta.url), 'utf8')
const TZ = 'America/New_York'

// ---------- fake Google
function parts(d, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]))
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute }
}
const pad = (n) => String(n).padStart(2, '0')

function makeGoogle() {
  const sent = []
  const triggers = []
  const props = {}
  let gmailFails = 0
  const sheets = []
  const makeSheet = (name) => {
    const s = { name, data: [], frozen: 0 }
    const cellAt = (r, c) => (s.data[r - 1] && s.data[r - 1][c - 1] !== undefined ? s.data[r - 1][c - 1] : '')
    const setAt = (r, c, v) => {
      while (s.data.length < r) s.data.push([])
      s.data[r - 1][c - 1] = v
    }
    const range = (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cellAt(r + i, c + j))),
      getValue: () => cellAt(r, c),
      setValues: (vals) => { vals.forEach((row, i) => row.forEach((v, j) => setAt(r + i, c + j, v))); return range(r, c, nr, nc) },
      setValue: (v) => { setAt(r, c, v); return range(r, c, nr, nc) },
      setNumberFormat: () => range(r, c, nr, nc),
      setFontWeight: () => range(r, c, nr, nc),
    })
    const lastRow = () => { for (let i = s.data.length; i > 0; i--) if ((s.data[i - 1] || []).some((v) => v !== '' && v !== undefined)) return i; return 0 }
    const lastCol = () => Math.max(0, ...s.data.map((row) => { for (let j = row.length; j > 0; j--) if (row[j - 1] !== '' && row[j - 1] !== undefined) return j; return 0 }))
    s.api = {
      getName: () => name,
      getRange: range,
      getDataRange: () => range(1, 1, Math.max(1, lastRow()), Math.max(1, lastCol())),
      getLastRow: lastRow,
      getLastColumn: lastCol,
      getMaxRows: () => 1000,
      getMaxColumns: () => 26,
      setFrozenRows: (n) => { s.frozen = n },
    }
    return s
  }
  sheets.push(makeSheet('Sheet1'))
  const ss = {
    getSheetByName: (n) => sheets.find((s) => s.name === n)?.api ?? null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.push(s); return s.api },
    getSheets: () => sheets.map((s) => s.api),
    deleteSheet: (api) => { const i = sheets.findIndex((s) => s.api === api); sheets.splice(i, 1) },
    setSpreadsheetTimeZone: () => {},
  }
  const pdf = [37, 80, 68, 70, 45, 49, 46, 55] // "%PDF-1.7"
  const ctx = {
    console: { log: () => {}, error: () => {} },
    SpreadsheetApp: { getActive: () => ss },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v) } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ content: s }) }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.map((fn) => ({ getHandlerFunction: () => fn })),
      newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => triggers.push(fn) }) }) }),
    },
    UrlFetchApp: {
      fetch: (url) => ({ getResponseCode: () => 200, getHeaders: () => ({ 'Content-Type': 'application/pdf' }), getContent: () => pdf, url }),
    },
    Gmail: {
      Users: {
        Messages: {
          send: (msg, user) => {
            assert.equal(user, 'me')
            if (gmailFails > 0) { gmailFails--; throw new Error('Gmail is down') }
            const id = 'm' + (sent.length + 1)
            sent.push({ id, mime: Buffer.from(msg.raw, 'base64url').toString('utf8') })
            return { id }
          },
        },
      },
    },
  }
  vm.createContext(ctx)
  vm.runInContext(`
    const RealDate = Date; let __now = RealDate.now();
    class FakeDate extends RealDate { constructor(...a) { if (a.length === 0) super(__now); else super(...a); } static now() { return __now; } }
    globalThis.Date = FakeDate; globalThis.__setNow = (t) => { __now = t; }; globalThis.__now = () => __now;
  `, ctx)
  ctx.Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    getUuid: () => randomUUID(),
    computeDigest: (_alg, s) => [...createHash('sha256').update(s, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    base64Encode: (v) => Buffer.from(typeof v === 'string' ? Buffer.from(v, 'utf8') : Uint8Array.from(v.map((b) => b & 0xff))).toString('base64'),
    base64EncodeWebSafe: (s) => Buffer.from(s, 'utf8').toString('base64url'),
    formatDate: (d, tz, fmt) => {
      const p = parts(new Date(d.getTime()), tz)
      const day = `${p.y}-${pad(p.mo)}-${pad(p.d)}`
      if (fmt === 'yyyy-MM-dd') return day
      if (fmt === 'yyyy-MM-dd HH:mm') return `${day} ${pad(p.h)}:${pad(p.mi)}`
      throw new Error('fake formatDate: ' + fmt)
    },
    parseDate: (s, tz, fmt) => {
      assert.equal(fmt, 'yyyy-MM-dd HH:mm')
      const [y, mo, d, h, mi] = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/).slice(1).map(Number)
      const want = Date.UTC(y, mo - 1, d, h, mi)
      let guess = want
      for (let k = 0; k < 2; k++) { const p = parts(new Date(guess), tz); guess += want - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) }
      return new ctx.Date(guess)
    },
  }
  vm.runInContext(code, ctx)
  const tab = (n) => {
    const s = sheets.find((x) => x.name === n)
    const head = s.data[0]
    return s.data.slice(1).filter((r) => r.some((v) => v !== '')).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
  }
  return { ctx, sent, triggers, props, tab, sheets, failGmail: (n) => { gmailFails = n } }
}

// ---------- helpers
const g = makeGoogle()
const { ctx } = g
const MIN = 60_000
const start = Date.UTC(2026, 10, 27, 19, 0) // Nov 27, 2026, 2:00 PM ET
ctx.__setNow(start)
const now = () => ctx.__now()
const advance = (ms) => ctx.__setNow(now() + ms)
const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).content)
const emails = (email, { test = false, attachUrl = 'https://www.thresholdhp.com/guides/stretch-smarter-k7q2m9.pdf', unsub = 'https://www.thresholdhp.com/api/unsubscribe?t=abc.def' } = {}) => [
  { step: 'thanks', subject: 'Your stretching guide is here', text: 'Hey,\n\nAttached.', html: '<p>Attached.</p>', unsubscribeUrl: unsub, attach: { url: attachUrl, name: 'Stretch-Smarter-The-BAAD-Model.pdf' } },
  { step: 'd2', due: new Date(now() + (test ? 3 * MIN : 2 * 86400_000)).toISOString(), subject: 'Stretch at a 2 out of 10', text: 'Day 2 ✓', html: '<p>Day 2 ✓</p>', unsubscribeUrl: unsub },
  { step: 'd5', due: new Date(now() + (test ? 6 * MIN : 5 * 86400_000)).toISOString(), subject: 'What happens on the free call', text: 'Day 5', html: '<p>Day 5</p>', unsubscribeUrl: unsub },
]
const signup = (email, firstName = 'Pat', opts = {}) =>
  post({ key: g.props.SITE_KEY, action: 'signup', lead: { firstName, email }, signup: { page: '/', form: opts.form ?? 'popup' }, emails: emails(email, opts) })
const lead = (email) => g.tab('Signups').find((r) => r.Email === email)
const jobs = (email) => g.tab('Outbox').filter((r) => r.Email === email)
let checks = 0
const ok = (cond, msg) => { assert.ok(cond, msg); checks++ }
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++ }

// ---------- setup
ctx.setup()
eq(g.sheets.map((s) => s.name), ['Signups', 'Outbox'], 'setup makes the two tabs and drops the blank Sheet1')
eq(g.triggers, ['sendDue'], 'setup adds the 5-minute timer')
ok(/^[0-9a-f]{64}$/.test(g.props.SITE_KEY), 'setup makes a 64-character key')
ctx.setup()
eq(g.triggers.length, 1, 'rerunning setup adds no second timer')

// ---------- the key
eq(post({ action: 'ping' }).error, 'forbidden', 'no key: refused')
eq(post({ key: 'x'.repeat(64), action: 'ping' }).error, 'forbidden', 'wrong key: refused')
eq(post({ key: g.props.SITE_KEY, action: 'ping' }).ok, true, 'right key: ping works')

// ---------- a new (test) signup
const A = 'pat+baadtest1@gmail.com'
let r = signup(A, 'Pat', { test: true })
eq([r.ok, r.contact, r.guide.sent, r.queued.length, r.test], [true, 'new', true, 2, true], 'new signup: guide sent, two follow-ups queued')
let row = lead(A)
eq(row.ID, 'g-' + createHash('sha256').update(A).digest('hex').slice(0, 16), 'ID is g- plus 16 hex of the SHA-256')
eq([row.Status, row.Form, row.Page, row.Signups, row.Test, row['Signed up']], ['Subscribed', 'popup', '/', 1, 'TRUE', '2026-11-27 14:00'], 'the Signups row')
eq([row['Guide sent'], row['Day 2 due'], row['Day 5 due'], row['Day 2 sent']], ['2026-11-27 14:00', '2026-11-27 14:03', '2026-11-27 14:06', ''], 'guide sent, follow-ups due')
eq(jobs(A).map((j) => [j.Step, j.Status]), [['thanks', 'sent'], ['d2', 'queued'], ['d5', 'queued']], 'the Outbox')
eq(jobs(A)[0].HTML, '', 'a sent email keeps no copy of its body on the sheet')
const mime = g.sent[0].mime
ok(mime.includes('From: "Dr. Lars Stevenson" <dr.lars@thresholdhp.com>'), 'From line')
ok(mime.includes('To: ' + A) && mime.includes('Subject: Your stretching guide is here'), 'To and Subject')
ok(mime.includes('List-Unsubscribe: <https://www.thresholdhp.com/api/unsubscribe?t=abc.def>') && mime.includes('List-Unsubscribe-Post: List-Unsubscribe=One-Click'), 'one-click unsubscribe headers')
ok(mime.includes('filename="Stretch-Smarter-The-BAAD-Model.pdf"') && mime.includes(Buffer.from('%PDF-1.7').toString('base64')), 'the PDF is attached')
ok(mime.includes(Buffer.from('Hey,\n\nAttached.').toString('base64')), 'the text body is base64 UTF-8')

// ---------- same-day repeat (double click)
r = signup(A, 'Pat', { test: true })
eq([r.contact, r.repeat, r.guide.sent, r.queued.length, g.sent.length], ['existing', true, false, 0, 1], 'same-day repeat sends nothing new')
eq(lead(A).Signups, 2, 'the repeat is counted')

// ---------- follow-ups go out when due
ctx.sendDue()
eq(g.sent.length, 1, 'nothing is due yet, so the timer stops at NEXT_DUE')
advance(3 * MIN)
ctx.sendDue()
eq(g.sent.length, 2, 'day 2 goes out when due')
ok(g.sent[1].mime.includes('Subject: Stretch at a 2 out of 10') && !g.sent[1].mime.includes('application/pdf'), 'day 2: its subject, no attachment')
ok(g.sent[1].mime.includes(Buffer.from('Day 2 ✓', 'utf8').toString('base64')), 'non-ASCII text survives')
advance(3 * MIN)
ctx.sendDue()
row = lead(A)
eq([g.sent.length, row['Day 2 sent'], row['Day 5 sent']], [3, '2026-11-27 14:03', '2026-11-27 14:06'], 'day 5 goes out, both recorded')
eq(Number(g.props.NEXT_DUE), now() + 60 * MIN, 'nothing queued: the timer checks back within the hour')

// ---------- unsubscribe cancels what's queued
const B = 'sam@example.com'
r = signup(B, 'Sam', { form: 'inline' })
eq([r.contact, r.guide.sent, r.queued.map((q) => q.step)], ['new', true, ['d2', 'd5']], 'B signs up (real timing)')
eq(lead(B)['Day 2 due'], '2026-11-29 14:06', 'day 2 due two days later (the site picks 9 AM ET; this check uses now + 2 days)')
r = post({ key: g.props.SITE_KEY, action: 'unsubscribe', email: 'SAM@example.com ' })
eq([r.ok, r.found, r.already, r.canceled], [true, true, false, 2], 'unsubscribe finds B (any case) and cancels day 2 and day 5')
eq([lead(B).Status, lead(B).Unsubscribed], ['Unsubscribed', '2026-11-27 14:06'], 'B is marked unsubscribed')
eq(jobs(B).map((j) => j.Status), ['sent', 'canceled', 'canceled'], 'the Outbox shows them canceled')
r = post({ key: g.props.SITE_KEY, action: 'unsubscribe', email: B })
eq([r.already, r.canceled], [true, 0], 'a second unsubscribe changes nothing')

// ---------- someone who unsubscribed without being on the list, then signs up
const C = 'casey@example.com'
r = post({ key: g.props.SITE_KEY, action: 'unsubscribe', email: C })
eq([r.found, lead(C).Form, lead(C).Status, lead(C).Signups, lead(C)['First name']], [false, 'unsubscribe', 'Unsubscribed', 0, ''], 'a suppression row')
const before = g.sent.length
r = signup(C, 'Casey', { form: 'inline' })
eq([r.contact, r.guide.sent, r.queued.length, g.sent.length - before], ['previously-unsubscribed', true, 0, 1], 'unsubscribed before: the guide only')
eq([lead(C).Status, lead(C)['First name'], lead(C).Signups], ['Unsubscribed', 'Casey', 1], 'still unsubscribed; name filled in')

// ---------- next-day repeat: guide again, no second round
advance(24 * 60 * MIN)
r = signup(A, 'Pat', { test: true })
eq([r.contact, r.repeat, r.guide.sent, r.queued.length], ['existing', false, true, 0], 'next-day repeat: the guide again only')

// ---------- Gmail failures: retried, then marked failed with a Problem
const D = 'dana@example.com'
g.failGmail(1)
r = signup(D, 'Dana', { form: 'button' })
eq([r.ok, r.guide.sent, r.guide.retry, r.guide.error], [true, false, true, 'Gmail is down'], 'guide fails once: will retry')
eq(lead(D)['Guide sent'], '', 'not recorded as sent')
eq(Number(g.props.NEXT_DUE) <= now(), true, 'the failed guide keeps the timer due now')
ctx.sendDue()
eq([lead(D)['Guide sent'] !== '', jobs(D)[0].Status, jobs(D)[0].Tries], [true, 'sent', 2], 'the retry sends it')
const E = 'eli@example.com'
g.failGmail(5)
signup(E, 'Eli')
ctx.sendDue()
ctx.sendDue()
eq([jobs(E)[0].Status, jobs(E)[0].Tries, lead(E).Problem], ['failed', 3, 'Guide email failed 3 times: Gmail is down'], 'three failures: failed, with a Problem')
g.failGmail(0)

// ---------- a follow-up that's more than 2 days late is dropped
advance(8 * 24 * 60 * MIN)
ctx.sendDue()
eq(jobs(D).map((j) => j.Status), ['sent', 'canceled', 'canceled'], "D's follow-ups were days late: canceled, not sent")
ok(lead(D).Problem.includes('more than 2 days late'), 'and the Problem says so')

// ---------- bad input is refused before anything is stored
const rows = g.tab('Signups').length
r = post({ key: g.props.SITE_KEY, action: 'signup', lead: { firstName: 'X', email: 'x@example.com' }, signup: {}, emails: emails('x@example.com', { attachUrl: 'https://evil.example/x.pdf' }) })
eq([r.ok, /thresholdhp\.com/.test(r.error)], [false, true], 'an attachment from another site is refused')
r = post({ key: g.props.SITE_KEY, action: 'signup', lead: { firstName: 'X', email: 'x@example.com' }, signup: {}, emails: emails('x@example.com', { unsub: 'javascript:alert(1)' }) })
eq([r.ok, /unsubscribe/.test(r.error)], [false, true], 'a bad unsubscribe link is refused')
r = post({ key: g.props.SITE_KEY, action: 'signup', lead: { firstName: 'X', email: 'not-an-email' }, signup: {}, emails: emails('x') })
eq(r.error, 'bad email', 'a bad address is refused')
r = post({ key: g.props.SITE_KEY, action: 'signup', lead: { firstName: '', email: 'x@example.com' }, signup: {}, emails: emails('x') })
eq(r.error, 'no first name', 'a blank name is refused')
eq(g.tab('Signups').length, rows, 'none of them were stored')
r = post({ key: g.props.SITE_KEY, action: 'signup', lead: { firstName: 'Evil\r\nBcc: a@b.c', email: 'y@example.com' }, signup: { form: 'sidebar' }, emails: emails('y') })
eq([r.ok, lead('y@example.com')['First name'], lead('y@example.com').Form], [true, 'Evil Bcc: a@b.c', 'inline'], 'line breaks are flattened; unknown form becomes inline')
ok(!g.sent.at(-1).mime.includes('\r\nBcc:'), 'no header injection')

console.log(`guide-signups Code.gs: ${checks} checks passed`)
