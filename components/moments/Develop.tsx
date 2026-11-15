'use client'

import { useEffect, useRef } from 'react'

// Moment "picture develops" (taste-skill: picture-develops). The photograph comes up out of a faint gray
// print, darks first, then colour, once, the first time it is on screen. Without the switch, JavaScript
// or motion, the photograph simply stands.
export default function Develop({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add('is-developing')
            io.disconnect()
          }
        }
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} className={`m-develop ${className}`}>
      {children}
    </div>
  )
}
