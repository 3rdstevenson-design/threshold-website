/**
 * The Stretch Smarter (BAAD guide) email sequence: the guide right away, then day 2 and day 5, each leading to a
 * free call, after which the reader stays on the occasional newsletter (Resend Broadcasts).
 * Ported 2026-11-14 from pdf-lead-magnets/threshold-baad-guide (ADR-013); review copy and reasoning live in
 * marketing-agent/agent/nurture/baad-guide-sequence.md. Change both in the same edit. Voice DNA applies.
 *
 * Law (CAN-SPAM, checked 2026-11-14): the guide email is transactional; day 2, day 5 and the newsletter are
 * commercial, so every email carries the sender, the postal address, why the reader is getting it, and a
 * working unsubscribe, and the commercial ones say they're promotional (the form carries no opt-in wording).
 *
 * Plain data only (no imports).
 */

export type SequenceStep = 'thanks' | 'd2' | 'd5'

export type EmailCopy = {
  step: SequenceStep
  /** Days after signup; sent at 9:00 AM ET. 0 = immediately. */
  dayOffset: number
  subject: string
  preview: string
  /** Paragraphs before the link. `{firstName}` is filled in. */
  before: string[]
  link?: { label: string; href: string }
  /** Attach the guide PDF (the guide email only, Lars 2026-11-15: no routing through the website). */
  attachGuide?: boolean
  /** Paragraphs after the link, before the sign-off. */
  after: string[]
  postscript?: string
  /** Commercial (not the guide delivery itself): the footer adds PROMO_LINE. */
  promotional?: boolean
}

export const SIGN_OFF = 'Be Good. Help Someone. Learn Lots.'
export const SIGNATURE = ['Dr. Lars Stevenson, PT, DPT', 'Threshold Health & Performance']
export const POSTAL_ADDRESS = 'Threshold Health & Performance, 1908 Reston Metro Plaza, Reston, VA 20190'
export const WHY_LINE = "You're getting this because you asked for my Stretch Smarter guide on thresholdhp.com."
/** CAN-SPAM: commercial email sent without opt-in wording on the form must say it's promotional. */
export const PROMO_LINE = 'This is a promotional email from Threshold Health & Performance.'

/** `{guideUrl}` is replaced with the PDF's absolute URL at send time. */
export const SEQUENCE: EmailCopy[] = [
  {
    step: 'thanks',
    dayOffset: 0,
    subject: 'Your stretching guide is here',
    preview: 'Your Stretch Smarter guide is attached.',
    // The PDF rides along as an attachment, and the "start on page 6" tip is gone (Lars, 2026-11-15).
    attachGuide: true,
    before: ['Hey {firstName},', 'Your Stretch Smarter guide is attached.'],
    after: ["If anything in the guide doesn't make sense, hit reply. It comes straight to me."],
  },
  {
    step: 'd2',
    dayOffset: 2,
    promotional: true,
    subject: 'Stretch at a 2 out of 10',
    preview: "It'll feel too easy. That's the point.",
    before: [
      'Hey {firstName},',
      'If you change one thing from the guide, make it this: stretch at a 2 or 3 out of 10.',
      "It'll feel too easy, and that's the point. Push to a 7 or 8 and the stretch reflex kicks in, so the muscle contracts against you while you're trying to lengthen it. You grit your teeth through 30 seconds and the tissue never lets go.",
      'At a 2 or 3, your nervous system reads the position as safe. Hold it until the feeling drops to a 1, then ease in a little further, back to a 2 or 3, and repeat.',
      "Quick check: if you're gripping the floor, making a face or holding your breath, you've gone past it. Back off until your face is relaxed.",
      "Give it 2 weeks. If the same spot keeps tightening back up anyway, pay attention to that. Recurrence is information. Usually something nearby (a hip, a foot, how you load in training) keeps pulling it back, and that's what I look for.",
      'If you want me to look at yours, grab a free 30-minute call:',
    ],
    link: {
      label: 'Book a free call',
      href: 'https://www.thresholdhp.com/book?utm_source=baad-guide&utm_medium=email&utm_campaign=d2',
    },
    after: [],
  },
  {
    step: 'd5',
    dayOffset: 5,
    promotional: true,
    subject: 'What happens on the free call',
    preview: '30 minutes, on video, and you leave with a plan.',
    before: [
      'Hey {firstName},',
      "If you've been working through the guide and there's still one spot that won't let go (a hip, a hamstring, a shoulder that's fine until it isn't), that's what my free call is for.",
      "Here's how it goes. It's 30 minutes on video and it's free. You tell me what's tight or hurting, what you've already tried, and what you want to get back to, whether that's a sport, a heavy lift or a long run. I ask a lot of questions about how you train and how you move.",
      "By the end you'll know what I think is driving it and what the next step would be. If working with me isn't the right fit, I'll say so and point you somewhere better.",
    ],
    link: {
      label: 'Book your free call',
      href: 'https://www.thresholdhp.com/book?utm_source=baad-guide&utm_medium=email&utm_campaign=d5',
    },
    after: [],
    postscript: 'P.S. Rather ask a question first? Hit reply. It comes straight to me.',
  },
]
