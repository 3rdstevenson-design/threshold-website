import Link from 'next/link'
import { SITE_URL } from '@/lib/site'
import { FAQS, type FaqPage } from '@/lib/faqs'

// One FAQ section per page (Lou Malmgren's audit, 2026-11-25): the visible questions and that page's FAQPage JSON-LD,
// both from lib/faqs.ts so the schema always matches what readers see. Server-rendered with native <details>, so it
// needs no JavaScript and search engines still read every answer. Lars picked the accordion over an open list
// (2026-11-25).

const h2 = 'font-cormorant text-h2 font-medium text-ink'
const rule = 'border-[#d9d9e1]'

type Props = {
  page: FaqPage
  /** The page's path, for the JSON-LD @id ("/" for the homepage). */
  path: string
  heading?: string
  /** Clinical White ground, for a section that follows a white one. */
  band?: boolean
}

export default function Faq({ page, path, heading = 'Frequently asked questions', band = false }: Props) {
  const items = FAQS[page]
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SITE_URL}${path}#faq`,
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  return (
    <section id="faq" aria-labelledby={`faq-${page}`} className={band ? 'bg-band' : 'border-t border-hairline'}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="mx-auto grid max-w-page gap-12 px-5 py-24 sm:px-8 md:grid-cols-12 md:gap-8 md:py-32">
        <h2 id={`faq-${page}`} className={`${h2} md:col-span-5`}>
          {heading}
        </h2>
        <div className={`border-b ${rule} md:col-span-6 md:col-start-7`}>
          {items.map((f) => (
            <details key={f.q} className={`group border-t ${rule}`}>
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-6 font-nunito text-h3 font-bold text-ink transition-colors duration-150 hover:text-threshold-purple [&::-webkit-details-marker]:hidden">
                <span>{f.q}</span>
                {/* A plus that turns into a close mark; the colour change carries the state under reduced motion. */}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="mt-[0.35em] h-4 w-4 shrink-0 text-ink-soft transition-transform duration-200 group-open:rotate-45 group-open:text-threshold-purple motion-reduce:transition-none"
                >
                  <path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="1.75" fill="none" strokeLinecap="round" />
                </svg>
              </summary>
              <div className="max-w-measure pb-7 text-body text-ink-soft">
                <p>{f.a}</p>
                {f.link && (
                  <p className="mt-3">
                    <Link href={f.link.href} className="link">
                      {f.link.label}
                    </Link>
                  </p>
                )}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
