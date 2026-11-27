import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { pageMeta } from '@/lib/metadata'
import { BOOKING_URL } from '@/lib/booking'
import { DISCOVERY_CALL, SITE_URL, BUSINESS } from '@/lib/site'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import Faq from '@/components/Faq'

// In-person physical therapy (Lars, 2026-11-15: the menu made it look like all he does is online coaching).
// Every fact has a source: sessions at 1908 Reston Metro Plaza (Lars, 2026-11-15); 60 minutes, face to face
// (Practice Better service "Threshold Performance Care - In-Person Session"); no visit frequency anywhere in the copy
// (Lars, 2026-11-25 and 2026-11-27); no referral needed for a DPT (Code of Virginia § 54.1-3482(B)). No prices, and no
// cost or insurance answer for now (Lars, 2026-11-15); the Good Faith Estimate notice is in the footer.
// 2026-11-19 (Search Console: "Crawled - currently not indexed"): the page read as a thin copy of the homepage, so it
// gets its own title and sections. Sources: who I see = the three groups of the 3x3 matrix (wiki
// concept-threshold-3x3-matrix, no age targeting); first visit = the homepage CROSS steps.
// 2026-11-26: the section built on the 2026-11-12 USP is gone (Lars rejected that line: not his words); its
// credentials sentence stays under "Treatment and training on one plan".
// 2026-11-25 (Lou Malmgren's SEO audit): the FAQ lives in lib/faqs.ts with every other page's, and "What I treat" names
// the conditions Lars picked, with cases from threshold-coaching-brain/my-writing/proof.md.

// Distinct from the homepage title (HOME_TITLE in lib/site.ts): this page targets "sports physical therapy" and the
// conditions, the homepage "physical therapist" and the doctorate (docs/seo-keyword-map-2026-11.md).
const PAGE_TITLE = 'Sports Physical Therapy in Reston, VA | One-on-One with a DPT'

export const metadata: Metadata = {
  ...pageMeta({
    fullTitle: PAGE_TITLE,
    description:
      'One-on-one sports physical therapy in Reston, VA with Dr. Lars Stevenson, DPT: ACL and shoulder rehab, back, neck and hip pain. No referral needed to start.',
    path: '/physical-therapy',
  }),
}

const WHO = [
  {
    title: 'Athletes who just got hurt.',
    body: "High school and college athletes, football and lacrosse especially. The goal is a complete return to your sport, and I test for it before you go back.",
  },
  {
    title: 'Professionals who never got fully healthy.',
    body: "Long hours, a lot of stress, and a body that's been sliding for a while. You want to move and feel the way you used to, and you want a plan that fits the week you actually have.",
  },
  {
    title: 'Athletes who still compete and want to stay that way.',
    body: "Pickleball, golf, lifting, running and racquet sports. I find what's likely to break down and build it up, so you can trust your body.",
  },
]

// What I treat (Lars, 2026-11-25). Each case is from threshold-coaching-brain/my-writing/proof.md; neck pain has no case
// on file, so none is claimed. No ages, and a timeline only inside a case.
const TREAT = [
  {
    title: 'Knee: ACL and meniscus.',
    body: 'Rehab after ACL and meniscus surgery, all the way through return-to-sport testing: strength side to side, hops and jumps, and change of direction. One Division I lacrosse player came back from ACL and meniscus surgery for his fifth year and now plays professionally.',
  },
  {
    title: 'Shoulder: rotator cuff and shoulder replacement.',
    body: "Rotator cuff repairs, shoulder replacements, and the shoulder that's fine doing dishes but gives out on a serve. One pickleball player was back on the court 12 weeks after her rotator cuff repair.",
  },
  {
    title: 'Low back, neck and hip pain.',
    body: 'The back that keeps flaring up, the neck that locks up after long days, and hips that limit your training. A high school football player had hip tightness that limited his training for years. He got back to training without restriction and went on to play Division I football.',
  },
  {
    title: 'Hamstrings, ankles and running.',
    body: 'Hamstring strains and tears, ankle sprains, and getting back to running, pickleball, golf or racquet sports. A high school baseball player with a torn hamstring was faster than before by the end of one summer and went on to play Division I.',
  },
]

const FIRST_VISIT = [
  'Your history: what happened, what you have tried, and what you want to get back to.',
  'A full evaluation, joint by joint, that traces the spot that hurts back to where things broke down and why.',
  'Hands-on treatment that same day, and the first exercises that hold the change in place.',
  "A plan you understand. Every exercise has a place in the sequence, and you'll know why you're doing it.",
  'Your baseline numbers, so we can retest them as you go and measure your progress.',
]

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
    title: 'Your sessions after that.',
    body: 'Hands-on treatment and the exercises that hold the change in place, on one plan I retest as you go. Between sessions, your plan lives in the app.',
  },
]

