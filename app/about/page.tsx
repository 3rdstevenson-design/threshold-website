import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'About Dr. Lars Stevenson | Threshold Health & Performance',
  description:
    'Doctor of Physical Therapy and Strength & Conditioning specialist. Olympic-level methods applied to everyone trying to get back to what they love.',
}

const BOOKING_URL = 'https://threshold.clientsecure.me'

const MARK_PATH =
  'M1674.35,464.18s-86.86-2.87-176.53,29.02c-44.21,15.72-129.8,51.59-240.99,129.98,0,0,77.76,68.47,187.49,96.12,0,0-93.91-19.04-194.32-90.68-100.41,71.64-194.32,90.68-194.32,90.68,109.73-27.66,187.49-96.12,187.49-96.12-111.19-78.39-196.79-114.26-240.99-129.98-89.68-31.89-176.53-29.02-176.53-29.02,0,0,62.16-1.99,150,31.13,135.87,51.24,231.21,131.61,231.21,131.61-152.65,109.2-358.85,123.04-368.63,123.64,132.46-7.72,210.87-23.73,283.35-46.38,72.55-22.67,128.42-51.54,128.42-51.54,0,0,55.87,28.87,128.42,51.54,72.48,22.65,150.89,38.66,283.35,46.38-9.78-.6-215.98-14.44-368.63-123.64,0,0,95.34-80.37,231.21-131.61,87.84-33.12,150-31.13,150-31.13Z'

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
            className="font-montserrat text-xs tracking-wide text-clinical-white hover:text-threshold-purple transition-colors duration-200"
          >
            About
          </Link>
          <a
            href={BOOKING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-montserrat text-xs font-semibold tracking-wider text-clinical-white bg-threshold-purple px-5 py-2.5 hover:bg-purple-800 transition-all duration-200 btn-glow"
          >
            Book Now
          </a>
        </div>
        <a
          href={BOOKING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="md:hidden font-montserrat text-xs font-semibold tracking-wider text-clinical-white bg-threshold-purple px-4 py-2 hover:bg-purple-800 transition-colors duration-200"
        >
          Book Now
        </a>
      </div>
    </nav>
  )
}

