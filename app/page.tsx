import React from 'react'

const BOOKING_URL = 'https://threshold.clientsecure.me'

// Logo mark path — the crossing curves only, for use in nav / watermark
const MARK_PATH =
  'M1674.35,464.18s-86.86-2.87-176.53,29.02c-44.21,15.72-129.8,51.59-240.99,129.98,0,0,77.76,68.47,187.49,96.12,0,0-93.91-19.04-194.32-90.68-100.41,71.64-194.32,90.68-194.32,90.68,109.73-27.66,187.49-96.12,187.49-96.12-111.19-78.39-196.79-114.26-240.99-129.98-89.68-31.89-176.53-29.02-176.53-29.02,0,0,62.16-1.99,150,31.13,135.87,51.24,231.21,131.61,231.21,131.61-152.65,109.2-358.85,123.04-368.63,123.64,132.46-7.72,210.87-23.73,283.35-46.38,72.55-22.67,128.42-51.54,128.42-51.54,0,0,55.87,28.87,128.42,51.54,72.48,22.65,150.89,38.66,283.35,46.38-9.78-.6-215.98-14.44-368.63-123.64,0,0,95.34-80.37,231.21-131.61,87.84-33.12,150-31.13,150-31.13Z'

// Floating light particles — drift class: fl=far-left, l=left, c=center, r=right, fr=far-right
const heroParticles = [
  { x: '6%',  y: '75%', dur: '14s', del: '0s',   size: 4, cls: 'p-fl' },
  { x: '15%', y: '60%', dur: '11s', del: '1.8s', size: 3, cls: 'p-l'  },
  { x: '24%', y: '80%', dur: '16s', del: '0.5s', size: 5, cls: 'p-fl' },
  { x: '34%', y: '65%', dur: '9s',  del: '3.2s', size: 3, cls: 'p-r'  },
  { x: '44%', y: '78%', dur: '13s', del: '1.5s', size: 4, cls: 'p-c'  },
  { x: '54%', y: '62%', dur: '12s', del: '4.0s', size: 3, cls: 'p-r'  },
  { x: '64%', y: '72%', dur: '15s', del: '0.8s', size: 4, cls: 'p-fr' },
  { x: '74%', y: '58%', dur: '10s', del: '2.8s', size: 3, cls: 'p-r'  },
  { x: '84%', y: '76%', dur: '14s', del: '5.5s', size: 4, cls: 'p-fr' },
  { x: '92%', y: '63%', dur: '11s', del: '6.2s', size: 3, cls: 'p-fr' },
  { x: '10%', y: '50%', dur: '13s', del: '0.3s', size: 3, cls: 'p-l'  },
  { x: '42%', y: '55%', dur: '12s', del: '3.5s', size: 4, cls: 'p-c'  },
  { x: '70%', y: '48%', dur: '10s', del: '7.1s', size: 3, cls: 'p-r'  },
  { x: '30%', y: '45%', dur: '16s', del: '2.2s', size: 5, cls: 'p-l'  },
  { x: '58%', y: '52%', dur: '9s',  del: '4.8s', size: 3, cls: 'p-fr' },
  { x: '80%', y: '40%', dur: '15s', del: '1.2s', size: 4, cls: 'p-fr' },
  { x: '20%', y: '42%', dur: '12s', del: '8.1s', size: 3, cls: 'p-fl' },
  { x: '50%', y: '38%', dur: '11s', del: '3.9s', size: 4, cls: 'p-c'  },
]

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

