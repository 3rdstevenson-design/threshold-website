import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, FOUNDER, BUSINESS, SAME_AS } from '@/lib/site'

// Site-wide JSON-LD. MedicalBusiness is the local-business entity (service
// area, phone, Instagram via sameAs); Person makes Dr. Stevenson the
// credentialed practitioner, which matters for a health (YMYL) site.
export default function StructuredData() {
  const businessId = `${SITE_URL}/#business`
  const personId = `${SITE_URL}/#lars`

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
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
