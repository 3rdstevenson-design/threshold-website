import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/site'

const OG_IMAGE = { url: '/og-default.png', width: 1200, height: 630, alt: `${SITE_NAME}, Reston, Virginia` }

// Per-page canonical + Open Graph + Twitter in one call. Next merges metadata
// shallowly, so a page that set only openGraph.title would drop the image and
// site name; this always sends the whole object.
// `fullTitle` is the title as it appears in the browser tab.
export function pageMeta(opts: { fullTitle: string; description: string; path: string }): Metadata {
  const shareTitle = opts.fullTitle
  return {
    description: opts.description,
    alternates: { canonical: opts.path },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'en_US',
      title: shareTitle,
      description: opts.description,
      url: opts.path,
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: shareTitle,
      description: opts.description,
      images: [OG_IMAGE.url],
    },
  }
}
