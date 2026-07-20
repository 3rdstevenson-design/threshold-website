import {
  SITE_URL,
  SITE_NAME,
  SITE_DESCRIPTION,
  FOUNDER,
  BUSINESS,
  SAME_AS,
} from '@/lib/site'

// Site-wide JSON-LD. MedicalBusiness establishes the local-business entity
// (powers local/Map + rich results); Person establishes Dr. Stevenson as a
// credentialed author, which carries weight for a YMYL (health) topic.
// Structured data isn't required for AI features, but it helps Google connect
// the brand entity and qualify for rich results.
export default function StructuredData() {
  const personId = `${SITE_URL}/#lars`

  const graph = [
    {
      '@type': 'MedicalBusiness',
      '@id': `${SITE_URL}/#business`,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      url: SITE_URL,
      medicalSpecialty: 'PhysicalTherapy',
      address: {
        '@type': 'PostalAddress',
        addressLocality: BUSINESS.city,
        addressRegion: BUSINESS.region,
        addressCountry: BUSINESS.country,
      },
      areaServed: BUSINESS.areaServed.map((name) => ({
        '@type': 'City',
        name,
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
      worksFor: { '@id': `${SITE_URL}/#business` },
      url: `${SITE_URL}/about`,
    },
  ]

  const jsonLd = { '@context': 'https://schema.org', '@graph': graph }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}
