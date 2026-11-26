import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, FOUNDER, BUSINESS, SAME_AS, CONDITIONS } from '@/lib/site'

// Site-wide JSON-LD. MedicalBusiness is the local-business entity (service
// area, phone, Instagram via sameAs); Person makes Dr. Stevenson the
// credentialed practitioner, which matters for a health (YMYL) site; WebSite
// gives Google the site name to show above each result, so page titles can
// lead with the phrase each page targets (Lou Malmgren's audit, 2026-11-25).
export default function StructuredData() {
  const businessId = `${SITE_URL}/#business`
  const personId = `${SITE_URL}/#lars`

  const credential = (credentialCategory: string, name: string, recognizedBy?: Record<string, string>) => ({
    '@type': 'EducationalOccupationalCredential',
    credentialCategory,
    name,
    ...(recognizedBy ? { recognizedBy } : {}),
  })

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: SITE_URL,
        publisher: { '@id': businessId },
      },
      {
        '@type': ['MedicalBusiness', 'PhysicalTherapy'],
        '@id': businessId,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        url: SITE_URL,
        logo: `${SITE_URL}/logo-dark.svg`,
        image: `${SITE_URL}/lars-about-new.png`,
        telephone: BUSINESS.phone,
        email: BUSINESS.email,
        priceRange: '$$$',
        // Out of network with every plan; HSA and FSA cards for physical therapy visits (Lars, 2026-11-25). No prices.
        paymentAccepted: 'Credit card, debit card, HSA card, FSA card',
        address: {
          '@type': 'PostalAddress',
          addressLocality: BUSINESS.city,
          addressRegion: BUSINESS.region,
          addressCountry: BUSINESS.country,
        },
        areaServed: BUSINESS.areaServed.map((name) => ({
          '@type': 'City',
          name: `${name}, ${BUSINESS.region}`,
        })),
        founder: { '@id': personId },
        sameAs: SAME_AS,
      },
      {
        '@type': 'Person',
        '@id': personId,
        name: FOUNDER.name,
        jobTitle: FOUNDER.jobTitle,
        honorificSuffix: FOUNDER.credentials,
        worksFor: { '@id': businessId },
        url: `${SITE_URL}/about`,
        image: `${SITE_URL}/lars-smile.png`,
        hasCredential: [
          credential('degree', FOUNDER.degree.name, { '@type': 'CollegeOrUniversity', name: FOUNDER.degree.school }),
          credential('license', `Physical therapist license, ${FOUNDER.licensedIn}`, {
            '@type': 'GovernmentOrganization',
            name: 'Virginia Board of Physical Therapy',
          }),
          ...FOUNDER.certifications.map((c) => credential('certification', c)),
        ],
        alumniOf: FOUNDER.alumniOf.map((name) => ({ '@type': 'CollegeOrUniversity', name })),
        knowsAbout: ['Physical therapy', 'Strength and conditioning', ...CONDITIONS],
        sameAs: SAME_AS,
      },
    ],
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}
