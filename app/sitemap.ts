import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

// Served at /sitemap.xml. Public, indexable routes only. /referral is a
// noindex duplicate of /book, /handoff and /intro-call are noindex booking
// pages people reach from a link, and the
// legal pages carry no search value.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/physical-therapy`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/about`, changeFrequency: 'yearly', priority: 0.8 },
    { url: `${SITE_URL}/online-coaching`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/book`, changeFrequency: 'yearly', priority: 0.8 },
    { url: `${SITE_URL}/contact`, changeFrequency: 'yearly', priority: 0.5 },
    // The No Surprises Act wants the Good Faith Estimate notice easy to find from a search engine.
    { url: `${SITE_URL}/good-faith-estimate`, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
