import Link from 'next/link'
import LogoMark from '@/components/LogoMark'
import InstagramLink from '@/components/InstagramLink'
import { BOOKING_URL } from '@/lib/booking'
import { SITE_NAME, BUSINESS } from '@/lib/site'

const linkClass = 'hover:text-clinical-white transition-colors duration-200'

// One footer for every public page: name, city, phone, booking, Instagram,
// and the legal links. Replaces four hand-copied footers.
export default function SiteFooter() {
  return (
    <footer className="bg-obsidian border-t border-white/10 py-10">
      <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-3">
          <LogoMark className="h-5 w-auto text-threshold-purple" />
          <span className="font-montserrat text-xs tracking-[0.18em] text-sterling-silver uppercase">
            Threshold Health &amp; Performance
          </span>
        </Link>
        <p className="font-montserrat text-xs text-sterling-silver text-center leading-relaxed">
          {BUSINESS.city}, {BUSINESS.regionName} &nbsp;·&nbsp;{' '}
          <a href={`tel:${BUSINESS.phone.replace(/-/g, '')}`} className={linkClass}>
            {BUSINESS.phoneDisplay}
          </a>{' '}
          &nbsp;·&nbsp;{' '}
          <Link href={BOOKING_URL} className={linkClass}>
            Book an Appointment
          </Link>
        </p>
        <InstagramLink
          showHandle
          className={`font-montserrat text-xs text-sterling-silver ${linkClass}`}
        />
      </div>
      <div className="max-w-6xl mx-auto px-6 mt-6 pt-6 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
        <nav
          aria-label="Legal"
          className="font-montserrat text-xs text-sterling-silver flex flex-wrap items-center justify-center gap-x-4 gap-y-2"
        >
          <Link href="/contact" className={linkClass}>
            Contact
          </Link>
          <span className="text-white/20">·</span>
          <Link href="/privacy-policy" className={linkClass}>
            Privacy Policy
          </Link>
          <span className="text-white/20">·</span>
          <Link href="/terms-and-conditions" className={linkClass}>
            Terms &amp; Conditions
          </Link>
          <span className="text-white/20">·</span>
          <Link href="/sms-policy" className={linkClass}>
            SMS Policy
          </Link>
        </nav>
        <p className="font-montserrat text-xs text-white/30">
          &copy; {new Date().getFullYear()} {SITE_NAME}
        </p>
      </div>
    </footer>
  )
}
