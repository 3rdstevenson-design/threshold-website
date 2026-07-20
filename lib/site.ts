// Single source of truth for public site identity: canonical URL, business
// NAP (name/address/phone), and social profiles. Consumed by metadata,
// sitemap, robots, and JSON-LD structured data so they never drift apart.

export const SITE_URL = 'https://thresholdhp.com'

export const SITE_NAME = 'Threshold Health & Performance'
export const SITE_TAGLINE = "It's time to cross your threshold."
export const SITE_DESCRIPTION =
  'Physical therapy and performance coaching in Reston, Virginia for serious athletes who have done the work, followed the program, and still are not back to their sport.'

export const FOUNDER = {
  name: 'Dr. Lars Stevenson',
  jobTitle: 'Doctor of Physical Therapy',
  credentials: 'PT, DPT',
}

export const BUSINESS = {
  city: 'Reston',
  region: 'VA',
  regionName: 'Virginia',
  country: 'US',
  // Service-area corridors (used for local copy, not a street address).
  areaServed: ['Reston', 'Herndon', 'Great Falls', 'McLean', 'Fairfax', 'Tysons Corner'],
}

// Social / external profiles. Used for schema.org sameAs (helps Google connect
// the brand entity). Add real handles as they are confirmed.
export const SAME_AS: string[] = [
  'https://www.instagram.com/dr.larsandincharge',
]

// Default Open Graph image: dedicated 1200x630 landscape share card.
// Regenerate with `node scripts/generate-og-image.mjs`.
export const OG_IMAGE = '/og-default.png'
