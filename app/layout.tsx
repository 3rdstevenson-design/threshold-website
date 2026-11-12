import type { Metadata } from 'next'
import { Cormorant_Garamond, Montserrat, Nunito_Sans } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import StructuredData from '@/components/StructuredData'
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from '@/lib/site'

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
  display: 'swap',
})

const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-montserrat',
  display: 'swap',
})

const nunitoSans = Nunito_Sans({
  subsets: ['latin'],
  variable: '--font-nunito',
  display: 'swap',
})

const HOME_TITLE = `${SITE_NAME} | Physical Therapy in Reston, VA`

// metadataBase makes every relative canonical and OG URL resolve to www.
// Pages set their own canonical; none is set here, so a page without one
// never inherits the home page's.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: HOME_TITLE, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'en_US',
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
    images: [{ url: '/og-default.png', width: 1200, height: 630, alt: `${SITE_NAME}, Reston, Virginia` }],
  },
  twitter: {
    card: 'summary_large_image',
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
    images: ['/og-default.png'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${cormorant.variable} ${montserrat.variable} ${nunitoSans.variable} scroll-smooth`}
    >
      <body>
        <StructuredData />
        {children}
        {/* Vercel Web Analytics (free on Hobby). Replaced Plausible, whose trial lapsed in June 2026. */}
        <Analytics />
      </body>
    </html>
  )
}
