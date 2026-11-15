import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

// Served at /robots.txt. Allow the public site; keep API routes and the email-only guide PDF out.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api', '/guides/'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
