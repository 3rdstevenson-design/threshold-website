import { NextResponse } from 'next/server'
import { formatLeadMessage, parseContact } from '@/lib/contact-lead'
import { sendMessage } from '@/lib/telegram'

// Same-origin endpoint for the /contact opt-in form. Each lead goes to Lars on Telegram, with the
// SMS consent the visitor gave. (It used to create a GoHighLevel contact; GHL was cancelled on
// 2026-07-02, see lib/contact-lead.ts.) Server-side only: the bot token never reaches the browser.

export const runtime = 'nodejs'

const FALLBACK_ERROR = 'We could not submit that. Please try again or email dr.lars@thresholdhp.com.'

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

  const parsed = parseContact(body as Record<string, unknown>)
  // Honeypot: bots fill the hidden field. Accept silently so we don't tip them off.
  if (parsed.kind === 'bot') return NextResponse.json({ ok: true })
  if (parsed.kind === 'invalid') {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  }

  try {
    await sendMessage(formatLeadMessage(parsed.lead, new Date()))
  } catch (e) {
    console.error('contact: Telegram hand-off failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false, error: FALLBACK_ERROR }, { status: 502 })
  }

  console.log('contact: lead sent to Telegram', {
    smsConsent: parsed.lead.smsConsent,
    marketingConsent: parsed.lead.marketingConsent,
  })
  return NextResponse.json({ ok: true })
}
