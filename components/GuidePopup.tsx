'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import GuideSignup, { SIGNED_UP_KEY } from '@/components/GuideSignup'
import { GUIDE_PITCH } from '@/lib/guide-lead'

// The guide's slide-in and its button (Lars, 2026-11-27), only on the pages people read: never on Book, Contact, the
// thank-you page or the legal pages. Google's "avoid intrusive interstitials" guidance: it never covers the page, so
// it's a corner card on wide screens and, on phones, a slim bar that opens to the form only when tapped.
// - Opens on its own once a visitor has read half the page, spent 30 seconds on it, or (mouse users) heads for the
//   browser's tabs; at most once every 14 days, never after a signup, never while the page's own guide form is on screen.
// - The button (wide screens) reopens it any time. Words are the guide section's, which Lars approved; nothing new.

const PAGES = new Set(['/', '/physical-therapy', '/online-coaching', '/about'])
const SHOWN_KEY = 'thp-guide-popup-shown'
const QUIET_MS = 14 * 24 * 60 * 60 * 1000
const DELAY_MS = 30_000

type Open = { via: 'popup' | 'button'; full: boolean }

function read(key: string): number {
  try {
    return Number(localStorage.getItem(key) || 0)
  } catch {
    return 0
  }
}

function write(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // Storage refused (private browsing): it may show again on the next page, which is harmless.
  }
}

export default function GuidePopup() {
  const pathname = usePathname()
  const eligible = PAGES.has(pathname)
  // Nothing renders until the browser has said whether this visitor already signed up.
  const [signedUp, setSignedUp] = useState(true)
  const [open, setOpen] = useState<Open | null>(null)
  const [pastHero, setPastHero] = useState(false)
  const [inlineVisible, setInlineVisible] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const focusFirstField = useRef(false)
  const live = useRef({ eligible, signedUp, open: false, inlineVisible })
  live.current = { eligible, signedUp, open: Boolean(open), inlineVisible }

  useEffect(() => {
    setSignedUp(read(SIGNED_UP_KEY) > 0)
    setOpen(null)
  }, [pathname])

  const autoOpen = useCallback(() => {
    const s = live.current
    if (!s.eligible || s.signedUp || s.open || s.inlineVisible) return
    if (Date.now() - read(SHOWN_KEY) < QUIET_MS) return
    write(SHOWN_KEY, Date.now())
    setOpen({ via: 'popup', full: window.matchMedia('(min-width: 640px)').matches })
  }, [])

  useEffect(() => {
    if (!eligible) return
    const timer = window.setTimeout(autoOpen, DELAY_MS)
    const onScroll = () => {
      setPastHero(window.scrollY > 600)
      const max = document.documentElement.scrollHeight - window.innerHeight
      if (max > 0 && window.scrollY / max >= 0.5) autoOpen()
    }
    const onLeave = (e: MouseEvent) => {
      if (!e.relatedTarget && e.clientY <= 0) autoOpen()
    }
    const mouse = window.matchMedia('(pointer: fine)').matches
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    if (mouse) document.addEventListener('mouseout', onLeave)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('mouseout', onLeave)
    }
  }, [eligible, pathname, autoOpen])

  // Stay out of the way while the page's own guide section is on screen.
  useEffect(() => {
    const section = document.getElementById('guide')
    setInlineVisible(false)
    if (!section || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([entry]) => setInlineVisible(entry.isIntersecting), { threshold: 0.15 })
    io.observe(section)
    return () => io.disconnect()
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Opened by a click: focus goes to the first field. Opened on its own: focus stays where the reader is.
  useEffect(() => {
    if (open?.full && focusFirstField.current) {
      focusFirstField.current = false
      panelRef.current?.querySelector<HTMLInputElement>('input[name="firstName"]')?.focus()
    }
  }, [open])

  if (!eligible || signedUp) return null

  const openFull = (via: Open['via']) => {
    focusFirstField.current = true
    write(SHOWN_KEY, Date.now())
    setOpen({ via, full: true })
  }

  return (
    <>
      {!open && pastHero && !inlineVisible && (
        <button
          type="button"
          onClick={() => openFull('button')}
          className="fixed bottom-6 right-6 z-40 hidden min-h-[2.75rem] items-center rounded-[2px] bg-threshold-purple px-5 font-montserrat text-[0.875rem] font-semibold text-white shadow-[0_8px_24px_rgba(13,13,24,0.18)] transition-colors duration-150 hover:bg-[#5a0189] sm:inline-flex"
        >
          {GUIDE_PITCH.heading}
        </button>
      )}

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby="guide-popup-title"
          className="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto border-t border-hairline bg-paper px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 text-ink shadow-[0_-8px_30px_rgba(13,13,24,0.12)] animate-[guide-in_280ms_cubic-bezier(0.2,0,0,1)] motion-reduce:animate-none sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[380px] sm:border sm:p-6 sm:shadow-[0_12px_40px_rgba(13,13,24,0.16)]"
        >
          <button
            type="button"
            onClick={() => setOpen(null)}
            aria-label="Close"
            className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center text-ink-soft transition-colors duration-150 hover:text-ink"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.75" fill="none" strokeLinecap="round" />
            </svg>
          </button>
          <h2 id="guide-popup-title" className="pr-10 font-cormorant text-[1.75rem] font-medium leading-tight">
            {GUIDE_PITCH.heading}
          </h2>
          {open.full ? (
            <>
              <p className="mb-5 mt-3 text-[0.9375rem] leading-relaxed text-ink-soft">{GUIDE_PITCH.blurb}</p>
              <GuideSignup doorway={open.via} compact />
            </>
          ) : (
            <button type="button" className="btn mt-4 w-full" onClick={() => openFull('popup')}>
              Send me the guide
            </button>
          )}
        </div>
      )}
    </>
  )
}
