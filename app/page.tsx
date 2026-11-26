import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { pageMeta } from '@/lib/metadata'
import { HOME_TITLE, BUSINESS, USP_LINE, DISCOVERY_CALL } from '@/lib/site'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import BookingWidget from '@/components/BookingWidget'
import GuideSignup from '@/components/GuideSignup'
import Faq from '@/components/Faq'
import WordHighlight from '@/components/moments/WordHighlight'

export const metadata: Metadata = {
  ...pageMeta({
    fullTitle: HOME_TITLE,
    description:
      'Doctor of Physical Therapy in Reston, VA. Dr. Lars Stevenson, PT, DPT, takes athletes and active adults the rest of the way after the pain backs off.',
    path: '/',
  }),
}

// The CROSS method, in the order a patient goes through it (copy for Lars's approval: docs/site-copy.md).
// The letters spell the method's name, so they stand in for list numbers.
const STEPS: { letter: string; title: string; body: string }[] = [
  {
    letter: 'C',
    title: 'Assess every joint.',
    body: "A full evaluation, joint by joint, to find where things broke down and why. You leave the first visit knowing what's going on.",
  },
  {
    letter: 'R',
    title: 'Treat from the first session.',
    body: 'Hands-on treatment starts that day, along with the exercises that hold the change in place.',
  },
  {
    letter: 'O',
    title: 'Rebuild your confidence.',
    body: 'Pain changes what you believe your body can handle. Part of the work is proving to yourself that it can.',
  },
  {
    letter: 'S',
    title: 'Follow a plan with a reason.',
    body: "Every exercise has a place in the sequence, and you'll always know why you're doing it.",
  },
  {
    letter: 'S',
    title: 'Test it, then trust it.',
    body: "I retest as you go and stay with you until you're back, in person and between sessions in the app.",
  },
]

// Patient reviews, word for word. Words in [brackets] were added with each reviewer's OK (Lars, 2026-11-25).
const REVIEWS = [
  {
    quote:
      "Lars Stevenson is by far the best physical therapist I've ever worked with [for my ankle injury]. He's incredibly knowledgeable and eager to share what he knows. When I had questions between visits, he answered them promptly. I've recommended him to numerous people and will continue to do so.",
    date: 'January 2025',
  },
  {
    quote:
      'After one session I immediately felt relief from my back and hip pain. He was very detailed and clear, and gave me exercises to do at home before our next visit.',
    date: 'January 2025',
  },
  {
    quote:
      'He [treated my low back and] has the exact right mix of treatment planning, diagnosis, communication skills, technical knowledge, and the ability to challenge patients to do their best.',
    date: 'February 2025',
  },
]

const OTHER_HALF = [
  "Less pain is a milestone. The other half is getting your strength, speed and confidence back, so the shoulder that's fine doing dishes holds up on a serve.",
  'That half is what I work on. Your plan starts from your own evaluation and changes every time you retest.',
]

const tel = `tel:${BUSINESS.phone.replace(/-/g, '')}`
const h2 = 'font-cormorant text-h2 font-medium text-ink'

