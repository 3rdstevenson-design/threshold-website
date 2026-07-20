import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { compileMDX } from 'next-mdx-remote/rsc'
import remarkGfm from 'remark-gfm'
import { mdxComponents } from '@/components/blog/mdxComponents'
import SiteNav from '@/components/SiteNav'
import { getAllSlugs, getPostBySlug } from '@/lib/blog'
import { SITE_URL, SITE_NAME, FOUNDER } from '@/lib/site'
import { BOOKING_URL } from '@/lib/booking'

type Params = { slug: string }

export function generateStaticParams(): Params[] {
  return getAllSlugs().map((slug) => ({ slug }))
}

function loadPost(slug: string) {
  try {
    return getPostBySlug(slug)
  } catch {
    return null
  }
}

export function generateMetadata({ params }: { params: Params }): Metadata {
  const post = loadPost(params.slug)
  if (!post) return {}
  const url = `/blog/${post.slug}`
  const image = post.ogImage ?? `/blog/${post.slug}/og`
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.description,
      url,
      publishedTime: post.date || undefined,
      authors: [post.author],
      images: [{ url: image }],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
      images: [image],
    },
  }
}

function formatDate(iso: string): string {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default async function BlogPost({ params }: { params: Params }) {
  const post = loadPost(params.slug)
  if (!post) notFound()

  const { content: mdxContent } = await compileMDX({
    source: post.content,
    components: mdxComponents,
    options: { mdxOptions: { remarkPlugins: [remarkGfm] } },
  })

  const url = `${SITE_URL}/blog/${post.slug}`
  const image = post.ogImage ?? `/blog/${post.slug}/og`

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        '@id': `${url}#article`,
        headline: post.title,
        description: post.description,
        datePublished: post.date || undefined,
        dateModified: post.date || undefined,
        image: `${SITE_URL}${image}`,
        author: {
          '@type': 'Person',
          name: FOUNDER.name,
          honorificSuffix: FOUNDER.credentials,
          url: `${SITE_URL}/about`,
        },
        publisher: { '@id': `${SITE_URL}/#business` },
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Journal', item: `${SITE_URL}/blog` },
          { '@type': 'ListItem', position: 3, name: post.title, item: url },
        ],
      },
    ],
  }

  return (
    <>
      <SiteNav />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="bg-obsidian min-h-screen pt-32 pb-24">
        <article className="max-w-3xl mx-auto px-6">
          <Link
            href="/blog"
            className="font-montserrat text-xs font-semibold tracking-wider text-sterling-silver hover:text-clinical-white transition-colors duration-200"
          >
            ← The Journal
          </Link>

          <header className="mt-8 mb-12 border-b border-white/10 pb-10">
            <p className="font-montserrat text-xs tracking-[0.2em] text-sterling-silver uppercase mb-4">
              {formatDate(post.date)}
            </p>
            <h1 className="font-cormorant font-light text-clinical-white leading-tight text-4xl md:text-6xl mb-6">
              {post.title}
            </h1>
            <p className="font-montserrat text-xs tracking-[0.18em] text-violet-mid uppercase">
              {post.author}, {FOUNDER.credentials}
            </p>
          </header>

          <div
            className="prose prose-invert max-w-none
              prose-headings:font-cormorant prose-headings:font-light prose-headings:text-clinical-white
              prose-h2:text-3xl prose-h2:mt-12 prose-h2:mb-4
              prose-h3:text-2xl
              prose-p:font-nunito prose-p:text-sterling-silver prose-p:leading-[1.85]
              prose-li:font-nunito prose-li:text-sterling-silver
              prose-strong:text-clinical-white
              prose-a:text-violet-mid prose-a:no-underline hover:prose-a:underline
              prose-blockquote:border-l-threshold-purple prose-blockquote:text-clinical-white prose-blockquote:font-cormorant prose-blockquote:italic"
          >
            {mdxContent}
          </div>

          {/* CTA */}
          <div className="mt-16 border-t border-white/10 pt-12">
            <h2 className="font-cormorant font-light text-clinical-white text-2xl md:text-3xl mb-4">
              Think this is you?
            </h2>
            <p className="font-nunito text-base text-sterling-silver leading-[1.85] mb-8 max-w-2xl">
              Start with a call. We will go through your situation, what you
              have already tried, and build a clear picture of what it takes to
              get back to your sport. No pitch. No pressure. Just 20 honest
              minutes.
            </p>
            <a
              href={BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block font-montserrat text-sm font-semibold tracking-wider text-clinical-white bg-threshold-purple px-9 py-4 hover:bg-purple-800 transition-all duration-200 btn-glow"
            >
              Book Your Intro Call →
            </a>
            <p className="font-cormorant italic text-sterling-silver text-xl mt-12">
              Be Good. Help Someone. Learn Lots.
            </p>
          </div>
        </article>
      </main>
    </>
  )
}
