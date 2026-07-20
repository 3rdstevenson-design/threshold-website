/** @type {import('next').NextConfig} */
const nextConfig = {
  // The always-on prod service builds/serves from a SEPARATE directory
  // (.next-prod) so a stray `next dev` — which always uses .next — can't
  // clobber the live build and crash the service. Prod sets
  // NEXT_DIST_DIR=.next-prod (launchd plist + `npm run build:prod`); plain
  // `npm run dev` leaves it unset and uses .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
}

module.exports = nextConfig