export default function AboutPage() {
  return (
    <>
      <Nav />
      <main>

        {/* ─── Hero ─── */}
        <section className="relative about-hero overflow-hidden pt-16 pb-0 min-h-[55vh] flex flex-col justify-end">
          {/* Beam */}
          <div className="hero-beam" aria-hidden="true" />

          <div className="relative z-10 max-w-5xl mx-auto px-6 pb-16 pt-24">
            <p className="font-montserrat text-xs tracking-[0.35em] text-sterling-silver uppercase mb-5">
              About
            </p>
            <h1 className="font-cormorant font-light text-clinical-white leading-[1.0] text-5xl md:text-7xl lg:text-8xl">
              Dr. Lars Stevenson
            </h1>
            <p className="font-montserrat text-xs tracking-[0.22em] text-threshold-purple uppercase mt-4">
              PT, DPT &nbsp;·&nbsp; Strength &amp; Conditioning &nbsp;·&nbsp; Reston, Virginia
            </p>
          </div>

          {/* Fade to body */}
          <div
            className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-b from-transparent to-deep-navy pointer-events-none"
            aria-hidden="true"
          />
        </section>

        {/* ─── Photo + Bio ─── */}
        <section className="bg-deep-navy py-24 md:py-32">
          <div className="max-w-5xl mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">

              {/* Photo */}
              <div className="relative flex items-center justify-center">
                {/* Glow behind the figures */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: 'radial-gradient(ellipse at 50% 70%, rgba(112,2,171,0.4) 0%, transparent 65%)',
                    filter: 'blur(40px)',
                  }}
                  aria-hidden="true"
                />
                <img
                  src="/lars-practitioner.png"
                  alt="Dr. Lars Stevenson working with a patient"
                  className="relative z-10 w-full h-auto object-contain"
                  style={{ maxHeight: '680px' }}
                />
              </div>

              {/* Bio */}
              <div className="space-y-5 font-nunito text-base md:text-lg text-sterling-silver leading-[1.85]">
                <p>
                  Lars started interning under an Olympic performance coach as a
                  teenager. He learned sprint mechanics, weight room technique, and
                  injury rehab from the inside out.
                </p>
                <p>
                  By the time he finished his doctorate, he&apos;d worked with
                  sprinters prepping for the Tokyo Games. That same process is what
                  runs every session at Threshold.
                </p>
                <p>
                  His background is S&amp;C and physical therapy. What separates him
                  is the system: a joint-by-joint evaluation that finds what everyone
                  else missed, and a method for working through all 3 layers of why
                  something isn&apos;t resolving.
                </p>
                <p>
                  He grew up in a military household. Trained for close to 15 years.
                  The gym has been the one constant through every era of his life,
                  and that obsession with how the body works is what built the
                  clinical eye he brings to Threshold.
                </p>
                <p className="text-clinical-white font-semibold">
                  1:1 care only. No techs. No handoffs. Every session is him.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Credentials strip ─── */}
        <section className="bg-obsidian py-20 border-t border-white/5">
          <div className="max-w-5xl mx-auto px-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/10">
              {[
                { stat: 'DPT',     label: 'Doctor of Physical Therapy',    sub: 'Evidence-based clinical practice' },
                { stat: 'Olympic', label: 'Athlete Preparation',           sub: 'Tokyo Games 2021' },
                { stat: '1:1',     label: 'Direct Care Every Session',     sub: 'No techs. No aides. Just the work.' },
              ].map((item) => (
                <div key={item.label} className="bg-obsidian p-10 text-center">
                  <p className="font-cormorant text-5xl md:text-6xl text-threshold-purple mb-3 stat-glow">
                    {item.stat}
                  </p>
                  <p className="font-montserrat text-xs font-semibold tracking-widest text-clinical-white uppercase mb-2">
                    {item.label}
                  </p>
                  <p className="font-nunito text-sm text-sterling-silver">
                    {item.sub}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Philosophy ─── */}
        <section className="bg-deep-navy py-24 md:py-36">
          <div className="max-w-5xl mx-auto px-6">
            <div className="border-l-[3px] border-threshold-purple pl-8 md:pl-14 mb-20">
              <p className="font-montserrat text-xs tracking-[0.35em] text-sterling-silver uppercase mb-7">
                The Philosophy
              </p>
              <h2 className="font-cormorant font-light text-clinical-white leading-tight text-3xl md:text-5xl mb-10 max-w-3xl">
                The body follows a system. Find the system, fix the problem.
              </h2>
              <div className="space-y-5 font-nunito text-base md:text-lg text-sterling-silver leading-[1.85] max-w-3xl">
                <p>
                  Most practitioners treat the symptom. Lars looks for the system
                  breakdown that caused the symptom — the joint that stopped doing
                  its job, the movement pattern that compensated, the belief that
                  calcified around the pain.
                </p>
                <p>
                  The CROSS Method is the framework that makes that possible. Five
                  pillars, one crossing — from where you are now to the life
                  limitation interrupted.
                </p>
              </div>
            </div>

            {/* Quote */}
            <blockquote className="border-t border-white/10 pt-14">
              <p className="font-cormorant italic text-champion-gold text-2xl md:text-4xl lg:text-5xl leading-snug max-w-4xl">
                &ldquo;Be Good. Help Someone. Learn Lots.&rdquo;
              </p>
              <footer className="mt-6 font-montserrat text-xs tracking-widest text-sterling-silver uppercase">
                — Dr. Lars Stevenson
              </footer>
            </blockquote>
          </div>
        </section>

        {/* ─── CTA ─── */}
        <section className="relative bg-obsidian py-24 md:py-32 overflow-hidden">
          <div className="book-glow absolute inset-0 pointer-events-none" aria-hidden="true" />
          <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
            <p className="font-montserrat text-xs tracking-[0.35em] text-sterling-silver uppercase mb-7">
              Work With Lars
            </p>
            <h2 className="font-cormorant font-light text-clinical-white leading-tight text-3xl md:text-5xl mb-8 max-w-2xl mx-auto">
              Start with one conversation.
            </h2>
            <p className="font-nunito text-base md:text-lg text-sterling-silver leading-[1.85] max-w-xl mx-auto mb-12">
              The Initial Evaluation is a full assessment, a clear explanation of
              what&apos;s driving the problem, hands-on treatment, and a real plan.
              One session. No pressure.
            </p>
            <a
              href={BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block font-montserrat text-base font-semibold tracking-wider text-clinical-white bg-threshold-purple px-11 py-5 hover:bg-purple-800 transition-all duration-200 btn-glow"
            >
              Book Your Evaluation →
            </a>
          </div>
        </section>

      </main>

      {/* ─── Footer ─── */}
      <footer className="bg-obsidian border-t border-white/10 py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <LogoMark className="h-5 w-auto text-threshold-purple" />
            <span className="font-montserrat text-xs tracking-[0.18em] text-sterling-silver uppercase">
              Threshold Health &amp; Performance
            </span>
          </div>
          <p className="font-montserrat text-xs text-sterling-silver text-center">
            Reston, Virginia &nbsp;·&nbsp;{' '}
            <a
              href={BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
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
