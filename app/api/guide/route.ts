import { NextResponse } from 'next/server'
import { CONSENT, formatGuideMessage, parseGuide, type ConsentRecord } from '@/lib/guide-lead'
import { resendConfigured } from '@/lib/email/resend'
import { startSequence, type SequenceResult } from '@/lib/email/start-sequence'
import { sendMessage } from '@/lib/telegram'
import { SITE_URL } from '@/lib/site'

// Same-origin endpoint for the guide signup.
// 1. Saves the contact in Resend and queues the guide email + day 2 + day 5 (lib/email/start-sequence.ts).
// 2. Pings Lars on Telegram with the signup and its consent record.
// The PDF also downloads on /guide/thank-you, so the visitor gets it even if both of those fail.

export const runtime = 'nodejs'

/** Links in emails point at the live site in production, and at the preview or local host everywhere else. */
function baseUrl(request: Request): string {
  return process.env.VERCEL_ENV === 'production' ? SITE_URL : new URL(request.url).origin
}

function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')
  return (fwd?.split(',')[0] || request.headers.get('x-real-ip') || 'unknown').trim()
}

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
    version: CONSENT.version,
    page: String(raw.page ?? '').slice(0, 200) || 'unknown',
    ip: clientIp(request),
    userAgent: (request.headers.get('user-agent') ?? 'unknown').slice(0, 160),
  }

  let sequence: SequenceResult | null = null
  let sequenceError: string | null = null
  if (resendConfigured()) {
    try {
      sequence = await startSequence(parsed.lead, baseUrl(request))
    } catch (e) {
      sequenceError = e instanceof Error ? e.message : String(e)
      console.error('guide: email sequence failed:', sequenceError)
    }
  } else {
    sequenceError = 'RESEND_API_KEY not set'
  }

  let telegramOk = true
  try {
    await sendMessage(formatGuideMessage(parsed.lead, consent, sequence, sequenceError))
  } catch (e) {
    telegramOk = false
    console.error('guide: Telegram hand-off failed:', e instanceof Error ? e.message : e)
  }

  const emailed = Boolean(sequence?.sent.some((s) => s.step === 'thanks'))
  if (!emailed && !telegramOk) {
    return NextResponse.json({ ok: false, error: 'delivery' }, { status: 502 })
  }
  console.log(`guide: signup saved (email ${emailed ? 'sent' : 'not sent'}, telegram ${telegramOk ? 'ok' : 'failed'})`)
  return NextResponse.json({ ok: true })
}
