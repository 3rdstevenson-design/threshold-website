import type { Metadata } from 'next'
import { Cormorant_Garamond, Montserrat, Nunito_Sans } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

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

export const metadata: Metadata = {
  title: 'Threshold Health & Performance | Reston, Virginia',
  description:
    'Physical therapy and performance coaching for serious people who are done settling for partial answers.',
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
        {children}
        {/* Vercel Web Analytics (free on Hobby). Replaced Plausible, whose trial lapsed in June 2026. */}
        <Analytics />
      </body>
    </html>
  )
}
