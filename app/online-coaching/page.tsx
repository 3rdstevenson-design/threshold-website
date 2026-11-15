import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { pageMeta } from '@/lib/metadata'
import { BOOKING_URL } from '@/lib/booking'
import { USP_LINE, DISCOVERY_CALL } from '@/lib/site'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'

// Remote Performance Care (wiki reference-threshold-offers): the plan built around the client,
// coaching by messaging in the app, a call when it's needed, no scheduled live sessions.
// No price on the page until Lars decides to show it (docs/site-copy.md, call 4).

export const metadata: Metadata = {
  title: 'Online Coaching for Athletes and Active Adults',
  ...pageMeta({
    fullTitle: 'Online Coaching for Athletes and Active Adults | Threshold Health & Performance',
    description:
      'Online rehab and training coaching from Dr. Lars Stevenson, PT, DPT: a plan built around you, coaching in the app, and a call when you need one.',
    path: '/online-coaching',
  }),
}

const STEPS = [
  { title: 'Book a free call.', body: "Tell me what's going on and what you've tried." },
  {
    title: 'Get a plan built around you.',
    body: 'I build it from your history, your rehab so far, your goals and your training week, and set it up in the app.',
  },
  {
    title: 'Train and message me as you go.',
    body: 'Book a call when you need one. I adjust the plan as you retest.',
  },
]

const h2 = 'font-cormorant text-h2 font-medium text-ink'

export default function OnlineCoachingPage() {
  return (
    <>
      <SiteHeader current="online" />
      <main id="main" className="overflow-x-clip">
        <section className="mx-auto grid max-w-page items-end gap-12 px-5 pb-20 pt-12 sm:px-8 md:grid-cols-12 md:gap-8 md:pb-28 md:pt-20">
          <div className="md:col-span-7">
            <h1 className="font-cormorant text-display font-medium text-ink">
              Online coaching for athletes and active adults
            </h1>
            <p className="mt-8 max-w-[44ch] text-lede text-ink-soft">
              {USP_LINE} Online, I coach the rest of your rehab and your return to training: a plan built around you,
              coaching through the app, and a call when you need one.
            </p>
            <Link href={BOOKING_URL} className="btn mt-8">
              {DISCOVERY_CALL.label}
            </Link>
          </div>
          <div className="md:col-span-5">
            <div className="settle relative aspect-[4/5] overflow-hidden bg-band">
              <Image
                src="/photos/coaching-bench-spot.jpg"
                alt="Dr. Lars Stevenson spotting a client on the bench press"
                fill
                priority
                sizes="(min-width: 768px) 40vw, 100vw"
                className="object-cover object-[50%_45%]"
              />
            </div>
          </div>
        </section>

        <section className="border-t border-hairline">
          <div className="mx-auto grid max-w-page gap-8 px-5 py-24 sm:px-8 md:grid-cols-12 md:py-32">
            <h2 className={`${h2} md:col-span-5`}>Who it&apos;s for</h2>
            <div className="max-w-measure space-y-5 text-lede text-ink-soft md:col-span-6 md:col-start-7">
              <p>
                You&apos;re finishing rehab, or you finished it with less pain, and you&apos;re not back to your sport or
                your training yet.
              </p>
              <p>You&apos;re not near Reston, or you&apos;d rather train on your own schedule.</p>
            </div>
          </div>
        </section>

        <section className="bg-band">
          <div className="mx-auto grid max-w-page gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <h2 className={`${h2} md:col-span-5`}>How online coaching works</h2>
            <ol className="md:col-span-6 md:col-start-7">
              {STEPS.map((s, i) => (
                <li
                  key={s.title}
                  className="grid grid-cols-[2.5rem_1fr] gap-x-4 border-t border-[#d9d9e1] py-7 first:border-t-0 first:pt-0"
                >
                  <span aria-hidden="true" className="tabular font-cormorant text-[2.4rem] font-medium leading-[0.9] text-ink">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-nunito text-h3 font-bold text-ink">{s.title}</h3>
                    <p className="mt-2 text-body text-ink-soft">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section>
          <div className="mx-auto grid max-w-page items-center gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <div className="md:col-span-6">
              <h2 className={h2}>Coaching, and when you need more</h2>
              <p className="mt-6 max-w-measure text-lede text-ink-soft">
                Online coaching is coaching. If what you need is hands-on treatment, I&apos;ll tell you, and help you get
                it, in person with me or with someone near you.
              </p>
              <h2 className={`${h2} mt-16`}>Start with a free call</h2>
              <Link href={BOOKING_URL} className="btn mt-8">
                {DISCOVERY_CALL.label}
              </Link>
            </div>
            <div className="md:col-span-5 md:col-start-8">
              <div className="relative aspect-[4/3] overflow-hidden bg-band">
                <Image
                  src="/photos/coaching-conversation.jpg"
                  alt="Dr. Lars Stevenson talking a lifter through his training"
                  fill
                  sizes="(min-width: 768px) 38vw, 100vw"
                  className="object-cover object-[55%_40%]"
                />
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
