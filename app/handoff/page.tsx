import type { Metadata } from 'next'
import { pageMeta } from '@/lib/metadata'
import { HANDOFF_BOOKING_PAGE } from '@/lib/booking'
import SchedulerBooking from '@/components/SchedulerBooking'
import { BookingNav, SectionLabel } from '@/components/BookingChrome'
import SiteFooter from '@/components/SiteFooter'

// /handoff is where doctors book a Handoff interview. Its QR code is on the
// printed one-sheet. It's for doctors only, so it stays out of search results
// and the sitemap. The copy follows marketing-agent's
// agent/physician-referrals/2026-11-13-the-handoff.md ("The one line",
// "The ask", "What they get", the question bank); change them together.
export const metadata: Metadata = {
  title: 'The Handoff',
  ...pageMeta({
    fullTitle: 'The Handoff | Threshold Health & Performance',
    description:
      'Doctors on getting hurt, getting back, and staying in the game. A 20 to 30 minute interview with Dr. Lars Stevenson, PT, DPT.',
    path: '/handoff',
  }),
  robots: { index: false, follow: true },
}

const HOW_IT_WORKS = [
  '20 to 30 minutes on Zoom. Rather meet at your office? Reach out first and I’ll set it up.',
  'I send you the questions ahead of time.',
  'You pick the format: video, audio, or I take notes and quote you.',
  'Nothing about your patients goes on the record.',
]

// One question per moment of an injury, plus one for PTs.
const SAMPLE_QUESTIONS = [
  {
    moment: 'Just got hurt',
    question: 'When someone just got hurt, what do you wish they knew in the first 2 weeks?',
  },
  {
    moment: 'Never got fully healthy',
    question: 'Who are the patients who never quite get back, and what do you think gets missed?',
  },
  {
    moment: 'Staying healthy',
    question: 'What do you tell someone who wants another 20 years in their sport?',
  },
  {
    moment: 'For PTs',
    question: 'What do you wish PTs did more of, or less of, with your patients?',
  },
]

export default function HandoffPage() {
  return (
    <>
      <BookingNav />
      <main>

        {/* ─── Hero ─── */}
        <section className="relative bg-obsidian overflow-hidden pt-16 pb-0">
          <div className="hero-beam" aria-hidden="true" />
          <div className="relative z-10 max-w-5xl mx-auto px-6 pb-14 pt-20 md:pt-24">
            <SectionLabel>For Doctors · An Interview Series</SectionLabel>
            <h1 className="font-cormorant font-light text-clinical-white leading-[1.05] text-5xl md:text-7xl mb-6 max-w-3xl">
              The Handoff
            </h1>
            <p className="font-cormorant italic text-2xl md:text-3xl text-clinical-white/90 leading-snug max-w-3xl mb-8">
              Doctors on getting hurt, getting back, and staying in the game.
            </p>
            <div className="space-y-4 font-nunito text-base md:text-lg text-sterling-silver leading-[1.85] max-w-2xl">
              <p>
                I&apos;m Dr. Lars Stevenson, a physical therapist. I&apos;m
                sitting down with doctors to ask what they see in their
                patients, and what they wish those patients (and their PTs)
                knew.
              </p>
              <p>Pick a time below. It takes 20 to 30 minutes.</p>
            </div>
          </div>
        </section>

        {/* ─── Booking (first, so the QR code lands on the calendar) ─── */}
        <section id="book" className="bg-deep-navy py-14 md:py-20 scroll-mt-16">
          <div className="max-w-3xl mx-auto px-6">
            <SectionLabel>Pick a Time</SectionLabel>
            <SchedulerBooking
              bookingPage={HANDOFF_BOOKING_PAGE}
              title="Book The Handoff with Dr. Lars Stevenson"
              emailSubject="The Handoff"
            />
          </div>
        </section>

        {/* ─── How it works ─── */}
        <section className="bg-obsidian py-16 md:py-20">
          <div className="max-w-5xl mx-auto px-6">
            <SectionLabel>How It Works</SectionLabel>
            <ul className="space-y-4 max-w-2xl">
              {HOW_IT_WORKS.map((item) => (
                <li key={item} className="flex gap-4 font-nunito text-base md:text-lg text-clinical-white leading-relaxed">
                  <span className="mt-[0.7em] h-1.5 w-1.5 shrink-0 bg-threshold-purple" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ─── Sample questions ─── */}
        <section className="bg-deep-navy py-16 md:py-20">
          <div className="max-w-5xl mx-auto px-6">
            <SectionLabel>The Questions</SectionLabel>
            <h2 className="font-cormorant font-light text-clinical-white text-3xl md:text-5xl leading-tight mb-10 max-w-2xl">
              What I’ll ask.
            </h2>
            <ol className="grid sm:grid-cols-2 gap-4 md:gap-6">
              {SAMPLE_QUESTIONS.map((q, i) => (
                <li key={q.moment} className="bg-obsidian border border-white/5 p-6 md:p-7">
                  <p className="font-montserrat text-xs tracking-[0.2em] text-sterling-silver uppercase mb-3">
                    <span className="text-threshold-purple font-semibold mr-2">{String(i + 1).padStart(2, '0')}</span>
                    {q.moment}
                  </p>
                  <p className="font-nunito text-base md:text-lg text-clinical-white leading-relaxed">
                    {q.question}
                  </p>
                </li>
              ))}
            </ol>
            <p className="font-nunito text-sm md:text-base text-sterling-silver mt-8 max-w-2xl">
              These are samples. Yours come ahead of time, matched to the patients you see.
            </p>
          </div>
        </section>

      </main>

      <SiteFooter />
    </>
  )
}
