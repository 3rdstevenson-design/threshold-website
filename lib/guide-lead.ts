/**
 * Guide signup (the Stretch Smarter / BAAD guide on thresholdhp.com): validation, the consent wording, and the
 * message Lars gets on Telegram for each signup. Emails go out through Resend (lib/email/start-sequence.ts):
 * the guide now, day 2 and day 5, then the newsletter. The visitor also gets the PDF on /guide/thank-you, so
 * the guide reaches them even if email fails.
 */

import type { SequenceResult } from '@/lib/email/start-sequence'

export const GUIDE = {
  title: 'Stretch Smarter',
  subtitle: 'the BAAD model',
  pdfPath: '/guides/stretch-smarter-baad-model.pdf',
  thankYouPath: '/guide/thank-you',
}

/**
 * Shown under the button and copied into every signup's consent record. CAN-SPAM (US) is opt-out, so a clear
 * disclosure covers the guide, both follow-ups and the newsletter; bump `version` whenever `text` changes.
 * (Canada, the UK and the EU want a separate unticked newsletter box: Lars's call, docs/site-copy.md.)
 */
export const CONSENT = {
  version: '2026-11-14',
  text: "You'll get the guide on the next page and by email, then 2 short follow-up emails from me over the next 5 days and my occasional newsletter. Unsubscribe any time.",
}

export type GuideLead = {
  firstName: string
  email: string
}

/** What the visitor saw and did, kept as proof of consent (sent to Lars on Telegram with each signup). */
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
    `Consent: wording v${consent.version} on ${consent.page}, ${consent.at}, IP ${consent.ip}, ${consent.userAgent}`,
    `Wording shown: "${CONSENT.text}"`,
    `Received: ${eastern(new Date(consent.at))} ET`,
  ].join('\n')
}
