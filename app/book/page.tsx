import type { Metadata } from 'next'
import { pageMeta } from '@/lib/metadata'
import { BUSINESS, DISCOVERY_CALL } from '@/lib/site'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import BookingWidget from '@/components/BookingWidget'

export const metadata: Metadata = {
  title: 'Book a Free Call in Reston, VA',
  ...pageMeta({
    fullTitle: 'Book a Free Call in Reston, VA | Threshold Health & Performance',
    description:
      "Book a free 30-minute call with Dr. Lars Stevenson, PT, DPT. Talk through what's going on, what you've tried, and the next step.",
    path: '/book',
  }),
}

export default function BookPage() {
  return (
    <>
      <SiteHeader current="book" />
      <main id="main">
        <section className="mx-auto grid max-w-page gap-12 px-5 pb-24 pt-12 sm:px-8 md:grid-cols-12 md:gap-8 md:pb-32 md:pt-20">
          <div className="md:col-span-5 lg:col-span-4">
            <h1 className="font-cormorant text-h2 font-medium text-ink md:text-[clamp(2.4rem,1.6rem+2vw,3.6rem)]">
              Book a free {DISCOVERY_CALL.minutes}&#8209;minute call
            </h1>
            <p className="mt-6 text-lede text-ink-soft">
              It&apos;s a video call with me. Tell me what&apos;s going on and what you&apos;ve tried, and I&apos;ll
              tell you what I&apos;d do next. If I&apos;m not the right person for it, I&apos;ll point you to who is.
            </p>

            <h2 className="mt-12 font-nunito text-h3 font-bold text-ink">After the call</h2>
            <ol className="mt-4 space-y-4 text-body text-ink-soft">
              <li className="grid grid-cols-[1.75rem_1fr]">
                <span className="tabular font-semibold text-ink">1.</span>
                <span>If it&apos;s a fit, you book your evaluation: a full assessment and your first treatment.</span>
              </li>
              <li className="grid grid-cols-[1.75rem_1fr]">
                <span className="tabular font-semibold text-ink">2.</span>
                <span>Your plan is built from that evaluation, and it changes as you retest.</span>
              </li>
            </ol>

            <p className="mt-12 text-body text-ink-soft">
              Rather call?{' '}
              <a href={`tel:${BUSINESS.phone.replace(/-/g, '')}`} className="link tabular">
                {BUSINESS.phoneDisplay}
              </a>
              , or email{' '}
              <a href={`mailto:${BUSINESS.email}`} className="link">
                {BUSINESS.email}
              </a>
              .
            </p>
            <p className="mt-3 text-small text-muted">Booking runs on Practice Better, my patient portal.</p>
          </div>
          <div className="md:col-span-7 md:col-start-6 lg:col-span-7 lg:col-start-6">
            <BookingWidget eager />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
