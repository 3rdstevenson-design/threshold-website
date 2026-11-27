import { NextResponse } from 'next/server'
import { SIGNUP_FORM, formatGuideMessage, parseForm, parseGuide, type ConsentRecord, type GuideDelivery } from '@/lib/guide-lead'
import { scriptConfigured } from '@/lib/email/guide-script'
import { resendConfigured } from '@/lib/email/resend'
import { startSheetSequence } from '@/lib/email/sheet-sequence'
import { startSequence } from '@/lib/email/start-sequence'
import { sendMessage } from '@/lib/telegram'
import { SITE_URL } from '@/lib/site'

// Same-origin endpoint for the guide signup (the form in the homepage, the slide-in and the "free guide" button).
// 1. Logs the signup in the "Threshold guide signups" Sheet, whose script sends the guide from Gmail now and queues
//    day 2 + day 5 (lib/email/sheet-sequence.ts, apps-script/guide-signups). Life HQ's Leads tab reads that Sheet.
//    Resend (lib/email/start-sequence.ts) is only the fallback while GUIDE_SCRIPT_URL/GUIDE_SCRIPT_KEY aren't set.
// 2. Pings Lars on Telegram with the signup and how the emails went.
// The guide goes out by email only; if email fails, Lars sends it by hand from the Telegram ping.

export const runtime = 'nodejs'
// Apps Script can take a few seconds to wake up, then sends the guide before it answers.
export const maxDuration = 30

/** Links in emails point at the live site in production, and at the preview or local host everywhere else. */
function baseUrl(request: Request): string {
  return process.env.VERCEL_ENV === 'production' ? SITE_URL : new URL(request.url).origin
}

function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')
  return (fwd?.split(',')[0] || request.headers.get('x-real-ip') || 'unknown').trim()
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>
  const parsed = parseGuide(raw)
  // Honeypot: bots fill the hidden field. Accept silently so they learn nothing.
  if (parsed.kind === 'bot') return NextResponse.json({ ok: true })
  if (parsed.kind === 'invalid') {
    return NextResponse.json({ ok: false, field: parsed.field, error: parsed.error }, { status: 400 })
  }

  const consent: ConsentRecord = {
    at: new Date().toISOString(),
    version: SIGNUP_FORM.version,
    page: String(raw.page ?? '').slice(0, 200) || 'unknown',
    ip: clientIp(request),
    userAgent: (request.headers.get('user-agent') ?? 'unknown').slice(0, 160),
  }

  let delivery: GuideDelivery
  let emailed = false
  if (scriptConfigured()) {
    const form = parseForm(raw.form)
    try {
      const result = await startSheetSequence(parsed.lead, { page: consent.page, form, version: consent.version }, baseUrl(request))
      // A failed guide is retried by the script within 5 minutes, so it still counts as on its way.
      emailed = result.guide.sent || result.repeat || Boolean(result.guide.retry)
      delivery = { via: 'sheet', form, result, error: null }
    } catch (e) {
      console.error('guide: signup script failed:', message(e))
      delivery = { via: 'sheet', form, result: null, error: message(e) }
    }
  } else if (resendConfigured()) {
    try {
      const sequence = await startSequence(parsed.lead, baseUrl(request))
      emailed = sequence.sent.some((s) => s.step === 'thanks')
      delivery = { via: 'resend', sequence, error: null }
    } catch (e) {
      console.error('guide: email sequence failed:', message(e))
      delivery = { via: 'resend', sequence: null, error: message(e) }
    }
  } else {
    delivery = { via: 'sheet', form: parseForm(raw.form), result: null, error: 'GUIDE_SCRIPT_URL/GUIDE_SCRIPT_KEY not set' }
  }

  let telegramOk = true
  try {
    await sendMessage(formatGuideMessage(parsed.lead, consent, delivery))
  } catch (e) {
    telegramOk = false
    console.error('guide: Telegram hand-off failed:', message(e))
  }

  if (!emailed && !telegramOk) {
    return NextResponse.json({ ok: false, error: 'delivery' }, { status: 502 })
  }
  console.log(`guide: signup via ${delivery.via} (email ${emailed ? 'on its way' : 'not sent'}, telegram ${telegramOk ? 'ok' : 'failed'})`)
  return NextResponse.json({ ok: true })
}
