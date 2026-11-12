// Single source of truth for public site identity: canonical URL, business
// NAP (name/address/phone), and social profiles. Consumed by metadata,
// sitemap, robots, the footer, and JSON-LD so they never drift apart.

// The apex (thresholdhp.com) 307s to www on Vercel, so www is canonical.
export const SITE_URL = 'https://www.thresholdhp.com'

export const SITE_NAME = 'Threshold Health & Performance'
export const SITE_TAGLINE = "It's time to cross your threshold."
export const SITE_DESCRIPTION =
  'Physical therapy and performance coaching in Reston, Virginia for athletes who have done the work, followed the program, and still are not back to their sport.'

export const FOUNDER = {
  name: 'Dr. Lars Stevenson',
  jobTitle: 'Doctor of Physical Therapy',
  credentials: 'PT, DPT, CSCS',
}

// Google Business Profile is a service-area business (Reston, Tysons,
// Fairfax), so no street address is published in schema or the footer.
// The mailing address stays on the legal pages and /contact.
export const BUSINESS = {
  city: 'Reston',
  region: 'VA',
  regionName: 'Virginia',
  country: 'US',
  phone: '+1-402-536-0203',
  phoneDisplay: '(402) 536-0203',
  email: 'dr.lars@thresholdhp.com',
  areaServed: ['Reston', 'Herndon', 'Tysons', 'Fairfax', 'McLean', 'Great Falls'],
}

export const INSTAGRAM = {
  handle: 'dr.larsandincharge',
  url: 'https://www.instagram.com/dr.larsandincharge/',
}

// schema.org sameAs: profiles that are this same entity.
export const SAME_AS: string[] = [INSTAGRAM.url]
