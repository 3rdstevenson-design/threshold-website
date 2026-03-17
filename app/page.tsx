const BOOKING_URL = 'https://threshold.clientsecure.me'

// Logo mark path — the crossing curves only, for use in nav
const MARK_PATH =
  'M1674.35,464.18s-86.86-2.87-176.53,29.02c-44.21,15.72-129.8,51.59-240.99,129.98,0,0,77.76,68.47,187.49,96.12,0,0-93.91-19.04-194.32-90.68-100.41,71.64-194.32,90.68-194.32,90.68,109.73-27.66,187.49-96.12,187.49-96.12-111.19-78.39-196.79-114.26-240.99-129.98-89.68-31.89-176.53-29.02-176.53-29.02,0,0,62.16-1.99,150,31.13,135.87,51.24,231.21,131.61,231.21,131.61-152.65,109.2-358.85,123.04-368.63,123.64,132.46-7.72,210.87-23.73,283.35-46.38,72.55-22.67,128.42-51.54,128.42-51.54,0,0,55.87,28.87,128.42,51.54,72.48,22.65,150.89,38.66,283.35,46.38-9.78-.6-215.98-14.44-368.63-123.64,0,0,95.34-80.37,231.21-131.61,87.84-33.12,150-31.13,150-31.13Z'