export default function HomePage() {
  return (
    <>
      <SiteHeader current="home" />
      <main id="main" className="overflow-x-clip">
        {/* First screen: the headline, what this is, the action, one photograph of the work. */}
        <section className="mx-auto max-w-page px-5 pb-20 pt-12 sm:px-8 md:pb-28 md:pt-20">
          <h1 className="relative z-[1] max-w-[24ch] font-cormorant text-display font-medium text-ink">{USP_LINE}</h1>
          <div className="mt-10 grid gap-12 md:mt-14 md:grid-cols-12 md:gap-8">
            <div className="md:col-span-5 md:row-start-1 lg:col-span-4">
              <p className="text-lede text-ink-soft">
                I&apos;m Dr. Lars Stevenson, a Doctor of Physical Therapy with a background in strength and
                conditioning and exercise, with a concentration in nutrition. I take athletes and active adults the rest
                of the way, on one plan built for them and tested as they go.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
                <a href="#book" className="btn">
                  {DISCOVERY_CALL.label}
                </a>
                <a href={tel} className="link tabular font-montserrat text-[0.9375rem] font-semibold">
                  Call {BUSINESS.phoneDisplay}
                </a>
              </div>
              <p className="mt-6 text-small text-muted">
                Free {DISCOVERY_CALL.minutes}-minute call. Licensed in {BUSINESS.regionName}, based in {BUSINESS.city}.
              </p>
            </div>

            {/* Headline behind you (Lars kept it, 2026-11-15): the cut-out stands over the headline's second line. */}
            <div className="relative z-[2] -mt-6 md:col-span-7 md:row-start-1 md:-mt-[clamp(3.25rem,5.6vw,5.75rem)] lg:col-span-8">
              <div className="relative aspect-[3/2]">
                <Image
                  src="/photos/hands-on-forearm-cutout.png"
                  alt="Dr. Lars Stevenson working hands-on on a client's wrist and forearm"
                  fill
                  priority
                  sizes="(min-width: 1024px) 62vw, (min-width: 768px) 58vw, 100vw"
                  className="object-contain object-bottom"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-hairline">
          <div className="mx-auto grid max-w-page gap-8 px-5 py-24 sm:px-8 md:grid-cols-12 md:py-32">
            <h2 className={`${h2} md:col-span-5`}>The other half of recovery</h2>
            <WordHighlight
              paragraphs={OTHER_HALF}
              className="max-w-measure space-y-5 text-lede text-ink-soft md:col-span-6 md:col-start-7"
            />
          </div>
        </section>

        <section id="how-i-work" className="bg-band">
          <div className="mx-auto grid max-w-page gap-14 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <div className="md:col-span-5">
              <div className="md:sticky md:top-28">
                <h2 className={h2}>How I work with you</h2>
                <p className="mt-5 max-w-[34ch] text-lede text-ink-soft">
                  Every patient goes through the same five parts, in this order. I call it the CROSS method.
                </p>
                <div className="relative mt-10 aspect-[4/3] overflow-hidden bg-hairline">
                  <Image
                    src="/photos/shoulder-assessment.jpg"
                    alt="Dr. Lars Stevenson assessing a client's shoulder"
                    fill
                    sizes="(min-width: 768px) 38vw, 100vw"
                    className="object-cover object-[55%_35%]"
                  />
                </div>
              </div>
            </div>
            <ol className="md:col-span-6 md:col-start-7">
              {STEPS.map((step, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[3rem_1fr] gap-x-5 border-t border-[#d9d9e1] py-8 first:border-t-0 first:pt-0 sm:grid-cols-[3.75rem_1fr]"
                >
                  <span
                    aria-hidden="true"
                    className="font-cormorant text-[2.9rem] font-medium leading-[0.85] text-ink sm:text-[3.4rem]"
                  >
                    {step.letter}
                  </span>
                  <div>
                    <h3 className="font-nunito text-h3 font-bold text-ink">{step.title}</h3>
                    <p className="mt-2 max-w-measure text-body text-ink-soft">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-page px-5 py-24 sm:px-8 md:py-32">
          <h2 className={h2}>Results and reviews</h2>
          <div className="mt-12 grid gap-14 md:grid-cols-12 md:gap-8">
            <div className="md:col-span-6">
              <p className="max-w-measure text-lede text-ink-soft md:sticky md:top-28">
                A high school football player came in with hip tightness that had limited his training for years.
                He&apos;d picked up advice from coaches and trainers, and nothing had fixed it. I evaluated him, found
                where the system had broken down, and started treatment that day, built around his body and his sport.
                He got back to training without restriction and went on to play Division I college football.
              </p>
            </div>
            <div className="space-y-10 md:col-span-5 md:col-start-8">
              {REVIEWS.map((r, i) => (
                <figure key={i} className="border-t border-hairline pt-6 first:border-t-0 first:pt-0">
                  <blockquote className="font-cormorant text-[1.4rem] font-medium leading-[1.4] text-ink">
                    &ldquo;{r.quote}&rdquo;
                  </blockquote>
                  <figcaption className="mt-3 text-small text-muted">Patient review, {r.date}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-band">
          <div className="mx-auto grid max-w-page items-center gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <div className="md:col-span-5">
              <div className="relative aspect-[4/5] overflow-hidden bg-hairline">
                <Image
                  src="/photos/lars-treating-hip.jpg"
                  alt="Dr. Lars Stevenson treating a patient's hip"
                  fill
                  sizes="(min-width: 768px) 40vw, 100vw"
                  className="object-cover object-[50%_30%]"
                />
              </div>
            </div>
            <div className="md:col-span-6 md:col-start-7">
              <h2 className={h2}>Dr. Lars Stevenson, PT, DPT</h2>
              <div className="mt-6 max-w-measure space-y-5 text-lede text-ink-soft">
                <p>
                  I grew up an Air Force kid and played football from age 7 through Division III at St. Olaf College. I
                  was top 5 on my team in every lift and barely played, which is a big part of why I train athletes the
                  way I do.
                </p>
                <p>
                  At 20 I started an apprenticeship with a strength coach, and I&apos;ve coached everyone from middle
                  school athletes all the way up to the Olympic stage. Every session is with me, start to finish, with
                  no techs or aides.
                </p>
              </div>
              <Link href="/about" className="link mt-8 inline-block font-montserrat text-[0.9375rem] font-semibold">
                Read my story
              </Link>
            </div>
          </div>
        </section>

        <section id="guide" className="mx-auto max-w-page px-5 py-24 sm:px-8 md:py-32">
          <div className="grid gap-12 md:grid-cols-12 md:gap-8">
            <div className="md:col-span-5">
              <h2 className={h2}>A free guide to stretching smarter</h2>
              <p className="mt-5 max-w-measure text-lede text-ink-soft">
                Stretch Smarter is my 15-page guide to the BAAD model: the 4 things that decide whether a stretch
                changes anything (breathing, angle, amplitude and duration), with a body-region guide and a 4&#8209;week
                plan.
              </p>
            </div>
            <div className="md:col-span-6 md:col-start-7 md:pt-2">
              <GuideSignup />
            </div>
          </div>
        </section>

        <section className="bg-band">
          <div className="mx-auto grid max-w-page items-center gap-10 px-5 py-20 sm:px-8 md:grid-cols-12 md:gap-8 md:py-24">
            <div className="md:col-span-4">
              <div className="relative aspect-[4/5] overflow-hidden bg-hairline">
                <Image
                  src="/photos/coaching-bench-spot.jpg"
                  alt="Dr. Lars Stevenson spotting a client on the bench press"
                  fill
                  sizes="(min-width: 768px) 32vw, 100vw"
                  className="object-cover object-[50%_45%]"
                />
              </div>
            </div>
            <div className="md:col-span-6 md:col-start-7">
              <h2 className={h2}>Online coaching, wherever you train</h2>
              <p className="mt-5 max-w-measure text-lede text-ink-soft">
                Not near Reston? I coach your return to training online, after rehab: a plan built around you, coaching
                in the app, and a call when you need one.
              </p>
              <Link
                href="/online-coaching"
                className="link mt-6 inline-block font-montserrat text-[0.9375rem] font-semibold"
              >
                See online coaching
              </Link>
            </div>
          </div>
        </section>

        <section id="book" className="mx-auto max-w-page px-5 py-24 sm:px-8 md:py-32">
          <div className="grid gap-12 md:grid-cols-12 md:gap-8">
            <div className="md:col-span-4">
              <h2 className={h2}>Book a free {DISCOVERY_CALL.minutes}&#8209;minute call</h2>
              <p className="mt-5 text-lede text-ink-soft">
                Tell me what&apos;s going on and what you&apos;ve tried. If I&apos;m the right person for it, the next
                step is your evaluation. If I&apos;m not, I&apos;ll tell you who is.
              </p>
              <p className="mt-6 text-small text-muted">
                Rather call?{' '}
                <a href={tel} className="link tabular">
                  {BUSINESS.phoneDisplay}
                </a>
              </p>
              <p className="mt-12 font-cormorant text-[1.6rem] font-medium italic leading-snug text-ink">
                Be Good. Help Someone. Learn Lots.
              </p>
              <p className="mt-1 text-small text-muted">Dr. Lars Stevenson</p>
            </div>
            <div className="md:col-span-8 md:col-start-5 lg:col-span-7 lg:col-start-6">
              <BookingWidget />
            </div>
          </div>
        </section>

        <Faq page="home" path="/" band />
      </main>
      <SiteFooter />
    </>
  )
}
