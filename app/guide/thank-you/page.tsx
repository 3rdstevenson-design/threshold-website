import type { Metadata } from 'next'
import Link from 'next/link'
import { BOOKING_URL } from '@/lib/booking'
import { DISCOVERY_CALL } from '@/lib/site'
import { GUIDE } from '@/lib/guide-lead'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'

export const metadata: Metadata = {
  title: { absolute: 'Your Guide Is Ready | Threshold Health & Performance' },
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
            <h1 className="font-cormorant text-display font-medium text-ink">Your guide is ready</h1>
            <p className="mt-8 text-lede text-ink-soft">
              {GUIDE.title} is yours. Download it now and save it somewhere you&apos;ll find it again.
            </p>
            <a href={GUIDE.pdfPath} className="btn mt-8" download>
              Download the guide (PDF)
            </a>
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
