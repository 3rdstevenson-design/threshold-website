/**
 * Guide signup (the Stretch Smarter / BAAD guide on thresholdhp.com): validation, the signup record, and the
 * message Lars gets on Telegram for each signup. Emails go out through Resend (lib/email/start-sequence.ts):
 * the guide now, day 2 and day 5, then the newsletter. The guide is delivered by email only.
 */

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
 * Version of the signup form, kept with each signup record. Since 2026-11-14b the form shows no wording about the
 * follow-ups or the newsletter (Lars's call), so the day 2 and day 5 emails and the newsletter carry a
 * "promotional email" line instead (CAN-SPAM's ad identification; lib/email/sequence.ts PROMO_LINE).
 */
export const SIGNUP_FORM = { version: '2026-11-14b' }

export type GuideLead = {
  firstName: string
  email: string
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

function emailLine(sequence: SequenceResult | null, sequenceError: string | null): string {
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
  return `Emails: ${[...sent, ...failed].join('; ') || 'none'}${who}`
}

/** Plain text (Telegram parse mode off), so nothing a visitor types can change the formatting. */
export function formatGuideMessage(
  lead: GuideLead,
  consent: ConsentRecord,
  sequence: SequenceResult | null,
  sequenceError: string | null,
): string {
  return [
    'New guide signup (thresholdhp.com)',
    `Name: ${lead.firstName}`,
    `Email: ${lead.email}`,
    `Guide: ${GUIDE.title} (${GUIDE.subtitle})`,
    emailLine(sequence, sequenceError),
    `Signup: form v${consent.version} on ${consent.page}, ${consent.at}, IP ${consent.ip}, ${consent.userAgent}`,
    `Received: ${eastern(new Date(consent.at))} ET`,
  ].join('\n')
}
