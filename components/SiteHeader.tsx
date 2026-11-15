import Link from 'next/link'
import LogoMark from '@/components/LogoMark'
import { BOOKING_URL } from '@/lib/booking'
import { DISCOVERY_CALL } from '@/lib/site'

// One header for every public page. Same links everywhere; the phone menu is a <details>
// disclosure, so it works with no JavaScript. Pass `current` to mark the page you're on.
// (Named SiteHeader so it doesn't collide with the blog branch's SiteNav.tsx.)

export type NavKey = 'home' | 'how' | 'online' | 'about' | 'book'

const LINKS: { key: NavKey; href: string; label: string }[] = [
  { key: 'how', href: '/#how-i-work', label: 'How I work' },
  { key: 'online', href: '/online-coaching', label: 'Online coaching' },
  { key: 'about', href: '/about', label: 'About' },
]

export default function SiteHeader({ current }: { current?: NavKey }) {
  return (
    <header className="sticky top-0 z-50 border-b border-hairline bg-paper">
      <div className="mx-auto flex h-[4.5rem] max-w-page items-center justify-between gap-6 px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-3" aria-label="Threshold Health & Performance, home">
          <LogoMark className="h-6 w-auto text-purple-logo transition-colors duration-150 group-hover:text-purple" />
          <span className="font-cormorant text-[1.35rem] font-semibold leading-none text-ink">
            Threshold<span className="hidden sm:inline"> Health &amp; Performance</span>
          </span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              aria-current={current === l.key ? 'page' : undefined}
              className="py-2 font-montserrat text-[0.9375rem] font-medium text-ink-soft underline-offset-[0.35em] transition-colors duration-150 hover:text-ink hover:underline aria-[current=page]:text-ink aria-[current=page]:underline"
            >
              {l.label}
            </Link>
          ))}
          <Link href={BOOKING_URL} className="btn !min-h-[2.75rem] !px-5" aria-current={current === 'book' ? 'page' : undefined}>
            {DISCOVERY_CALL.label}
          </Link>
        </nav>

        <div className="flex items-center gap-3 md:hidden">
          {/* Phones: "Book a free call" wrapped to 3 lines at 375px, so the label shortens to fit on one line. */}
          <Link
            href={BOOKING_URL}
            aria-label={DISCOVERY_CALL.label}
            className="btn !min-h-[2.75rem] whitespace-nowrap !px-3 !text-[0.875rem]"
          >
            <span className="min-[390px]:hidden">Book</span>
            <span className="hidden min-[390px]:inline">Book a call</span>
          </Link>
          <details className="group relative">
            <summary className="flex h-11 cursor-pointer list-none items-center px-2 font-montserrat text-[0.9375rem] font-medium text-ink [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Menu</span>
              <span className="hidden group-open:inline">Close</span>
            </summary>
            <nav
              aria-label="Main"
              className="absolute right-0 top-[calc(100%+0.85rem)] w-60 border border-hairline bg-paper py-2 shadow-[0_12px_32px_-12px_rgba(13,13,24,0.25)]"
            >
              <Link href="/" className="block px-5 py-3 font-montserrat text-base text-ink">
                Home
              </Link>
              {LINKS.map((l) => (
                <Link
                  key={l.key}
                  href={l.href}
                  aria-current={current === l.key ? 'page' : undefined}
                  className="block px-5 py-3 font-montserrat text-base text-ink aria-[current=page]:text-purple"
                >
                  {l.label}
                </Link>
              ))}
              <Link href="/contact" className="block px-5 py-3 font-montserrat text-base text-ink">
                Contact
              </Link>
            </nav>
          </details>
        </div>
      </div>
    </header>
  )
}
