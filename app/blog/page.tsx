import type { Metadata } from 'next'
import Link from 'next/link'
import SiteNav from '@/components/SiteNav'
import { getAllPosts } from '@/lib/blog'

export const metadata: Metadata = {
  title: 'The Journal',
  description:
    'Clinical notes on recovery, performance, and getting back to your sport from Dr. Lars Stevenson, PT, DPT in Reston, Virginia.',
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'The Journal | Threshold Health & Performance',
    description:
      'Clinical notes on recovery, performance, and getting back to your sport from Dr. Lars Stevenson, PT, DPT.',
    url: '/blog',
  },
}

function formatDate(iso: string): string {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function BlogIndex() {
  const posts = getAllPosts()
  const pillar = posts.find((p) => p.pillar)
  const rest = posts.filter((p) => !p.pillar)

  return (
    <>
      <SiteNav />
      <main className="bg-obsidian min-h-screen pt-32 pb-24">
        <div className="max-w-3xl mx-auto px-6">
          <p className="font-montserrat text-xs tracking-[0.35em] text-sterling-silver uppercase mb-7">
            The Journal
          </p>
          <h1 className="font-cormorant font-light text-clinical-white leading-tight text-4xl md:text-6xl mb-6">
            Clinical notes from the work.
          </h1>
          <p className="font-nunito text-base md:text-lg text-sterling-silver leading-[1.85] max-w-2xl mb-16">
            Honest writing on why recovery stalls, what standard rehab leaves
            on the table, and how serious athletes get back to their sport. No
            fluff, no recycled tips, just what I see in practice.
          </p>

          {pillar ? (
            <Link
              href={`/blog/${pillar.slug}`}
              className="block group mb-16 rounded-lg border border-threshold-purple/40 bg-deep-navy/50 p-7 md:p-9 transition-colors duration-200 hover:border-threshold-purple"
            >
              <p className="font-montserrat text-xs font-semibold tracking-[0.3em] text-champion-gold uppercase mb-4">
                Start Here · {pillar.cluster ?? 'Crossing the Threshold'}
              </p>
              <h2 className="font-cormorant font-light text-clinical-white leading-tight text-3xl md:text-4xl mb-3 group-hover:text-violet-mid transition-colors duration-200">
                {pillar.title}
              </h2>
              <p className="font-nunito text-sm md:text-base text-sterling-silver leading-relaxed mb-4">
                {pillar.description}
              </p>
              <span className="font-montserrat text-xs font-semibold tracking-wider text-violet-mid">
                Read the guide →
              </span>
            </Link>
          ) : null}

          {rest.length === 0 ? (
            <p className="font-nunito text-sterling-silver">
              New writing is on the way. Check back soon.
            </p>
          ) : (
            <ul className="space-y-12">
              {rest.map((post) => (
                <li
                  key={post.slug}
                  className="border-l-[3px] border-threshold-purple pl-7 md:pl-10"
                >
                  <p className="font-montserrat text-xs tracking-[0.2em] text-sterling-silver uppercase mb-3">
                    {formatDate(post.date)}
                  </p>
                  <h2 className="font-cormorant font-light text-clinical-white leading-tight text-2xl md:text-3xl mb-3">
                    <Link
                      href={`/blog/${post.slug}`}
                      className="hover:text-violet-mid transition-colors duration-200"
                    >
                      {post.title}
                    </Link>
                  </h2>
                  <p className="font-nunito text-sm md:text-base text-sterling-silver leading-relaxed mb-4 max-w-2xl">
                    {post.description}
                  </p>
                  <Link
                    href={`/blog/${post.slug}`}
                    className="font-montserrat text-xs font-semibold tracking-wider text-violet-mid hover:text-violet-400 transition-colors duration-200"
                  >
                    Read it →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  )
}
