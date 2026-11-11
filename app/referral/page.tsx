import type { Metadata } from 'next'
import BookPage, { metadata as bookMetadata } from '../book/page'

// /referral is the same booking page as /book. It exists so the QR code on the
// physician referral pad lands on its own URL, which Vercel Web Analytics counts
// separately: visits here are patients who came from a doctor's office.
// Kept out of search results; /book stays the canonical page.
export const metadata: Metadata = {
  ...bookMetadata,
  alternates: { canonical: 'https://www.thresholdhp.com/book' },
  robots: { index: false, follow: true },
}

export default BookPage
