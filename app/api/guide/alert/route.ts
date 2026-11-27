import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { alertText } from '@/lib/guide-alert'
import { sendMessage } from '@/lib/telegram'

// Alerts from the guide signup script (apps-script/guide-signups, alert_()) on their way to Lars's Telegram: the daily
// cap holding emails, or an email that failed three times (Lars, 2026-11-27). The script holds no bot token, so it posts
// here with the same key the site uses to call it (GUIDE_SCRIPT_KEY). The site writes the message; the script only sends
// the kind and its numbers.

export const runtime = 'nodejs'

function keyOk(given: unknown): boolean {
  const want = process.env.GUIDE_SCRIPT_KEY
  if (!want || typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || !keyOk(body.key)) return NextResponse.json({ ok: false }, { status: 403 })
  const text = alertText(body)
  if (!text) return NextResponse.json({ ok: false, error: 'unknown kind' }, { status: 400 })
  try {
    await sendMessage(text)
  } catch (e) {
    console.error('guide alert: Telegram failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false, error: 'telegram' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
