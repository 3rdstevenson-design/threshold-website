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

const INTERVAL = 10000

export default function TestimonialCarousel() {
  const [index, setIndex] = useState(0)
  const [fading, setFading] = useState(false)

  const goTo = useCallback((next: number) => {
    setFading(true)
    setTimeout(() => {
      setIndex((next + testimonials.length) % testimonials.length)
      setFading(false)
    }, 300)
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      goTo(index + 1)
    }, INTERVAL)
    return () => clearInterval(timer)
  }, [index, goTo])

  const { quote, date } = testimonials[index]

  return (
    <div className="flex flex-col items-center">
      {/* Card + arrows row */}
      <div className="flex items-center gap-6 w-full">

        {/* Prev arrow */}
        <button
          onClick={() => goTo(index - 1)}
          aria-label="Previous testimonial"
          className="shrink-0 w-10 h-10 flex items-center justify-center border border-white/10 text-sterling-silver hover:border-threshold-purple hover:text-threshold-purple transition-colors duration-200"
        >
          ←
        </button>

        {/* Card */}
        <div
          className="flex-1 border border-white/10 bg-white/[0.03] p-8 md:p-12 transition-opacity duration-300 min-h-[220px] flex flex-col justify-between"
          style={{ opacity: fading ? 0 : 1 }}
        >
          <div>
            <p className="font-cormorant text-3xl text-threshold-purple mb-5 leading-none">&ldquo;</p>
            <p className="font-nunito text-base md:text-lg text-sterling-silver leading-[1.85]">
              {quote}
            </p>
          </div>
          <p className="font-montserrat text-[10px] tracking-widest text-white/30 uppercase mt-8">
            Verified Patient &nbsp;·&nbsp; {date}
          </p>
        </div>

        {/* Next arrow */}
        <button
          onClick={() => goTo(index + 1)}
          aria-label="Next testimonial"
          className="shrink-0 w-10 h-10 flex items-center justify-center border border-white/10 text-sterling-silver hover:border-threshold-purple hover:text-threshold-purple transition-colors duration-200"
        >
          →
        </button>
      </div>

      {/* Dots */}
      <div className="flex justify-center gap-3 mt-8">
        {testimonials.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            aria-label={`Go to testimonial ${i + 1}`}
            className="w-2 h-2 rounded-full transition-all duration-300"
            style={{
              background: i === index ? 'rgba(112,2,171,1)' : 'rgba(255,255,255,0.2)',
              transform: i === index ? 'scale(1.3)' : 'scale(1)',
            }}
          />
        ))}
      </div>
    </div>
  )
}