const crossCards = [
  {
    letter: 'C',
    title: 'Clinical Assessment',
    description:
      'A systematic, joint-by-joint evaluation that finds what everyone else missed. Where it broke down, and why.',
  },
  {
    letter: 'R',
    title: 'Reconditioning',
    description:
      "Hands-on treatment that addresses the actual system that failed. It starts session one. You don't wait 3 visits to feel a difference.",
  },
  {
    letter: 'O',
    title: 'Ownership',
    description:
      'The layer most practitioners skip. Addressing the beliefs and self-concept that keep people stuck just as much as the physical problem does.',
  },
  {
    letter: 'S',
    title: 'Systematic',
    description:
      "A proven sequence behind everything. Nothing is random. You always know why we're doing what we're doing and where we're going next.",
  },
  {
    letter: 'S',
    title: 'Support',
    description:
      "Ongoing presence through the entire crossing. A real roadmap with someone who knows you as an individual and is invested in where you're going.",
  },
]

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
        <a href="#hero" className="flex items-center gap-3 group">
          <LogoMark className="h-7 w-auto text-clinical-white" />
          <span className="font-montserrat text-xs font-semibold tracking-[0.2em] text-clinical-white uppercase">
            Threshold
          </span>
        </a>
        <div className="hidden md:flex items-center gap-8">
          <a
            href="#method"
            className="font-montserrat text-xs tracking-wide text-sterling-silver hover:text-clinical-white transition-colors duration-200"
          >
            The Method
          </a>
          <a
            href="#work"
            className="font-montserrat text-xs tracking-wide text-sterling-silver hover:text-clinical-white transition-colors duration-200"
          >
            The Work
          </a>
          <a
            href={BOOKING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-montserrat text-xs font-semibold tracking-wider text-clinical-white bg-threshold-purple px-5 py-2.5 hover:bg-purple-800 transition-colors duration-200"
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

function CrossCard({
  card,
}: {
  card: { letter: string; title: string; description: string }
}) {
  return (
    <div className="bg-deep-navy border-t-2 border-threshold-purple p-7 md:p-8 flex flex-col gap-4">
      <p className="font-montserrat text-xs font-bold tracking-[0.3em] text-threshold-purple uppercase">
        {card.letter}
      </p>
      <h3 className="font-cormorant text-2xl md:text-3xl font-medium text-clinical-white leading-tight">
        {card.title}
      </h3>
      <p className="font-nunito text-sm md:text-base text-sterling-silver leading-relaxed">
        {card.description}
      </p>
    </div>
  )
}

export default function Page() {
  return (
    <>
      <Nav />
      <main>

        {/* ─── Section 1: Hero ─── */}
        <section
          id="hero"
          className="min-h-screen bg-obsidian flex flex-col justify-center pt-16"
        >
          <div className="max-w-5xl mx-auto px-6 py-24 md:py-32">

            {/* Full logo */}
            <div className="mb-14">
              <img
                src="/logo-dark.svg"
                alt="Threshold Health and Performance"
                className="w-72 md:w-96 h-auto"
              />
            </div>

            <p
              className="font-montserrat text-xs tracking-[0.28em] text-sterling-silver uppercase mb-8"
              style={{ fontVariantCaps: 'small-caps' }}
            >
              Reston, Virginia
            </p>

            <h1 className="font-cormorant font-light text-clinical-white leading-[1.05] text-5xl md:text-7xl lg:text-[5.5rem] mb-8 max-w-4xl">
              Your threshold is higher than they told you.
            </h1>

            <p className="font-montserrat text-base md:text-lg text-sterling-silver leading-relaxed max-w-2xl mb-10">
              Physical therapy and performance coaching for people who&apos;ve
              already tried the system and are still not where they want to be.
            </p>

            <div className="font-nunito text-base md:text-lg text-sterling-silver leading-[1.85] max-w-2xl mb-14 space-y-4">
              <p>
                Most people who find Threshold have already done the work. The
                exercises. The appointments. 6 to 8 weeks of protocol, a
                printout, and a handshake.
              </p>
              <p>
                Still limited. Still told to manage it. Still not back to the
                sport, the activity, or the version of themselves that made life
                worth living.
              </p>
              <p>
                That&apos;s a care gap. Threshold exists to close it.
              </p>
            </div>

            <a
              href={BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block font-montserrat text-sm font-semibold tracking-wider text-clinical-white bg-threshold-purple px-9 py-4 hover:bg-purple-800 transition-colors duration-200"
            >
              Book Your Initial Evaluation →
            </a>
          </div>
        </section>

        {/* ─── Section 2: The Problem ─── */}
        <section id="problem" className="bg-deep-navy py-24 md:py-36">
          <div className="max-w-5xl mx-auto px-6">
            <div className="border-l-[3px] border-threshold-purple pl-8 md:pl-14">
              <p className="font-montserrat text-xs tracking-[0.35em] text-sterling-silver uppercase mb-7">
                Why You&apos;re Still Stuck
              </p>

              <h2 className="font-cormorant font-light text-clinical-white leading-tight text-3xl md:text-5xl mb-10 max-w-3xl">
                The approach had a design problem. You were just the one who
                felt it.
              </h2>

              <div className="space-y-5 font-nunito text-base md:text-lg text-sterling-silver leading-[1.85] max-w-3xl">
                <p>
                  Traditional PT runs on time constraints, diagnosis codes, and
                  generic protocols. You get 6 to 8 weeks, a printout, and a
                  follow-up appointment, whether that&apos;s what you actually
                  need or not.
                </p>
                <p>
                  The approach rarely finds what&apos;s actually driving the
                  limitation in the first place.
                </p>
                <p>
                  Treat the symptom without understanding the system behind it,
                  and you get temporary relief at best. At worst, you spend
                  years managing something that should have been resolved,
                  quietly starting to believe that&apos;s just how it&apos;s
                  going to be.
                </p>
                <p className="text-clinical-white font-semibold">
                  It isn&apos;t.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Section 3: The Method ─── */}
        <section id="method" className="bg-obsidian py-24 md:py-36">
          <div className="max-w-5xl mx-auto px-6">
            <p className="font-montserrat text-xs tracking-[0.35em] text-sterling-silver uppercase mb-7">
              The Method
            </p>

            <h2 className="font-cormorant font-light text-clinical-white leading-tight text-3xl md:text-5xl mb-6 max-w-3xl">
              The CROSS. 5 pillars. One crossing.
            </h2>

            <p className="font-nunito text-base md:text-lg text-sterling-silver leading-[1.85] max-w-3xl mb-16">
              Every client at Threshold goes through the same 5-pillar process.
              Built to restore function, rebuild confidence, and return you to
              the life that limitation interrupted.
            </p>

            {/* Row 1: C, R, O */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {crossCards.slice(0, 3).map((card) => (
                <CrossCard key={card.title} card={card} />
              ))}
            </div>

            {/* Row 2: S, S — centered on desktop */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5 lg:w-2/3 lg:mx-auto">
              {crossCards.slice(3).map((card, i) => (
                <CrossCard key={`${card.title}-${i}`} card={card} />
              ))}
            </div>
          </div>
        </section>

        {/* ─── Section 4: The Work ─── */}
        <section id="work" className="bg-deep-navy py-24 md:py-36">
          <div className="max-w-5xl mx-auto px-6">
            <p className="font-montserrat text-xs tracking-[0.35em] text-sterling-silver uppercase mb-7">
              The Work
            </p>

            <h2 className="font-cormorant font-light text-clinical-white leading-tight text-3xl md:text-5xl mb-14 max-w-3xl">
              This is what it actually produces.
            </h2>

            {/* Case study */}
            <div className="border-l-[3px] border-threshold-purple pl-8 md:pl-14 mb-16">
              <div className="space-y-4 font-nunito text-base md:text-lg text-sterling-silver leading-[1.85] max-w-3xl">
                <p>
                  A woman came in who hadn&apos;t run in 10 years. She&apos;d
                  been through the system. Multiple providers, multiple
                  diagnoses, no resolution.
                </p>
                <p>
                  9 months later she was running again. Playing soccer with her
                  kids. Calmer at work. The physical problem was one piece of
                  it. We worked through all 3.
                </p>
              </div>
            </div>

            {/* Credentials */}
            <div className="mb-20">
              <p className="font-montserrat text-sm md:text-base text-sterling-silver leading-relaxed max-w-3xl">
                <span className="text-clinical-white font-semibold">
                  Lars Stevenson, PT, DPT, CSCS
                </span>{' '}
                has worked with athletes at every level, including Olympic
                sprinters preparing for the Tokyo Games. The same principles
                that govern elite athletic development are the ones applied at
                Threshold, whether you&apos;re competing professionally or just
                trying to get back to what you love.
              </p>
            </div>

            {/* Pull quote */}
            <div className="border-t border-white/10 pt-14">
              <blockquote>
                <p className="font-cormorant italic text-champion-gold text-2xl md:text-4xl lg:text-5xl leading-snug max-w-4xl">
                  &ldquo;You&apos;re at the threshold of thinking this is just
                  how it&apos;s going to be. That&apos;s exactly where the work
                  begins.&rdquo;
                </p>
              </blockquote>
            </div>
          </div>
        </section>

        {/* ─── Section 5: Book Now ─── */}
        <section id="book" className="bg-obsidian py-24 md:py-36">
          <div className="max-w-5xl mx-auto px-6">
            <p className="font-montserrat text-xs tracking-[0.35em] text-sterling-silver uppercase mb-7">
              Start Here
            </p>

            <h2 className="font-cormorant font-light text-clinical-white leading-tight text-3xl md:text-5xl mb-8 max-w-3xl">
              Ready to find out what&apos;s actually going on?
            </h2>

            <div className="space-y-4 font-nunito text-base md:text-lg text-sterling-silver leading-[1.85] max-w-3xl mb-12">
              <p>
                Start with an Initial Evaluation. One session: a comprehensive
                assessment, a clear explanation of what we find, hands-on
                treatment, and a real plan.
              </p>
              <p>
                If Threshold Performance Care is the right fit, we&apos;ll talk
                about what that looks like. If it isn&apos;t, you&apos;ll leave
                with more clarity about your situation than any appointment
                you&apos;ve had before.
              </p>
              <p>No pressure. No protocol. Just the work.</p>
            </div>

            {/* CTA */}
            <a
              href={BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block font-montserrat text-base font-semibold tracking-wider text-clinical-white bg-threshold-purple px-11 py-5 hover:bg-purple-800 transition-colors duration-200 mb-28"
            >
              Book Your Evaluation →
            </a>

            {/* Signature */}
            <div className="border-t border-white/10 pt-14 text-center">
              <p className="font-cormorant italic text-sterling-silver text-2xl md:text-3xl mb-4">
                Be Good. Help Someone. Learn Lots.
              </p>
              <p className="font-montserrat text-xs tracking-widest text-sterling-silver uppercase">
                Lars Stevenson, PT, DPT, CSCS &nbsp;·&nbsp; Threshold Health
                &amp; Performance &nbsp;·&nbsp; Reston, Virginia
              </p>
            </div>
          </div>
        </section>

      </main>
    </>
  )
}
