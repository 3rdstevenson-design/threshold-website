// Single source of truth for public site identity: canonical URL, business
// NAP (name/address/phone), and social profiles. Consumed by metadata,
// sitemap, robots, the footer, and JSON-LD so they never drift apart.

// The apex (thresholdhp.com) 307s to www on Vercel, so www is canonical.
export const SITE_URL = 'https://www.thresholdhp.com'

export const SITE_NAME = 'Threshold Health & Performance'
export const SITE_TAGLINE = "It's time to cross your threshold."
export const SITE_DESCRIPTION =
  'Sports and performance physical therapy in Reston, Virginia, with Dr. Lars Stevenson, PT, DPT.'

// The homepage title (the layout default and the home page's own metadata). Every page's title is unique and leads with
// the phrase that page targets (docs/seo-keyword-map-2026-11.md).
export const HOME_TITLE = 'Physical Therapist in Reston, VA | Dr. Lars Stevenson, DPT'

// The homepage headline. Lars rejected the 2026-11-12 USP line on 2026-11-26 (he never said it or signed off on it), so
// the headline is the plain phrase from the homepage description he approved. Copy in his name uses only his own words
// or lines he approved word for word; lib/__tests__/rejected-lines.test.ts keeps the old line out.
export const HOME_HEADLINE = 'Sports and performance physical therapy in Reston, VA'

export const FOUNDER = {
  name: 'Dr. Lars Stevenson',
  jobTitle: 'Doctor of Physical Therapy',
  // His CSCS lapsed: never cite it (Lars, 2026-11-14). The rest is word for word from
  // threshold-coaching-brain/my-writing/proof.md ("say these exactly").
  credentials: 'PT, DPT',
  degree: { name: 'Doctor of Physical Therapy', school: 'Marymount University' },
  licensedIn: 'Virginia',
  certifications: ['Precision Nutrition Level 1', 'Fascial Stretch Therapy Level 1'],
  alumniOf: ['Marymount University', 'St. Olaf College'],
}

// What Lars treats (Lars, 2026-11-25), for the Person schema's knowsAbout. The pages name them in their own words.
export const CONDITIONS = [
  'Sports injuries',
  'ACL and meniscus surgery rehabilitation',
  'Rotator cuff repair rehabilitation',
  'Shoulder replacement rehabilitation',
  'Low back pain',
  'Neck pain',
  'Hip pain',
  'Hamstring strains and tears',
  'Ankle sprains',
  'Return to running',
]

// The free discovery call (Practice Better service "Discovery Call", 30 minutes, video).
export const DISCOVERY_CALL = {
  minutes: 30,
  label: 'Book a free call',
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
