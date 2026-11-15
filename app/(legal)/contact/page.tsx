import type { Metadata } from 'next'
import { pageMeta } from '@/lib/metadata'
import ContactForm from './ContactForm'
import InstagramLink from '@/components/InstagramLink'

export const metadata: Metadata = {
  title: { absolute: 'Contact & Text Updates | Threshold Health & Performance, Reston VA' },
  ...pageMeta({
    fullTitle: 'Contact & Text Updates | Threshold Health & Performance, Reston VA',
    description: 'Get in touch with Dr. Lars Stevenson at Threshold Health & Performance, and opt in to text updates (appointment reminders, follow-ups, and occasional offers).',
    path: '/contact',
  }),
}

// The form and its consent wording are A2P-registered: restyle freely, but change no words
// without Lars (and the SMS policy) in the loop.
export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-16 sm:px-8 md:py-24">
      <h1 className="font-cormorant text-h2 font-medium text-ink">Contact Threshold Health &amp; Performance</h1>
      <p className="mb-10 mt-5 text-lede text-ink-soft">
        Send me a note and, if you&apos;d like, opt in to text updates so I can reach you with
        appointment reminders, follow-ups, and the occasional offer. I read these myself.
      </p>
      <ContactForm />

      <p className="mt-12 text-body text-ink-soft">
        Not ready to reach out yet? Follow along on Instagram, where I post the work as it happens:{' '}
        <InstagramLink showHandle iconClassName="h-4 w-4" className="link align-middle font-semibold" />
      </p>

      <div className="mt-12 border-t border-hairline pt-8">
        <h2 className="font-nunito text-h3 font-bold text-ink">Other ways to reach me</h2>
        <ul className="mt-4 space-y-1.5 text-body text-ink-soft">
          <li>
            Phone:{' '}
            <a href="tel:+14025360203" className="link tabular">
              (402) 536-0203
            </a>
          </li>
          <li>
            Email:{' '}
            <a href="mailto:dr.lars@thresholdhp.com" className="link">
              dr.lars@thresholdhp.com
            </a>
          </li>
          <li>
            Instagram:{' '}
            <InstagramLink showHandle iconClassName="h-3.5 w-3.5" className="link align-middle" />
          </li>
          <li>Mailing address: Threshold Health &amp; Performance, 1908 Reston Metro Plaza, Reston, VA 20190</li>
        </ul>
      </div>
    </div>
  )
}
