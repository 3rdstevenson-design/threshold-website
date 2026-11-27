/**
 * Guide signup (the Stretch Smarter / BAAD guide on thresholdhp.com): validation, the signup record, and the
 * message Lars gets on Telegram for each signup. Since 2026-11-27 the signup is logged in the "Threshold guide
 * signups" Sheet and the emails go out through Gmail (lib/email/sheet-sequence.ts): the guide now, day 2 and day 5.
 * Resend (lib/email/start-sequence.ts) is only the fallback while the script isn't configured. Email only, no download.
 */

import type { SheetSignupResult } from '@/lib/email/sheet-sequence'
import type { SequenceResult } from '@/lib/email/start-sequence'

export const GUIDE = {
  title: 'Stretch Smarter',
  subtitle: 'the BAAD model',
  // Since 2026-11-15 the guide email attaches this file (Lars: no routing through the website). It stays here because
  // next.config.js traces it into /api/guide, and links in emails sent before then still point to it.
  // No page links to it; robots.txt and an X-Robots-Tag keep it out of search.
  pdfPath: '/guides/stretch-smarter-k7q2m9.pdf',
  attachmentName: 'Stretch-Smarter-The-BAAD-Model.pdf',
  thankYouPath: '/guide/thank-you',
}

/**
 * The guide's pitch in Lars's approved words (the homepage guide section). The slide-in (components/GuidePopup.tsx)
 * uses the same words, so there's one copy to change.
 */
export const GUIDE_PITCH = {
  heading: 'A free guide to stretching smarter',
  blurb:
    'Stretch Smarter is my 15-page guide to the BAAD model: the 4 things that decide whether a stretch changes anything (breathing, angle, amplitude and duration), with a body-region guide and a 4\u2011week plan.',
}

/**
 * Version of the signup form, kept with each signup record. Since 2026-11-14b the form shows no wording about the
 * follow-ups or the newsletter (Lars's call), so the day 2 and day 5 emails and the newsletter carry a
 * "promotional email" line instead (CAN-SPAM's ad identification; lib/email/sequence.ts PROMO_LINE).
 */
export const SIGNUP_FORM = { version: '2026-11-14b' }

export type GuideLead = {
  firstName: string
  email: string
}

/** Which doorway the signup came through: the form in a page, the slide-in, or the "free guide" button. */
export type GuideForm = 'inline' | 'popup' | 'button'
export const GUIDE_FORMS: readonly GuideForm[] = ['inline', 'popup', 'button']

export function parseForm(value: unknown): GuideForm {
  return GUIDE_FORMS.includes(value as GuideForm) ? (value as GuideForm) : 'inline'
}

/** When, where and how each signup happened (sent to Lars on Telegram with each signup). */
export type ConsentRecord = {
  at: string
  version: string
  page: string
  ip: string
  userAgent: string
}

export type GuideField = 'firstName' | 'email'

export type GuideParseResult =
  | { kind: 'lead'; lead: GuideLead }
  | { kind: 'bot' } // honeypot field filled
  | { kind: 'invalid'; field: GuideField; error: string }

const MAX_FIELD = 200
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const GUIDE_ERRORS: Record<GuideField, string> = {
  firstName: 'Add your first name.',
  email: 'Check your email address. It needs an @ and a domain.',
}

function clean(value: unknown): string {
  return String(value ?? '').trim().slice(0, MAX_FIELD)
}

export function parseGuide(body: Record<string, unknown>): GuideParseResult {
  if (body.company) return { kind: 'bot' }
  const firstName = clean(body.firstName)
  const email = clean(body.email)
  if (!firstName) return { kind: 'invalid', field: 'firstName', error: GUIDE_ERRORS.firstName }
  if (!EMAIL_RE.test(email)) return { kind: 'invalid', field: 'email', error: GUIDE_ERRORS.email }
  return { kind: 'lead', lead: { firstName, email } }
}

function eastern(d: Date): string {
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })
}

/** How the emails went: through the Sheet and Gmail, or (fallback) through Resend. */
export type GuideDelivery =
  | { via: 'sheet'; form: GuideForm; result: SheetSignupResult | null; error: string | null }
  | { via: 'resend'; sequence: SequenceResult | null; error: string | null }

function resendLine(sequence: SequenceResult | null, sequenceError: string | null): string {
  if (!sequence) return `Emails: none sent (${sequenceError ?? 'unknown error'}). Send the guide by hand if needed.`
  const sent = sequence.sent.map((s) => (s.step === 'thanks' ? 'guide sent' : `${s.step} queued ${eastern(new Date(s.at))}`))
  const failed = sequence.failed.map((f) => `${f.step} FAILED (${f.error})`)
  const who =
    sequence.contact === 'previously-unsubscribed'
      ? ' [unsubscribed before: guide only, still unsubscribed]'
      : sequence.contact === 'existing'
        ? ' [already on the list: guide only]'
        : sequence.contact === 'not-saved'
          ? ` [NOT saved to the list: ${sequence.contactError}]`
          : ''
  return `Emails (Resend): ${[...sent, ...failed].join('; ') || 'none'}${who}`
}

function sheetLine(result: SheetSignupResult | null, error: string | null): string {
  if (!result) {
    return `Emails: none sent, and the signup may not be in the Sheet (${error ?? 'unknown error'}). Send the guide by hand.`
  }
  const g = result.guide
  const guide = g.sent
    ? 'guide sent from Gmail'
    : result.repeat
      ? 'guide already sent today, not sent again'
      : g.retry
        ? `guide NOT sent yet (${g.error}); the script tries again within 5 minutes`
        : `guide NOT sent (${g.error}); send it by hand`
  const queued = result.queued.map((q) => `${q.step} queued ${eastern(new Date(q.due))}`)
  const who =
    result.contact === 'previously-unsubscribed'
      ? ' [unsubscribed before: guide only, still unsubscribed]'
      : result.contact === 'existing'
        ? ' [already on the list: guide only]'
        : ''
  return `Emails: ${[guide, ...queued].join('; ')}${who}. Logged in the Threshold guide signups Sheet.`
}

/** Plain text (Telegram parse mode off), so nothing a visitor types can change the formatting. */
export function formatGuideMessage(lead: GuideLead, consent: ConsentRecord, delivery: GuideDelivery): string {
  const where = delivery.via === 'sheet' ? `${delivery.form} form on ${consent.page}` : `form v${consent.version} on ${consent.page}`
  return [
    'New guide signup (thresholdhp.com)',
    `Name: ${lead.firstName}`,
    `Email: ${lead.email}`,
    `Guide: ${GUIDE.title} (${GUIDE.subtitle})`,
    delivery.via === 'sheet' ? sheetLine(delivery.result, delivery.error) : resendLine(delivery.sequence, delivery.error),
    `Signup: ${where} (form v${consent.version}), ${consent.at}, IP ${consent.ip}, ${consent.userAgent}`,
    `Received: ${eastern(new Date(consent.at))} ET`,
  ].join('\n')
}
