import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMeta } from '@/lib/metadata'
import { HANDOFF_BOOKING_PAGE, HANDOFF_WIDGET_URL } from '@/lib/booking'
import { BUSINESS } from '@/lib/site'
import LogoMark from '@/components/LogoMark'
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
  '20 to 30 minutes, at your office or on Zoom.',
  'I send you the questions ahead of time.',
  'You pick the format: video, audio, or I just take notes and quote you.',
  'You see everything before it goes out, and you can pull anything.',
  'Nothing about your patients goes on the record.',
]

const WHAT_YOU_GET = [
  {
    when: 'Within 3 days',
    what: 'Your clip once you OK it, plus a one-page handout of your answers, in your words, to hand your patients.',
  },
  {
    when: 'First look',
    what: 'The guide I’m putting together for PTs, built from what doctors tell me.',
  },
  {
    when: 'Your name on it',
    what: 'Your take, in your words, in front of patients and PTs.',
  },
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

function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-obsidian/95 backdrop-blur-sm border-b border-white/5">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <LogoMark className="h-7 w-auto text-clinical-white group-hover:text-threshold-purple transition-colors duration-300" />
          <span className="font-montserrat text-xs font-semibold tracking-[0.2em] text-clinical-white uppercase">
            Threshold
          </span>
        </Link>
        <a
          href="#book"
          className="font-montserrat text-xs font-semibold tracking-wider text-clinical-white bg-threshold-purple px-5 py-2.5 hover:bg-threshold-purple/80 transition-colors duration-200"
        >
          Pick a Time
        </a>
      </div>
    </nav>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-montserrat text-xs tracking-[0.35em] text-sterling-silver uppercase mb-5">
      {children}
    </p>
  )
}

// Email, text or call: shown under the calendar, or on its own while there
// is no calendar URL yet.
function ReachOut({ alone }: { alone: boolean }) {
  const tel = BUSINESS.phone.replace(/-/g, '')
  const options = [
    { label: 'Email', value: BUSINESS.email, href: `mailto:${BUSINESS.email}?subject=The%20Handoff` },
    { label: 'Text', value: BUSINESS.phoneDisplay, href: `sms:${tel}` },
    { label: 'Call', value: BUSINESS.phoneDisplay, href: `tel:${tel}` },
  ]
  return (
    <div className={alone ? '' : 'mt-10'}>
      <p className="font-nunito text-base md:text-lg text-clinical-white mb-4">
        {alone ? 'Email, text or call me to book.' : 'Rather reach out yourself? Email, text or call me.'}
      </p>
      <ul className="grid sm:grid-cols-3 gap-3">
        {options.map((o) => (
          <li key={o.label}>
            <a
              href={o.href}
              className="block bg-obsidian border border-white/10 hover:border-threshold-purple px-5 py-4 transition-colors duration-200"
            >
              <span className="block font-montserrat text-xs font-semibold tracking-[0.2em] text-champion-gold uppercase mb-1">
                {o.label}
              </span>
              <span className="block font-nunito text-sm md:text-base text-clinical-white break-words">
                {o.value}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function HandoffPage() {
  return (
    <>
      <Nav />
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
            {HANDOFF_WIDGET_URL && (
              <>
                <div className="bg-clinical-white rounded-sm shadow-2xl overflow-hidden">
                  {/* Zoom Scheduler booking page, embedded (see lib/booking.ts). */}
                  <iframe
                    src={HANDOFF_WIDGET_URL}
                    title="Book The Handoff with Dr. Lars Stevenson"
                    className="w-full block h-[900px] md:h-[640px]"
                    style={{ border: 'none' }}
                  />
                </div>
                <p className="font-nunito text-sm text-sterling-silver mt-4">
                  Calendar not loading?{' '}
                  <a href={HANDOFF_BOOKING_PAGE} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-clinical-white">
                    Open it on Zoom
                  </a>
                  .
                </p>
              </>
            )}
            <ReachOut alone={!HANDOFF_WIDGET_URL} />
          </div>
        </section>

        {/* ─── How it works ─── */}
        <section className="bg-obsidian py-16 md:py-20">
          <div className="max-w-5xl mx-auto px-6 grid md:grid-cols-2 gap-14 md:gap-16">
            <div>
              <SectionLabel>How It Works</SectionLabel>
              <ul className="space-y-4">
                {HOW_IT_WORKS.map((item) => (
                  <li key={item} className="flex gap-4 font-nunito text-base md:text-lg text-clinical-white leading-relaxed">
                    <span className="mt-[0.7em] h-1.5 w-1.5 shrink-0 bg-threshold-purple" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <SectionLabel>What You Get</SectionLabel>
              <ul className="space-y-6">
                {WHAT_YOU_GET.map((item) => (
                  <li key={item.when} className="border-l-2 border-threshold-purple pl-5">
                    <p className="font-montserrat text-xs font-semibold tracking-[0.2em] text-champion-gold uppercase mb-1.5">
                      {item.when}
                    </p>
                    <p className="font-nunito text-base md:text-lg text-clinical-white leading-relaxed">
                      {item.what}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ─── Sample questions ─── */}
        <section className="bg-deep-navy py-16 md:py-20">
          <div className="max-w-5xl mx-auto px-6">
            <SectionLabel>Questions Like These</SectionLabel>
            <h2 className="font-cormorant font-light text-clinical-white text-3xl md:text-5xl leading-tight mb-10 max-w-2xl">
              Mostly I want your take on things like these.
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
              I&apos;ll send yours ahead of time. In the room, I just follow where your answers go.
            </p>
          </div>
        </section>

      </main>

      <SiteFooter />
    </>
  )
}
