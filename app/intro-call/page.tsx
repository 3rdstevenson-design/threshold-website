import type { Metadata } from 'next'
import { pageMeta } from '@/lib/metadata'
import { INTRO_CALL_BOOKING_PAGE } from '@/lib/booking'
import SiteFooter from '@/components/SiteFooter'
import SchedulerBooking from '@/components/SchedulerBooking'
import { BookingNav, SectionLabel } from '@/components/BookingChrome'

// /intro-call is the booking link for LinkedIn and outreach leads, and the
// call-to-action in the PDF lead magnets. It replaced Calendly ("Strategy Call") on 2026-11-14;
// hand out this URL, never the Zoom one, so links survive a scheduler change.
// Kept out of search results and the sitemap: people arrive from a DM or PDF.
export const metadata: Metadata = {
  title: 'Intro Call',
  ...pageMeta({
    fullTitle: 'Intro Call | Threshold Health & Performance',
    description: 'Book a 30-minute intro call on Zoom with Dr. Lars Stevenson, PT, DPT.',
    path: '/intro-call',
  }),
  robots: { index: false, follow: true },
}

const ON_THE_CALL = [
  'What’s going on, and how long it’s been going on.',
  'What you’ve already tried, and what it changed.',
  'Where you want to be, and what’s in the way.',
  'The next step that fits, whether that’s working with me or not.',
]

export default function IntroCallPage() {
  return (
    <>
      <BookingNav />
      <main>

        {/* ─── Hero ─── */}
        <section className="relative bg-obsidian overflow-hidden pt-16 pb-0">
          <div className="hero-beam" aria-hidden="true" />
          <div className="relative z-10 max-w-5xl mx-auto px-6 pb-14 pt-20 md:pt-24">
            <SectionLabel>Intro Call</SectionLabel>
            <h1 className="font-cormorant font-light text-clinical-white leading-[1.05] text-5xl md:text-7xl mb-8 max-w-3xl">
              Book your intro call.
            </h1>
            <div className="space-y-4 font-nunito text-base md:text-lg text-sterling-silver leading-[1.85] max-w-2xl">
              <p>
                30 minutes on Zoom with me, Dr. Lars Stevenson. You&apos;ll leave
                with a clear picture of what&apos;s holding you back and the
                next step.
              </p>
              <p>Pick a time below.</p>
            </div>
          </div>
        </section>

        {/* ─── Booking ─── */}
        <section id="book" className="bg-deep-navy py-14 md:py-20 scroll-mt-16">
          <div className="max-w-3xl mx-auto px-6">
            <SectionLabel>Pick a Time</SectionLabel>
            <SchedulerBooking
              bookingPage={INTRO_CALL_BOOKING_PAGE}
              title="Book an intro call with Dr. Lars Stevenson"
              emailSubject="Intro call"
            />
          </div>
        </section>

        {/* ─── On the call ─── */}
        <section className="bg-obsidian py-16 md:py-20">
          <div className="max-w-5xl mx-auto px-6">
            <SectionLabel>On the Call</SectionLabel>
            <ul className="space-y-4 max-w-2xl">
              {ON_THE_CALL.map((item) => (
                <li key={item} className="flex gap-4 font-nunito text-base md:text-lg text-clinical-white leading-relaxed">
                  <span className="mt-[0.7em] h-1.5 w-1.5 shrink-0 bg-threshold-purple" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

      </main>

      <SiteFooter />
    </>
  )
}
