import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import StructuredData from '@/components/StructuredData'
import GuidePopup from '@/components/GuidePopup'
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, HOME_TITLE } from '@/lib/site'

// Brand fonts, self-hosted as latin woff2 subsets (SIL OFL, licenses beside the files in app/fonts).
// Local files keep builds independent of Google Fonts and keep the type identical in every preview.
const cormorant = localFont({
  src: [
    { path: './fonts/cormorant-garamond-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/cormorant-garamond-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/cormorant-garamond-latin-500-italic.woff2', weight: '500', style: 'italic' },
  ],
  variable: '--font-cormorant',
  display: 'swap',
  fallback: ['Georgia', 'serif'],
})

const montserrat = localFont({
  src: './fonts/montserrat-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-montserrat',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
})

const nunitoSans = localFont({
  src: './fonts/nunito-sans-latin-wght-normal.woff2',
  weight: '200 1000',
  variable: '--font-nunito',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
})

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

export const viewport: Viewport = {
  themeColor: '#FFFFFF',
  colorScheme: 'light',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // suppressHydrationWarning: the inline script below adds `js` to <html> before React hydrates.
    <html lang="en" className={`${cormorant.variable} ${montserrat.variable} ${nunitoSans.variable}`} suppressHydrationWarning>
      <head>
        {/* Marks JavaScript as on before first paint, so the About portrait starts as a faint print without a
            flash of the finished photo. Without JavaScript it never gets the class and the photo simply stands. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body className="bg-paper font-nunito text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:bg-paper focus:px-4 focus:py-2 focus:text-ink"
        >
          Skip to content
        </a>
        <StructuredData />
        {children}
        {/* The guide's slide-in and button, on the reading pages only (components/GuidePopup.tsx). */}
        <GuidePopup />
        {/* Vercel Web Analytics (free on Hobby). Replaced Plausible, whose trial lapsed in June 2026. */}
        <Analytics />
      </body>
    </html>
  )
}