const larsCredentials = [
  { stat: 'Olympic',  label: 'Athlete Prep',            detail: 'Tokyo Games 2021' },
  { stat: '1:1',      label: 'Direct Care Only',         detail: 'No techs. No aides.' },
  { stat: 'DPT',      label: 'Doctor of Physical Therapy', detail: 'S&C background' },
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
          <LogoMark className="h-7 w-auto text-clinical-white group-hover:text-threshold-purple transition-colors duration-300" />
          <span className="font-montserrat text-xs font-semibold tracking-[0.2em] text-clinical-white uppercase">
            Threshold
          </span>
        </a>
        <div className="hidden md:flex items-center gap-8">
          <a
            href="#method"
            className="font-montserrat text-xs tracking-wide text-sterling-silver hover:text-clinical-white transition-colors duration-200"
          >
            The CROSS Method
          </a>
          <a
            href="#lars"
            className="font-montserrat text-xs tracking-wide text-sterling-silver hover:text-clinical-white transition-colors duration-200"
          >
            The Work
          </a>
          <a
            href="/about"
            className="font-montserrat text-xs tracking-wide text-sterling-silver hover:text-clinical-white transition-colors duration-200"
          >
            About
          </a>
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

function CrossCard({
  card,
}: {
  card: { letter: string; title: string; description: string }
}) {
  return (
    <div className="cross-card-glow bg-deep-navy border-t-2 border-threshold-purple p-7 md:p-8 flex flex-col gap-4">
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
          className="relative min-h-screen hero-spotlight overflow-hidden flex flex-col justify-center pt-16"
        >
          {/* Drifting light beam */}
          <div className="hero-beam" aria-hidden="true" />

          {/* Floating light particles */}
          <div
            className="absolute inset-0 overflow-hidden pointer-events-none"
            aria-hidden="true"
          >
            {heroParticles.map((p, i) => (
              <span
                key={i}
                className={`particle ${p.cls}`}
                style={{
                  left: p.x,
                  top: p.y,
                  width: `${p.size}px`,
                  height: `${p.size}px`,
                  animationDuration: p.dur,
                  animationDelay: p.del,
                }}
              />
            ))}
          </div>

          <div className="relative z-10 max-w-5xl mx-auto px-6 py-24 md:py-32">

            {/* Logo with glow */}
            <div className="logo-glow mb-14">
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
              already done the work and still aren&apos;t where they need to be.
            </p>

            <div className="font-nunito text-base md:text-lg text-sterling-silver leading-[1.85] max-w-2xl mb-14 space-y-4">
              <p>
                If you found Threshold, you&apos;ve probably been through the
                whole thing. The exercises, the appointments, 6 to 8 weeks of
                protocol, a printout, and a handshake.
              </p>
              <p>
                You&apos;re still limited. Still told to manage it. Still not
                back to the sport, the activity, or the version of yourself
                that made life worth living.
              </p>
              <p>
                That&apos;s the Threshold. I&apos;m here to help you cross it.
              </p>
            </div>

            <a
              href={BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block font-montserrat text-sm font-semibold tracking-wider text-clinical-white bg-threshold-purple px-9 py-4 hover:bg-purple-800 transition-all duration-200 btn-glow"
            >
              Book Your Initial Evaluation →
            </a>
          </div>

          {/* Gradient fade into next section */}
          <div
            className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-b from-transparent to-deep-navy pointer-events-none"
            aria-hidden="true"
          />
        </section>

        {/* ─── Section 2: The Problem ─── */}
        <section id="problem" className="relative bg-deep-navy py-24 md:py-36">
          <div className="section-glow-purple" aria-hidden="true" />
          <div className="relative max-w-5xl mx-auto px-6">
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
              The CROSS Method
            </p>

            <h2 className="font-cormorant font-light text-clinical-white leading-tight text-3xl md:text-5xl mb-6 max-w-3xl">
              One crossing. No shortcuts.
            </h2>

            <p className="font-nunito text-base md:text-lg text-sterling-silver leading-[1.85] max-w-3xl mb-16">
              Every person I work with goes through the same proven sequence.
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

        {/* ─── Section 5: Meet Lars ─── */}
        <section id="lars" className="relative lars-spotlight py-24 md:py-36 overflow-hidden">

          {/* Watermark logo mark */}
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            aria-hidden="true"
          >
            <LogoMark className="w-[700px] h-auto text-threshold-purple opacity-[0.055]" />
          </div>

          <div className="relative z-10 max-w-5xl mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">

              {/* Image column */}
              <div className="relative flex items-center justify-center order-2 lg:order-1">
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
                  src="/lars-smile.png"
                  alt="Dr. Lars Stevenson"
                  className="relative z-10 w-full h-auto object-contain"
                  style={{ maxHeight: '680px' }}
                />
              </div>

              {/* Text column */}
              <div className="order-1 lg:order-2">
                <p className="font-montserrat text-xs tracking-[0.35em] text-sterling-silver uppercase mb-7">
                  The Practitioner
                </p>

                <h2 className="font-cormorant font-light text-clinical-white leading-[1.0] text-4xl md:text-6xl lg:text-7xl mb-4">
                  Dr. Lars Stevenson
                </h2>

                <p className="font-montserrat text-xs tracking-[0.22em] text-threshold-purple uppercase mb-10">
                  PT, DPT &nbsp;·&nbsp; Strength &amp; Conditioning &nbsp;·&nbsp; Reston, Virginia
                </p>

                {/* Credential callout cards */}
                <div className="grid grid-cols-3 gap-3 mb-10">
                  {larsCredentials.map((item) => (
                    <div
                      key={item.label}
                      className="border border-white/10 bg-white/[0.03] p-4 text-center"
                    >
                      <p className="font-cormorant text-3xl md:text-4xl text-threshold-purple mb-1 stat-glow">
                        {item.stat}
                      </p>
                      <p className="font-montserrat text-[10px] font-semibold tracking-widest text-clinical-white uppercase mb-1">
                        {item.label}
                      </p>
                      <p className="font-nunito text-[10px] text-sterling-silver">
                        {item.detail}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="space-y-4 font-nunito text-base md:text-lg text-sterling-silver leading-[1.85] max-w-lg mb-10">
                  <p>
                    Lars started interning under an Olympic performance coach as
                    a teenager. He learned sprint mechanics, weight room
                    technique, and injury rehab from the inside out.
                  </p>
                  <p>
                    By the time he finished his doctorate, he&apos;d worked with
                    sprinters prepping for the Tokyo Games. That same process is
                    what runs every session at Threshold.
                  </p>
                  <p>
                    His background is S&amp;C and physical therapy. What
                    separates him is the system: a joint-by-joint evaluation
                    that finds what everyone else missed, and a method for
                    working through all 3 layers of why something isn&apos;t
                    resolving.
                  </p>
                  <p className="text-clinical-white font-semibold">
                    1:1 care only. No techs. No handoffs. Every session is him.
                  </p>
                </div>

                <a
                  href={BOOKING_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block font-montserrat text-sm font-semibold tracking-wider text-clinical-white bg-threshold-purple px-9 py-4 hover:bg-purple-800 transition-all duration-200 btn-glow"
                >
                  Book With Dr. Stevenson →
                </a>
              </div>

            </div>
          </div>
        </section>

        {/* ─── Section 6: Book Now ─── */}
        <section id="book" className="relative bg-obsidian py-24 md:py-36 overflow-hidden">

          {/* Ambient glow */}
          <div className="book-glow absolute inset-0 pointer-events-none" aria-hidden="true" />

          <div className="relative z-10 max-w-5xl mx-auto px-6">
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
              className="inline-block font-montserrat text-base font-semibold tracking-wider text-clinical-white bg-threshold-purple px-11 py-5 hover:bg-purple-800 transition-all duration-200 btn-glow mb-28"
            >
              Book Your Evaluation →
            </a>

            {/* Signature */}
            <div className="border-t border-white/10 pt-14 text-center">
              <p className="font-cormorant italic text-sterling-silver text-2xl md:text-3xl mb-4">
                Be Good. Help Someone. Learn Lots.
              </p>
              <p className="font-montserrat text-xs tracking-widest text-sterling-silver uppercase">
                Dr. Lars Stevenson, PT, DPT &nbsp;·&nbsp; Threshold Health
                &amp; Performance &nbsp;·&nbsp; Reston, Virginia
              </p>
            </div>
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
