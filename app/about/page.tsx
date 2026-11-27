import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { pageMeta } from '@/lib/metadata'
import { BOOKING_URL } from '@/lib/booking'
import { BUSINESS, DISCOVERY_CALL } from '@/lib/site'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import Develop from '@/components/moments/Develop'
import Faq from '@/components/Faq'

export const metadata: Metadata = {
  ...pageMeta({
    fullTitle: 'Dr. Lars Stevenson, Doctor of Physical Therapy in Reston, VA',
    description:
      'Doctor of Physical Therapy (Marymount University) in Reston, VA, licensed in Virginia, with Precision Nutrition Level 1 and Fascial Stretch Therapy Level 1.',
    path: '/about',
  }),
}

const CREDENTIALS = [
  'Doctor of Physical Therapy, Marymount University',
  'St. Olaf College, Minnesota',
  'Fascial Stretch Therapy, Level 1',
  'Precision Nutrition, Level 1',
  'Strength and conditioning apprenticeship, from age 20',
]

const h2 = 'font-cormorant text-h2 font-medium text-ink'
const prose = 'max-w-measure space-y-5 text-lede text-ink-soft'

export default function AboutPage() {
  return (
    <>
      <SiteHeader current="about" />
      <main id="main" className="overflow-x-clip">
        <section className="mx-auto grid max-w-page items-end gap-12 px-5 pb-20 pt-12 sm:px-8 md:grid-cols-12 md:gap-8 md:pb-28 md:pt-20">
          <div className="md:col-span-7">
            <h1 className="font-cormorant text-display font-medium text-ink">Dr. Lars Stevenson, PT, DPT</h1>
            <p className="mt-8 max-w-[44ch] text-lede text-ink-soft">
              Physical therapist in {BUSINESS.city}, {BUSINESS.regionName}. My background is in strength and
              conditioning and exercise, with a concentration in nutrition.
            </p>
            <Link href={BOOKING_URL} className="btn mt-8">
              {DISCOVERY_CALL.label}
            </Link>
          </div>
          <div className="md:col-span-5">
            <Develop className="relative aspect-[4/5] overflow-hidden bg-band">
              <Image
                src="/photos/lars-treating-hip.jpg"
                alt="Dr. Lars Stevenson treating a patient's hip"
                fill
                priority
                sizes="(min-width: 768px) 40vw, 100vw"
                className="object-cover object-[50%_30%]"
              />
            </Develop>
          </div>
        </section>

        <section className="border-t border-hairline">
          <div className="mx-auto grid max-w-page gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <div className="md:col-span-6">
              <h2 className={h2}>Football, rugby and the weight room</h2>
              <div className={`mt-6 ${prose}`}>
                <p>
                  My family moved with the Air Force (Nebraska, then Louisiana) before landing back in Virginia when I
                  was in 8th grade. I started football at 7.
                </p>
                <p>
                  In my senior year of high school, a teammate talked my football friends and me into rugby. That first
                  season the team went into nationals as the 6th seed and won it. The ring still sits on my desk.
                </p>
                <p>
                  I played Division III football at St. Olaf College in Minnesota. I was top 5 on my team in every lift
                  and barely played. That gap between the weight room and the field is a big part of why I train
                  athletes the way I do.
                </p>
                <p>
                  Six concussions ended my playing days before my senior season, so I stayed with the program from the
                  sideline and coached in the school&apos;s performance program.
                </p>
              </div>
            </div>
            <div className="md:col-span-5 md:col-start-8 md:pt-24">
              <div className="relative aspect-[4/3] overflow-hidden bg-band">
                <Image
                  src="/photos/coaching-athlete.jpg"
                  alt="Dr. Lars Stevenson coaching a client through a wrist exercise"
                  fill
                  sizes="(min-width: 768px) 38vw, 100vw"
                  className="object-cover object-[45%_40%]"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="bg-band">
          <div className="mx-auto grid max-w-page gap-8 px-5 py-24 sm:px-8 md:grid-cols-12 md:py-32">
            <h2 className={`${h2} md:col-span-5`}>Where I learned to coach</h2>
            <div className={`${prose} md:col-span-6 md:col-start-7`}>
              <p>
                At 20 I started an apprenticeship with a strength coach. It took me to Jamaica, working tracks
                alongside sprint coaches, and then to a year in his gym, stretching his sprinters and running their
                control drills every day. I&apos;ve coached everyone from middle school athletes all the way up to the
                Olympic stage.
              </p>
              <p>
                That year showed me what elite standards look like, and that the truth, said clearly and quickly, beats
                the comfortable version. I tell my patients the truth about their progress.
              </p>
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto grid max-w-page gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
            <div className="md:order-2 md:col-span-6 md:col-start-7">
              <h2 className={h2}>Why I opened Threshold</h2>
              <div className={`mt-6 ${prose}`}>
                <p>
                  I kept seeing people discharged once the pain went down, before they were back to the sport or the
                  training they came in for. I don&apos;t believe &ldquo;learn to live with it&rdquo; is true for most
                  of them.
                </p>
                <p>
                  Threshold holds the whole arc in one place: rehab, strength, and the return to what you love, with
                  one person who knows your full history. You never re-explain yourself to a new provider. Every
                  session is with me.
                </p>
              </div>
            </div>
            <div className="md:order-1 md:col-span-5 md:pt-24">
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

        <section className="bg-band">
          <div className="mx-auto grid max-w-page gap-8 px-5 py-24 sm:px-8 md:grid-cols-12 md:py-32">
            <h2 className={`${h2} md:col-span-5`}>Training and credentials</h2>
            <div className="md:col-span-6 md:col-start-7">
              <ul className="divide-y divide-[#d9d9e1] border-y border-[#d9d9e1]">
                {CREDENTIALS.map((c) => (
                  <li key={c} className="py-4 text-body text-ink">
                    {c}
                  </li>
                ))}
              </ul>
              <div className={`mt-8 ${prose}`}>
                <p>When I&apos;m not working, I&apos;m training or running a D&amp;D campaign.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-page px-5 py-24 sm:px-8 md:py-32">
          <div className="max-w-2xl">
            <h2 className={h2}>Book a free {DISCOVERY_CALL.minutes}&#8209;minute call</h2>
            <p className="mt-5 text-lede text-ink-soft">
              Tell me what&apos;s going on and what you&apos;ve tried. If I&apos;m not the right person for it,
              I&apos;ll tell you who is.
            </p>
            <Link href={BOOKING_URL} className="btn mt-8">
              {DISCOVERY_CALL.label}
            </Link>
            <p className="mt-14 font-cormorant text-[1.6rem] font-medium italic leading-snug text-ink">
              Be Good. Help Someone. Learn Lots.
            </p>
          </div>
        </section>

        <Faq page="about" path="/about" heading="Questions about Dr. Stevenson" band />
      </main>
      <SiteFooter />
    </>
  )
}
