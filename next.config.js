/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a local production build use its own folder (NEXT_DIST_DIR=.next-build) without disturbing a
  // running dev server. Unset on Vercel, so deploys use the default .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
}

module.exports = nextConfig
