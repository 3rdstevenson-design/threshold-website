import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { pageMeta } from '@/lib/metadata'
import { BOOKING_URL } from '@/lib/booking'
import { DISCOVERY_CALL, SITE_URL, BUSINESS } from '@/lib/site'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import Faq from '@/components/Faq'

// ACL physical therapy (Lars, 2026-11-27: "Just do both", the ACL page and the back and neck page, after the Keyword
// Planner rounds). It targets "physical therapy for acl", "...acl tear", "...acl injury" and "acl tear treatment physical
// therapy", 100 to 1K a month each in Northern Virginia (marketing-agent/agent/seo/2026-11-27-condition-pages-targets.md);
// the Physical therapy page keeps "physical therapy in Reston, VA" (docs/seo-keyword-map-2026-11.md).
// Copy: threshold-coaching-brain/campaigns/website-seo-2026-11/2026-11-27-acl-page-draft.md (coach-copy), approved by Lars
// 2026-11-27 ("Those look good there"). Every line is his own words, a line already approved on the site, or a new line he OKd:
// - "Cleared is not capable." is his quote-bank line. The paragraph under it is his own words from a Fathom call
//   (2026-07-29, at 02:45 and 05:04), lightly cleaned.
// - The testing list is his return-to-sport testing definition (coach/voice-dna.md).
// - The case is from my-writing/proof.md, de-identified, with no age.
// - No fixed timelines, no ice, and no knock on the reader's provider (voice-dna).

const PAGE_TITLE = 'Physical Therapy for ACL Tears and Surgery in Reston, VA'

export const metadata: Metadata = {
  ...pageMeta({
    fullTitle: PAGE_TITLE,
    description:
      'Physical therapy for ACL tears and ACL surgery in Reston, VA with Dr. Lars Stevenson, DPT: from the early weeks to return-to-sport testing. No referral needed.',
    path: '/acl-physical-therapy',
  }),
}

// His testing definition (coach/voice-dna.md), word for word.
const TESTS = [
  'Strength side to side.',
  'Hop and jump tests.',
  'Change of direction under fatigue.',
  'Movement quality and readiness.',
]

const h2 = 'font-cormorant text-h2 font-medium text-ink'

// Page-level JSON-LD: the service this page offers (provider = the site-wide MedicalBusiness in
// components/StructuredData.tsx). <Faq> adds the FAQPage block.
const pageJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  '@id': `${SITE_URL}/acl-physical-therapy#service`,
  name: 'Physical therapy for ACL tears and ACL surgery',
  serviceType: 'Physical therapy',
  url: `${SITE_URL}/acl-physical-therapy`,
  description:
    'In-person physical therapy for ACL tears and after ACL surgery, from the early weeks through return-to-sport testing: strength side to side, hop and jump tests, change of direction under fatigue, and movement quality and readiness. 60-minute one-on-one sessions with Dr. Lars Stevenson, PT, DPT.',
  provider: { '@id': `${SITE_URL}/#business` },
  areaServed: BUSINESS.areaServed.map((name) => ({ '@type': 'City', name: `${name}, ${BUSINESS.region}` })),
}

export default function AclPhysicalTherapyPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageJsonLd) }} />
      <SiteHeader current="pt" />
      <main id="main" className="overflow-x-clip">
        <section className="mx-auto grid max-w-page items-end gap-12 px-5 pb-20 pt-12 sm:px-8 md:grid-cols-12 md:gap-8 md:pb-28 md:pt-20">
          <div className="md:col-span-7">
            <h1 className="font-cormorant text-display font-medium text-ink">Physical therapy for ACL tears in Reston</h1>
            <p className="mt-8 max-w-[44ch] text-lede text-ink-soft">
              I take you from the early weeks after an ACL tear or ACL surgery through return-to-sport testing, before you
              go back to your sport. Every session is with me, start to finish.
            </p>
            <Link href={BOOKING_URL} className="btn mt-8">
              {DISCOVERY_CALL.label}
            </Link>
          </div>
          <div className="md:col-span-5">
            <div className="relative aspect-[4/5] overflow-hidden bg-band">
              <Image
                src="/photos/knee-hands-on.jpg"
                alt="Dr. Lars Stevenson working hands-on on a client's knee"
                fill
                priority
                sizes="(min-width: 768px) 40vw, 100vw"
                className="object-cover object-[26%_50%]"
              />
            </div>
          </div>
        </section>

        <section className="border-t border-hairline">
          <div className="mx-auto grid max-w-page gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <h2 className={`${h2} md:col-span-5`}>Cleared is not capable.</h2>
            <div className="max-w-measure space-y-5 text-body text-ink-soft md:col-span-6 md:col-start-7">
              <p>
                Cleared and capable are two different things. Once people are out of pain and hit the numbers
                they&rsquo;re looking for, like 120 degrees of range of motion and strength within 80 to 85% of the other
                leg, they tend to get distracted. If you&rsquo;re lucky, you&rsquo;ll do a hop test to see where
                you&rsquo;re at functionally. A lot of times, even that gets skipped.
              </p>
              <p className="text-ink">So I test for it before you go back.</p>
            </div>
          </div>
        </section>

        <section className="bg-band">
          <div className="mx-auto grid max-w-page gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <div className="md:col-span-5">
              <h2 className={h2}>What return-to-sport testing looks like</h2>
              <p className="mt-6 max-w-measure text-body text-ink-soft">
                You go back when you pass, not when a date on the calendar comes up.
              </p>
            </div>
            <ul className="md:col-span-6 md:col-start-7">
              {TESTS.map((t) => (
                <li key={t} className="border-t border-[#d9d9e1] py-5 text-body text-ink first:border-t-0 first:pt-0">
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section>
          <div className="mx-auto grid max-w-page gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <h2 className={`${h2} md:col-span-5`}>One plan, from the first week to your sport</h2>
            <div className="max-w-measure space-y-5 text-body text-ink-soft md:col-span-6 md:col-start-7">
              <p>
                Treatment and training sit on one plan, and I retest as you go to prove it. Between sessions, your plan
                lives in the app.
              </p>
              <p className="text-ink">
                One Division I lacrosse player came back from ACL and meniscus surgery for his fifth year and now plays
                professionally, with no injuries since.
              </p>
              <Link
                href="/physical-therapy"
                className="link mt-6 inline-block font-montserrat text-[0.9375rem] font-semibold"
              >
                See physical therapy in Reston
              </Link>
            </div>
          </div>
        </section>

        <Faq page="acl" path="/acl-physical-therapy" heading="Questions about ACL physical therapy" band />

        <section>
          <div className="mx-auto grid max-w-page gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <div className="md:col-span-6">
              <h2 className={h2}>Start with a free call</h2>
              <p className="mt-6 max-w-measure text-lede text-ink-soft">
                Tell me what&rsquo;s going on and what you&rsquo;ve tried. If I&rsquo;m not the right person for it,
                I&rsquo;ll point you to who is.
              </p>
              <Link href={BOOKING_URL} className="btn mt-8">
                {DISCOVERY_CALL.label}
              </Link>
            </div>
            <div className="md:col-span-5 md:col-start-8">
              {/* Lars, 2026-11-15. Online wording rule: rehab is the stage after the client's own clinician. */}
              <h2 className={h2}>Not near Reston?</h2>
              <p className="mt-6 max-w-measure text-body text-ink-soft">
                I coach your return to training online, after rehab: a plan built around you, coaching in the app, and a
                call when you need one.
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
      </main>
      <SiteFooter />
    </>
  )
}
