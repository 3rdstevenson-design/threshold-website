import Link from 'next/link'
import InstagramLink from '@/components/InstagramLink'
import { BOOKING_URL } from '@/lib/booking'
import { SITE_NAME, BUSINESS, DISCOVERY_CALL } from '@/lib/site'

// One footer for every public page: the logo (its only appearance), how to reach Lars,
// the site links and the legal links. Dark, the one dark surface in the light system.

const linkCls = 'text-clinical-white/90 underline-offset-[0.25em] transition-colors duration-150 hover:text-white hover:underline'

export default function SiteFooter() {
  return (
    <footer className="bg-ink text-clinical-white">
      <div className="mx-auto grid max-w-page gap-12 px-5 py-16 sm:px-8 md:grid-cols-12 md:py-20">
        <div className="md:col-span-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.svg" alt={SITE_NAME} width={208} height={97} className="h-auto w-44" />
          <address className="mt-8 space-y-1.5 text-small not-italic text-night-muted">
            <p>Physical therapy in {BUSINESS.city}, {BUSINESS.regionName}</p>
            <p>
              <a href={`tel:${BUSINESS.phone.replace(/-/g, '')}`} className={`${linkCls} tabular`}>
                {BUSINESS.phoneDisplay}
              </a>
            </p>
            <p>
              <a href={`mailto:${BUSINESS.email}`} className={linkCls}>
                {BUSINESS.email}
              </a>
            </p>
            <p>
              <InstagramLink showHandle iconClassName="h-4 w-4" className={linkCls} />
            </p>
          </address>
        </div>

        <nav aria-label="Site" className="md:col-span-3">
          <ul className="space-y-3 font-montserrat text-[0.9375rem]">
            <li><Link href="/#how-i-work" className={linkCls}>How I work</Link></li>
            <li><Link href="/online-coaching" className={linkCls}>Online coaching</Link></li>
            <li><Link href="/about" className={linkCls}>About</Link></li>
            <li><Link href={BOOKING_URL} className={linkCls}>{DISCOVERY_CALL.label}</Link></li>
            <li><Link href="/contact" className={linkCls}>Contact</Link></li>
          </ul>
        </nav>

        <nav aria-label="Legal" className="md:col-span-4">
          <ul className="space-y-3 font-montserrat text-[0.9375rem]">
            <li><Link href="/privacy-policy" className={linkCls}>Privacy Policy</Link></li>
            <li><Link href="/terms-and-conditions" className={linkCls}>Terms &amp; Conditions</Link></li>
            <li><Link href="/sms-policy" className={linkCls}>SMS Policy</Link></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-page px-5 py-6 text-small text-night-muted sm:px-8">
          &copy; {new Date().getFullYear()} {SITE_NAME}
        </p>
      </div>
    </footer>
  )
}
