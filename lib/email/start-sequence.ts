import { createHash } from 'node:crypto'
import { GUIDE, type GuideLead } from '@/lib/guide-lead'
import { createContact, getContact, sendEmail } from './resend'
import { renderEmail } from './render'
import { nineAmEasternAfter } from './schedule'
import { SEQUENCE, type EmailCopy, type SequenceStep } from './sequence'
import { makeToken } from './unsubscribe-token'

// Ported 2026-11-14 from pdf-lead-magnets/threshold-baad-guide, with the fixes from the CAN-SPAM review:
// a past unsubscriber is never silently re-subscribed, and a full contact list still delivers the guide.

/** e.g. "Dr. Lars Stevenson <lars@send.thresholdhp.com>": must be on a domain verified in Resend. */
function from(): string {
  const f = process.env.EMAIL_FROM
  if (!f) throw new Error('EMAIL_FROM is not set')
  return f
}
const REPLY_TO = () => process.env.EMAIL_REPLY_TO || 'dr.lars@thresholdhp.com'

/** Test addresses (containing "+baadtest") get the follow-ups 3 and 6 minutes out instead of days. */
export function isTestAddress(email: string): boolean {
  return email.toLowerCase().includes('+baadtest')
}

export type SequenceResult = {
  /** previously-unsubscribed: they get the guide they asked for and nothing else; the opt-out stands. */
  contact: 'new' | 'existing' | 'previously-unsubscribed' | 'not-saved'
  contactError?: string
  sent: { step: SequenceStep; id: string; at: string }[]
  /** Steps that couldn't be queued, with the reason. */
  failed: { step: SequenceStep; error: string }[]
}

function sendTime(copy: EmailCopy, now: Date, test: boolean): Date | undefined {
  if (copy.dayOffset === 0) return undefined
  if (test) return new Date(now.getTime() + (copy.dayOffset === 2 ? 3 : 6) * 60_000)
  return nineAmEasternAfter(now, copy.dayOffset)
}

/**
 * Saves the contact in Resend (where the newsletter goes out as Broadcasts) and queues the sequence.
 * Scheduling runs last-first so each email's unsubscribe link can cancel the ones after it.
 * - new contact: guide now, day 2, day 5.
 * - existing, still subscribed: the guide again, no second round of follow-ups.
 * - previously unsubscribed: the guide only (a transactional reply to their request); they stay unsubscribed.
 * - contact couldn't be saved (e.g. the free plan's contact cap): the guide only, and Lars hears about it.
 */
export async function startSequence(lead: GuideLead, baseUrl: string, now = new Date()): Promise<SequenceResult> {
  const email = lead.email.toLowerCase()
  const test = isTestAddress(email)

  let contact: SequenceResult['contact']
  let contactError: string | undefined
  try {
    const existing = await getContact(email)
    if (!existing) {
      await createContact(email, lead.firstName)
      contact = 'new'
    } else {
      contact = existing.unsubscribed ? 'previously-unsubscribed' : 'existing'
    }
  } catch (e) {
    contact = 'not-saved'
    contactError = e instanceof Error ? e.message : String(e)
  }

  const steps = contact === 'new' ? SEQUENCE : SEQUENCE.filter((c) => c.dayOffset === 0)
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
  const keyBase = createHash('sha256').update(`${email}|${dayKey}`).digest('hex').slice(0, 32)

  const result: SequenceResult = { contact, contactError, sent: [], failed: [] }
  const later: string[] = [] // IDs queued after the email being built

  for (const copy of [...steps].reverse()) {
    const unsubscribeUrl = `${baseUrl}/api/unsubscribe?t=${makeToken({ e: email, ids: [...later] })}`
    const body = renderEmail(copy, {
      firstName: lead.firstName,
      guideUrl: `${baseUrl}${GUIDE.pdfPath}`,
      unsubscribeUrl,
    })
    const at = sendTime(copy, now, test)
    try {
      const id = await sendEmail({
        from: from(),
        to: email,
        replyTo: REPLY_TO(),
        ...body,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        scheduledAt: at,
        tags: [
          { name: 'sequence', value: 'baad-guide' },
          { name: 'step', value: copy.step },
        ],
        // A double-click or a same-day repeat doesn't send twice.
        idempotencyKey: `site-baad-${copy.step}-${contact}-${keyBase}`,
      })
      later.unshift(id)
      result.sent.unshift({ step: copy.step, id, at: (at ?? now).toISOString() })
    } catch (e) {
      result.failed.unshift({ step: copy.step, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}
