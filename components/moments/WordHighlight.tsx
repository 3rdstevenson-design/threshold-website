'use client'

import { useEffect, useRef } from 'react'

// Moment "words fill in" (taste-skill: word-highlight). The paragraph's words turn from light gray to ink
// as it scrolls through the viewport, so the statement completes as you read it. The full text is in the
// HTML from the start; without JavaScript, or with motion turned off, every word is plain ink.
export default function WordHighlight({ paragraphs, className = '' }: { paragraphs: string[]; className?: string }) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current
    if (!el) return
    const words = Array.from(el.querySelectorAll<HTMLSpanElement>('[data-w]'))
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0

    function paint() {
      frame = 0
      if (reduce.matches) {
        words.forEach((w) => (w.style.color = ''))
        return
      }
      const rect = el!.getBoundingClientRect()
      const vh = window.innerHeight
      // 0 when the block's top reaches 85% of the screen, 1 when its bottom reaches 40%.
      const start = vh * 0.85
      const end = vh * 0.4
      const total = rect.height + (start - end)
      const progress = Math.min(1, Math.max(0, (start - rect.top) / total))
      const lit = Math.round(progress * words.length)
      words.forEach((w, i) => (w.style.color = i < lit ? '' : '#a9a9b6'))
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(paint)
    }

    paint()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    reduce.addEventListener('change', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      reduce.removeEventListener('change', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div ref={root} className={className}>
      {paragraphs.map((p, pi) => (
        <p key={pi}>
          {p.split(' ').map((word, wi) => (
            <span key={wi} data-w="" className="transition-colors duration-150 ease-out">
              {word}{' '}
            </span>
          ))}
        </p>
      ))}
    </div>
  )
}
