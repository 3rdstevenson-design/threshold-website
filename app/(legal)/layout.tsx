import Link from 'next/link'

// Shared chrome for the legal pages (/privacy-policy, /terms-and-conditions,
// /sms-policy). Mirrors the Nav + footer from app/book/page.tsx. The page body
// renders on a light "document" card because the legal HTML uses dark text.

const MARK_PATH =
  'M1674.35,464.18s-86.86-2.87-176.53,29.02c-44.21,15.72-129.8,51.59-240.99,129.98,0,0,77.76,68.47,187.49,96.12,0,0-93.91-19.04-194.32-90.68-100.41,71.64-194.32,90.68-194.32,90.68,109.73-27.66,187.49-96.12,187.49-96.12-111.19-78.39-196.79-114.26-240.99-129.98-89.68-31.89-176.53-29.02-176.53-29.02,0,0,62.16-1.99,150,31.13,135.87,51.24,231.21,131.61,231.21,131.61-152.65,109.2-358.85,123.04-368.63,123.64,132.46-7.72,210.87-23.73,283.35-46.38,72.55-22.67,128.42-51.54,128.42-51.54,0,0,55.87,28.87,128.42,51.54,72.48,22.65,150.89,38.66,283.35,46.38-9.78-.6-215.98-14.44-368.63-123.64,0,0,95.34-80.37,231.21-131.61,87.84-33.12,150-31.13,150-31.13Z'

function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="826 460 848 295"
      className={className}
      aria-hidden="true"
      fill="currentColor"
    >
      <path d={MARK_PATH} />
    </svg>
  )
}

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-obsidian/95 backdrop-blur-sm border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <LogoMark className="h-7 w-auto text-clinical-white group-hover:text-threshold-purple transition-colors duration-300" />
            <span className="font-montserrat text-xs font-semibold tracking-[0.2em] text-clinical-white uppercase">
              Threshold
            </span>
          </Link>
          <Link
            href="/book"
            className="font-montserrat text-xs font-semibold tracking-wider text-clinical-white bg-threshold-purple px-5 py-2.5"
          >
            Book Now
          </Link>
        </div>
      </nav>

      <main className="bg-clinical-white min-h-screen pt-16 md:pt-20">
        {children}
      </main>

      <footer className="bg-obsidian border-t border-white/10 py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <Link href="/" className="flex items-center gap-3">
            <LogoMark className="h-5 w-auto text-threshold-purple" />
            <span className="font-montserrat text-xs tracking-[0.18em] text-sterling-silver uppercase">
              Threshold Health &amp; Performance
            </span>
          </Link>
          <nav className="font-montserrat text-xs text-sterling-silver flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link
              href="/privacy-policy"
              className="hover:text-clinical-white transition-colors duration-200"
            >
              Privacy Policy
            </Link>
            <span className="text-white/20">·</span>
            <Link
              href="/terms-and-conditions"
              className="hover:text-clinical-white transition-colors duration-200"
            >
              Terms &amp; Conditions
            </Link>
            <span className="text-white/20">·</span>
            <Link
              href="/sms-policy"
              className="hover:text-clinical-white transition-colors duration-200"
            >
              SMS Policy
            </Link>
          </nav>
          <p className="font-montserrat text-xs text-white/30">
            &copy; {new Date().getFullYear()} Threshold Health &amp; Performance
          </p>
        </div>
      </footer>
    </>
  )
}
