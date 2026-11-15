import Link from 'next/link'
import LogoMark from '@/components/LogoMark'

// Top bar and section label shared by the booking pages (/handoff,
// /intro-call). The nav button jumps to the page's #book section.
export function BookingNav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-obsidian/95 backdrop-blur-sm border-b border-white/5">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <LogoMark className="h-7 w-auto text-clinical-white group-hover:text-threshold-purple transition-colors duration-300" />
          <span className="font-montserrat text-xs font-semibold tracking-[0.2em] text-clinical-white uppercase">
            Threshold
          </span>
        </Link>
        <a
          href="#book"
          className="font-montserrat text-xs font-semibold tracking-wider text-clinical-white bg-threshold-purple px-5 py-2.5 hover:bg-threshold-purple/80 transition-colors duration-200"
        >
          Pick a Time
        </a>
      </div>
    </nav>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-montserrat text-xs tracking-[0.35em] text-sterling-silver uppercase mb-5">
      {children}
    </p>
  )
}
