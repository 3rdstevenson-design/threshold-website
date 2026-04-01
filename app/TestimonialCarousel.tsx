'use client'

import { useState, useEffect, useCallback } from 'react'

const testimonials = [
  {
    quote:
      "Lars Stevenson is by far the best physical therapist I've ever worked with. He's incredibly knowledgeable and eager to share what he knows. When I had questions between visits, he answered them promptly. I've recommended him to numerous people and will continue to do so.",
    date: 'January 2025',
  },
  {
    quote:
      'After one session I immediately felt relief from my back and hip pain. He was very detailed and clear, and gave me exercises to do at home before our next visit.',
    date: 'January 2025',
  },
  {
    quote:
      'Every time I come to him in pain he knows exactly what to do to get everything working again. He gives me great instructions on how to manage my situation.',
    date: 'January 2026',
  },
  {
    quote:
      'He has the exact right mix of treatment planning, diagnosis, communication skills, technical knowledge, and the ability to challenge patients to do their best.',
    date: 'February 2025',
  },
  {
    quote:
      'Thanks to his treatment, my knees and legs have improved significantly. I feel fortunate to have been under his care and will gladly recommend him to my friends and family.',
    date: 'August 2025',
  },
  {
    quote:
      'Lars went above and beyond. He explained everything thoroughly and answered all my questions with impressive detail. In addition to his mastery of the material, he was a pleasure to work with.',
    date: 'October 2024',
  },
]

const PER_PAGE = 3
const PAGES = Math.ceil(testimonials.length / PER_PAGE)
const INTERVAL = 10000

export default function TestimonialCarousel() {
  const [page, setPage] = useState(0)
  const [fading, setFading] = useState(false)

  const goTo = useCallback((next: number) => {
    setFading(true)
    setTimeout(() => {
      setPage(next)
      setFading(false)
    }, 350)
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      goTo((page + 1) % PAGES)
    }, INTERVAL)
    return () => clearInterval(timer)
  }, [page, goTo])

  const visible = testimonials.slice(page * PER_PAGE, (page + 1) * PER_PAGE)

  return (
    <div>
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 transition-opacity duration-300"
        style={{ opacity: fading ? 0 : 1 }}
      >
        {visible.map(({ quote, date }) => (
          <div
            key={quote.slice(0, 30)}
            className="border border-white/10 bg-white/[0.03] p-7 flex flex-col"
          >
            <p className="font-cormorant text-3xl text-threshold-purple mb-4 leading-none">&ldquo;</p>
            <p className="font-nunito text-sm md:text-base text-sterling-silver leading-[1.85] flex-1">
              {quote}
            </p>
            <p className="font-montserrat text-[10px] tracking-widest text-white/30 uppercase mt-6">
              Verified Patient &nbsp;·&nbsp; {date}
            </p>
          </div>
        ))}
      </div>

      {/* Dots */}
      <div className="flex justify-center gap-3 mt-10">
        {Array.from({ length: PAGES }).map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            aria-label={`Go to page ${i + 1}`}
            className="w-2 h-2 rounded-full transition-all duration-300"
            style={{
              background: i === page ? 'rgba(112,2,171,1)' : 'rgba(255,255,255,0.2)',
              transform: i === page ? 'scale(1.3)' : 'scale(1)',
            }}
          />
        ))}
      </div>
    </div>
  )
}
