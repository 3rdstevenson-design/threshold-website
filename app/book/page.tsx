import type { Metadata } from 'next'
import Link from 'next/link'
import { BOOKING_URL } from '@/lib/booking'

export const metadata: Metadata = {
  title: 'Book a Session | Threshold Health & Performance',
  description:
    'Book your intro call with Dr. Lars Stevenson. 20 honest minutes about your situation, what you have already tried, and the next step forward.',
}

const MARK_PATH =
  'M1674.35,464.18s-86.86-2.87-176.53,29.02c-44.21,15.72-129.8,51.59-240.99,129.98,0,0,77.76,68.47,187.49,96.12,0,0-93.91-19.04-194.32-90.68-100.41,71.64-194.32,90.68-194.32,90.68,109.73-27.66,187.49-96.12,187.49-96.12-111.19-78.39-196.79-114.26-240.99-129.98-89.68-31.89-176.53-29.02-176.53-29.02,0,0,62.16-1.99,150,31.13,135.87,51.24,231.21,131.61,231.21,131.61-152.65,109.2-358.85,123.04-368.63,123.64,132.46-7.72,210.87-23.73,283.35-46.38,72.55-22.67,128.42-51.54,128.42-51.54,0,0,55.87,28.87,128.42,51.54,72.48,22.65,150.89,38.66,283.35,46.38-9.78-.6-215.98-14.44-368.63-123.64,0,0,95.34-80.37,231.21-131.61,87.84-33.12,150-31.13,150-31.13Z'

const WIDGET_URL =
  'https://my.practicebetter.io?fl_wtc=7002ab&fl_wtac=0d0d18#/6a0502bf701f5e74531dd463/widgets/bookings?'

function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="826 460 848 295"
      className={className}
      aria-hidden="true"
      fill="currentColor"
    >
      <path d={MARK_PATH} />
    </svg>
  )
}

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
        <div className="hidden md:flex items-center gap-8">
          <Link
            href="/#method"
            className="font-montserrat text-xs tracking-wide text-sterling-silver hover:text-clinical-white transition-colors duration-200"
          >
            The CROSS Method
          </Link>
          <Link
            href="/about"
            className="font-montserrat text-xs tracking-wide text-sterling-silver hover:text-clinical-white transition-colors duration-200"
          >
            About
          </Link>
          <span className="font-montserrat text-xs font-semibold tracking-wider text-clinical-white bg-threshold-purple px-5 py-2.5">
            Book Now
          </span>
        </div>
      </div>
    </nav>
  )
}

export default function BookPage() {
  return (
    <>
      <Nav />
      <main>

        {/* ─── Hero ─── */}
        <section className="relative bg-obsidian overflow-hidden pt-16 pb-0">
          <div className="hero-beam" aria-hidden="true" />

          <div className="relative z-10 max-w-5xl mx-auto px-6 pb-12 pt-20 md:pt-24">
            <p className="font-montserrat text-xs tracking-[0.35em] text-sterling-silver uppercase mb-5">
              Start Here
            </p>
            <h1 className="font-cormorant font-light text-clinical-white leading-[1.05] text-5xl md:text-7xl mb-8 max-w-3xl">
              Book your intro call.
            </h1>
            <div className="space-y-4 font-nunito text-base md:text-lg text-sterling-silver leading-[1.85] max-w-2xl">
              <p>
                Twenty honest minutes. We&apos;ll go through your situation, what
                you&apos;ve already tried, and build a clear picture of the steps
                you need to take.
              </p>
              <p>
                No pitch. No pressure. If I&apos;m not the right person for what
                you need, I&apos;ll tell you and point you to who is.
              </p>
            </div>
          </div>
        </section>

        {/* ─── Widget ─── */}
        <section className="bg-deep-navy py-16 md:py-20">
          <div className="max-w-3xl mx-auto px-6">
            <div className="bg-clinical-white rounded-sm shadow-2xl p-4 md:p-6">
              <iframe
                src={WIDGET_URL}
                title="Book a session with Dr. Lars Stevenson"
                className="w-full block"
                style={{ height: 850, border: 'none' }}
                scrolling="yes"
                allowFullScreen
              />
            </div>
            <p className="font-montserrat text-xs tracking-wide text-sterling-silver/70 text-center mt-6">
              Powered by Practice Better &nbsp;·&nbsp; Sessions, payments, and confirmations handled securely.
            </p>
          </div>
        </section>

      </main>

      {/* ─── Footer ─── */}
      <footer className="bg-obsidian border-t border-white/10 py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <Link href="/" className="flex items-center gap-3">
            <LogoMark className="h-5 w-auto text-threshold-purple" />
            <span className="font-montserrat text-xs tracking-[0.18em] text-sterling-silver uppercase">
              Threshold Health &amp; Performance
            </span>
          </Link>
          <p className="font-montserrat text-xs text-sterling-silver text-center">
            Reston, Virginia &nbsp;·&nbsp;{' '}
            <a
              href={BOOKING_URL}
              className="hover:text-clinical-white transition-colors duration-200"
            >
              Book an Appointment
            </a>
          </p>
          <p className="font-montserrat text-xs text-white/30">
            &copy; {new Date().getFullYear()} Threshold Health &amp; Performance
          </p>
        </div>
      </footer>
    </>
  )
}
