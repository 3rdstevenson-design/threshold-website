import { GUIDE, type GuideForm, type GuideLead } from '@/lib/guide-lead'
import { SITE_URL } from '@/lib/site'
import { callScript } from './guide-script'
import { renderEmail } from './render'
import { nineAmEasternAfter } from './schedule'
import { SEQUENCE, type SequenceStep } from './sequence'
import { makeToken } from './unsubscribe-token'

// The guide sequence through the signup Sheet and Gmail (2026-11-27). The copy and its rendering are unchanged
// (lib/email/sequence.ts, render.ts); the site renders all three emails and the script stores, sends and schedules them.

/** Test addresses (containing "+baadtest") get the follow-ups 3 and 6 minutes out instead of days. */
export function isTestAddress(email: string): boolean {
  return email.toLowerCase().includes('+baadtest')
}

/** The PDF always comes from the live site: preview deployments sit behind Vercel's login, which Google can't pass. */
export const GUIDE_PDF_URL = `${SITE_URL}${GUIDE.pdfPath}`

export type ScriptEmail = {
  step: SequenceStep
  /** ISO time to send; absent for the guide, which goes out right away. */
  due?: string
  subject: string
  text: string
  html: string
  unsubscribeUrl: string
  attach?: { url: string; name: string }
}

/** When each follow-up goes out: 9:00 AM ET on day 2 and day 5, or 3 and 6 minutes out for a test address. */
export function sendTime(dayOffset: number, now: Date, test: boolean): Date | undefined {
  if (dayOffset === 0) return undefined
  if (test) return new Date(now.getTime() + (dayOffset === 2 ? 3 : 6) * 60_000)
  return nineAmEasternAfter(now, dayOffset)
}

/** The guide, day 2 and day 5, rendered for one person. Links point at `baseUrl` (the live site in production). */
export function buildEmails(lead: GuideLead, baseUrl: string, now: Date): ScriptEmail[] {
  const email = lead.email.trim().toLowerCase()
  const test = isTestAddress(email)
  // One link for every email: the Sheet is the list, so unsubscribing from any of them stops what's still queued.
  const unsubscribeUrl = `${baseUrl}/api/unsubscribe?t=${makeToken({ e: email, ids: [], src: 'g' })}`
  return SEQUENCE.map((copy) => {
    const body = renderEmail(copy, { firstName: lead.firstName, guideUrl: GUIDE_PDF_URL, unsubscribeUrl })
    const due = sendTime(copy.dayOffset, now, test)
    return {
      step: copy.step,
      ...(due ? { due: due.toISOString() } : {}),
      ...body,
      unsubscribeUrl,
      ...(copy.attachGuide ? { attach: { url: GUIDE_PDF_URL, name: GUIDE.attachmentName } } : {}),
    }
  })
}

export type SheetSignupResult = {
  /** previously-unsubscribed: they get the guide they asked for and nothing else; the opt-out stands. */
  contact: 'new' | 'existing' | 'previously-unsubscribed'
  /** The guide already went out today (a double click or a refresh), so nothing new was sent. */
  repeat: boolean
  test: boolean
  guide: { sent: boolean; id?: string; error?: string; retry?: boolean; skipped?: string }
  queued: { step: SequenceStep; due: string }[]
}

/** Logs the signup in the Sheet, sends the guide now and queues day 2 and day 5 (new addresses only). */
export async function startSheetSequence(
  lead: GuideLead,
  signup: { page: string; form: GuideForm; version: string },
  baseUrl: string,
  now = new Date(),
): Promise<SheetSignupResult> {
  return callScript<SheetSignupResult>('signup', {
    lead: { firstName: lead.firstName, email: lead.email.trim().toLowerCase() },
    signup,
    emails: buildEmails(lead, baseUrl, now),
  })
}
