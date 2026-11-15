/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a local production build use its own folder (NEXT_DIST_DIR=.next-build) without disturbing a
  // running dev server. Unset on Vercel, so deploys use the default .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The guide email attaches the PDF from public/guides (lib/email/start-sequence.ts), so the signup function must
  // ship with the file.
  experimental: {
    outputFileTracingIncludes: { '/api/guide': ['./public/guides/**/*'] },
  },
  // The guide PDF is delivered by email only; tell search engines never to index it.
  async headers() {
    return [{ source: '/guides/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }]
  },
}

module.exports = nextConfig