const h2 = 'font-cormorant text-h2 font-medium text-ink'

// Page-level JSON-LD: the service this page offers (provider = the site-wide MedicalBusiness in
// components/StructuredData.tsx). <Faq> adds the FAQPage block. No street address, matching the service-area profile.
const pageJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  '@id': `${SITE_URL}/physical-therapy#service`,
  name: 'One-on-one physical therapy',
  serviceType: 'Physical therapy',
  url: `${SITE_URL}/physical-therapy`,
  description:
    'In-person sports physical therapy for athletes and active adults: sports injuries, ACL and meniscus rehab, rotator cuff and shoulder replacement rehab, and low back, neck and hip pain. A full evaluation, hands-on treatment from the first visit, and 60-minute one-on-one sessions with Dr. Lars Stevenson, PT, DPT.',
  provider: { '@id': `${SITE_URL}/#business` },
  areaServed: BUSINESS.areaServed.map((name) => ({ '@type': 'City', name: `${name}, ${BUSINESS.region}` })),
}

export default function PhysicalTherapyPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageJsonLd) }} />
      <SiteHeader current="pt" />
      <main id="main" className="overflow-x-clip">
        <section className="mx-auto grid max-w-page items-end gap-12 px-5 pb-20 pt-12 sm:px-8 md:grid-cols-12 md:gap-8 md:pb-28 md:pt-20">
          <div className="md:col-span-7">
            <h1 className="font-cormorant text-display font-medium text-ink">One-on-one physical therapy in Reston</h1>
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
              <h2 className={h2}>Who I see in Reston</h2>
              <p className="mt-6 max-w-measure text-body text-ink-soft">
                Athletes and active adults from Reston, Herndon, Tysons, Fairfax, McLean and Great Falls. Most of them fit
                one of three groups.
              </p>
            </div>
            <ul className="md:col-span-6 md:col-start-7">
              {WHO.map((w) => (
                <li key={w.title} className="border-t border-[#d9d9e1] py-7 first:border-t-0 first:pt-0">
                  <h3 className="font-nunito text-h3 font-bold text-ink">{w.title}</h3>
                  <p className="mt-2 text-body text-ink-soft">{w.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t border-hairline">
          <div className="mx-auto grid max-w-page gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <div className="md:col-span-5">
              <h2 className={h2}>What I treat</h2>
              <p className="mt-6 max-w-measure text-body text-ink-soft">
                Sports injuries, surgery rehab and the pain that keeps active people out of training. If yours isn&rsquo;t
                here, ask me on the free call.
              </p>
            </div>
            <ul className="md:col-span-6 md:col-start-7">
              {TREAT.map((t) => (
                <li key={t.title} className="border-t border-[#d9d9e1] py-7 first:border-t-0 first:pt-0">
                  <h3 className="font-nunito text-h3 font-bold text-ink">{t.title}</h3>
                  <p className="mt-2 text-body text-ink-soft">{t.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="bg-band">
          <div className="mx-auto grid max-w-page gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <div className="md:col-span-5">
              <h2 className={h2}>What happens at your first visit</h2>
              <p className="mt-6 max-w-measure text-body text-ink-soft">
                Your first visit is 60 minutes with me. You leave knowing what&rsquo;s going on and what we&rsquo;re
                doing about it.
              </p>
            </div>
            <ul className="md:col-span-6 md:col-start-7">
              {FIRST_VISIT.map((item) => (
                <li key={item} className="border-t border-[#d9d9e1] py-5 text-body text-ink-soft first:border-t-0 first:pt-0">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section>
          <div className="mx-auto grid max-w-page gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <h2 className={`${h2} md:col-span-5`}>Treatment and training on one plan</h2>
            <div className="max-w-measure space-y-5 text-body text-ink-soft md:col-span-6 md:col-start-7">
              <p>
                I&rsquo;m a physical therapist with a background in strength and conditioning and exercise, with a
                concentration in nutrition. Treatment and training sit on one plan, built from your own evaluation and
                changed every time you retest.
              </p>
              <Link href={BOOKING_URL} className="btn mt-8">
                {DISCOVERY_CALL.label}
              </Link>
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

        <Faq page="physicalTherapy" path="/physical-therapy" heading="Questions about physical therapy" band />

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
