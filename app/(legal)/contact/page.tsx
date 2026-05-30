import type { Metadata } from 'next'
import ContactForm from './ContactForm'

export const metadata: Metadata = {
  title: { absolute: 'Contact & Text Updates | Threshold Health & Performance' },
  description:
    'Get in touch with Dr. Lars Stevenson at Threshold Health & Performance, and opt in to text updates (appointment reminders, follow-ups, and occasional offers).',
  alternates: { canonical: '/contact' },
}

export default function ContactPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12 md:py-16">
      <p className="font-montserrat text-xs tracking-[0.3em] text-threshold-purple uppercase mb-4">
        Get in touch
      </p>
      <h1 className="font-cormorant font-light text-obsidian leading-[1.1] text-4xl md:text-5xl mb-4">
        Contact Threshold Health &amp; Performance
      </h1>
      <p className="font-nunito text-base text-deep-navy/80 leading-[1.8] mb-8">
        Send me a note and, if you&apos;d like, opt in to text updates so I can reach you with
        appointment reminders, follow-ups, and the occasional offer. I read these myself.
      </p>
      <ContactForm />
    </div>
  )
}
