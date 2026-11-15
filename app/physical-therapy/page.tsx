import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { pageMeta } from '@/lib/metadata'
import { BOOKING_URL } from '@/lib/booking'
import { DISCOVERY_CALL } from '@/lib/site'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'

// In-person physical therapy (Lars, 2026-11-15: the menu made it look like all he does is online coaching).
// Every fact has a source: sessions at 1908 Reston Metro Plaza (Lars, 2026-11-15); 60 minutes, face to face
// (Practice Better service "Threshold Performance Care - In-Person Session"); weekly or every other week (wiki
// reference-threshold-offers); cash-pay with superbills (wiki project-life-hq, how-to-build-pb-superbill); no
// referral needed for a DPT (Code of Virginia § 54.1-3482(B)). No prices on the site (Lars, 2026-11-15).

const ADDRESS = { street: '1908 Reston Metro Plaza', city: 'Reston, VA 20190' }

export const metadata: Metadata = {
  title: 'Physical Therapy in Reston, VA',
  ...pageMeta({
    fullTitle: 'Physical Therapy in Reston, VA | Threshold Health & Performance',
    description:
      'In-person physical therapy for athletes and active adults in Reston, VA: 60-minute one-on-one sessions with Dr. Lars Stevenson, PT, DPT. No referral needed.',
    path: '/physical-therapy',
  }),
}

const STEPS = [
  {
    title: 'Book a free call.',
    body: "Tell me what's going on and what you've tried. If I'm not the right person for it, I'll point you to who is.",
  },
  {
    title: 'Your first visit.',
    body: "A full evaluation, joint by joint, and your first treatment. You leave knowing what's going on.",
  },
  {
    title: 'Weekly or every other week after that.',
    body: 'Hands-on treatment and the exercises that hold the change in place, on one plan I retest as you go. Between sessions, your plan lives in the app.',
  },
]

const FAQ: { q: string; a: string; link?: { href: string; label: string } }[] = [
  { q: 'Where are sessions?', a: `${ADDRESS.street}, ${ADDRESS.city}.` },
  {
    q: 'How long is a session?',
    a: '60 minutes, and every session is with me, start to finish, with no techs or aides.',
  },
  { q: 'How often will I come in?', a: 'Weekly or every other week. I recommend one after your evaluation.' },
  {
    q: 'Do I need a referral from my doctor?',
    a: "No. In Virginia, a physical therapist with a doctorate can evaluate and treat you without one. If another provider is already treating you for the same problem, I'll ask your OK to send them my evaluation.",
  },
  {
    q: 'What does it cost, and do you take insurance?',
    a: "I go through cost on the free call, and once you book, I email you a written Good Faith Estimate. I don't bill insurance. You pay me directly, and I give you a superbill you can send your insurance company for possible out-of-network reimbursement.",
    link: { href: '/good-faith-estimate', label: 'Your right to a Good Faith Estimate' },
  },
  { q: 'What should I wear?', a: 'Clothes you can move and train in.' },
]

const h2 = 'font-cormorant text-h2 font-medium text-ink'

export default function PhysicalTherapyPage() {
  return (
    <>
      <SiteHeader current="pt" />
      <main id="main" className="overflow-x-clip">
        <section className="mx-auto grid max-w-page items-end gap-12 px-5 pb-20 pt-12 sm:px-8 md:grid-cols-12 md:gap-8 md:pb-28 md:pt-20">
          <div className="md:col-span-7">
            <h1 className="font-cormorant text-display font-medium text-ink">In-person physical therapy in Reston</h1>
            <p className="mt-8 max-w-[44ch] text-lede text-ink-soft">
              I see athletes and active adults in person in Reston. Every session is one-on-one with me for 60 minutes,
              on one plan built for you and tested as you go.
            </p>
            <Link href={BOOKING_URL} className="btn mt-8">
              {DISCOVERY_CALL.label}
            </Link>
          </div>
          <div className="md:col-span-5">
            <div className="relative aspect-[4/5] overflow-hidden bg-band">
              <Image
                src="/photos/shoulder-assessment.jpg"
                alt="Dr. Lars Stevenson assessing a client's shoulder"
                fill
                priority
                sizes="(min-width: 768px) 40vw, 100vw"
                className="object-cover object-[55%_35%]"
              />
            </div>
          </div>
        </section>

        <section className="border-t border-hairline">
          <div className="mx-auto grid max-w-page gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <div className="md:col-span-5">
              <h2 className={h2}>How in-person care works</h2>
              <Link
                href="/#how-i-work"
                className="link mt-6 inline-block font-montserrat text-[0.9375rem] font-semibold"
              >
                See how I work
              </Link>
            </div>
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

        <section className="bg-band">
          <div className="mx-auto grid max-w-page gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <h2 className={`${h2} md:col-span-5`}>Questions people ask</h2>
            <dl className="md:col-span-6 md:col-start-7">
              {FAQ.map((f) => (
                <div key={f.q} className="border-t border-[#d9d9e1] py-7 first:border-t-0 first:pt-0">
                  <dt className="font-nunito text-h3 font-bold text-ink">{f.q}</dt>
                  <dd className="mt-2 text-body text-ink-soft">
                    <p>{f.a}</p>
                    {f.link && (
                      <p className="mt-3">
                        <Link href={f.link.href} className="link">
                          {f.link.label}
                        </Link>
                      </p>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section>
          <div className="mx-auto grid max-w-page items-center gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <div className="md:col-span-6">
              {/* Lars, 2026-11-15. Online wording rule: rehab is the stage after the client's own clinician. */}
              <h2 className={h2}>Not near Reston?</h2>
              <p className="mt-6 max-w-measure text-lede text-ink-soft">
                I coach your return to training online, after rehab: a plan built around you, coaching in the app, and a
                call when you need one.
              </p>
              <Link
                href="/online-coaching"
                className="link mt-6 inline-block font-montserrat text-[0.9375rem] font-semibold"
              >
                See online coaching
              </Link>
              <h2 className={`${h2} mt-16`}>Start with a free call</h2>
              <Link href={BOOKING_URL} className="btn mt-8">
                {DISCOVERY_CALL.label}
              </Link>
            </div>
            <div className="md:col-span-5 md:col-start-8">
              <div className="relative aspect-[4/3] overflow-hidden bg-band">
                <Image
                  src="/photos/strength-test.jpg"
                  alt="Dr. Lars Stevenson testing a client's forearm strength"
                  fill
                  sizes="(min-width: 768px) 38vw, 100vw"
                  className="object-cover object-[40%_40%]"
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
