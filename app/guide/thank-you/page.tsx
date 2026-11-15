import type { Metadata } from 'next'
import Link from 'next/link'
import { BOOKING_URL } from '@/lib/booking'
import { BUSINESS, DISCOVERY_CALL } from '@/lib/site'
import { GUIDE } from '@/lib/guide-lead'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'

// After a signup. The guide itself arrives by email only (Lars, 2026-11-14), so there's no download here.
export const metadata: Metadata = {
  title: { absolute: 'Check Your Email | Threshold Health & Performance' },
  // A thank-you page has nothing to offer search: keep it out of the index.
  robots: { index: false, follow: true },
}

export default function GuideThankYouPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="mx-auto max-w-page px-5 pb-28 pt-16 sm:px-8 md:pb-36 md:pt-24">
          <div className="max-w-2xl">
            <h1 className="font-cormorant text-display font-medium text-ink">Check your email</h1>
            <p className="mt-8 text-lede text-ink-soft">
              Your {GUIDE.title} guide is on its way to your inbox. If you don&apos;t see it soon, check your spam
              folder, or email me at{' '}
              <a href={`mailto:${BUSINESS.email}`} className="link">
                {BUSINESS.email}
              </a>
              .
            </p>
            <p className="mt-16 border-t border-hairline pt-8 text-body text-ink-soft">
              Want a plan built around your body?{' '}
              <Link href={BOOKING_URL} className="link font-semibold">
                {DISCOVERY_CALL.label}
              </Link>
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
