'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

// Practice Better's booking widget, one service at a time (Lars, 2026-11-27: people book either a free call or an
// in-person evaluation from the site). `s=<serviceId>` limits the widget to that one service (IDs from PB's widget
// builder: Settings → Website Links & Widgets). fl_wtc / fl_wtac set the widget's accent and text colours.
// Each service needs its own availability in PB (My Schedule → My Availability) and must be public, or its tab shows
// no times. Waiver and General Intake go out from PB's "Send forms after booking is confirmed" automations.
const PB_WIDGET =
  'https://my.practicebetter.io?fl_wtc=7002ab&fl_wtac=0d0d18#/6a0502bf701f5e74531dd463/widgets/bookings?s='

export const BOOKING_OPTIONS = [
  {
    key: 'call',
    serviceId: '6a0514de701f5e74531f1e92', // Discovery Call, 30 min, PB video
    label: 'Free call',
    detail: '30 minutes, by video',
    title: 'Book a free 30-minute call with Dr. Lars Stevenson',
  },
  {
    key: 'evaluation',
    serviceId: '6affc4074d7a4d635b41c8e3', // Threshold Performance Care - Initial Evaluation, 60 min, in person
    label: 'In-person evaluation',
    detail: '60 minutes, in Reston',
    title: 'Book an in-person evaluation with Dr. Lars Stevenson',
  },
] as const

type OptionKey = (typeof BOOKING_OPTIONS)[number]['key']

export const widgetUrl = (serviceId: string) => `${PB_WIDGET}${serviceId}`

// Lazy by default, so the widget loads only when scrolled near. /book#evaluation opens on the evaluation.
export default function BookingWidget({ eager = false }: { eager?: boolean }) {
  const [selected, setSelected] = useState<OptionKey>('call')
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  useEffect(() => {
    if (window.location.hash === '#evaluation') setSelected('evaluation')
  }, [])

  const current = BOOKING_OPTIONS.find((o) => o.key === selected) ?? BOOKING_OPTIONS[0]

  // Arrow keys move between the two tabs (WAI-ARIA tabs pattern).
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const last = BOOKING_OPTIONS.length - 1
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'ArrowRight' ? (index === last ? 0 : index + 1) : index === 0 ? last : index - 1
    setSelected(BOOKING_OPTIONS[next].key)
    tabs.current[next]?.focus()
  }

  return (
    <div className="border border-hairline bg-paper">
      <div role="tablist" aria-label="What would you like to book?" className="grid grid-cols-2">
        {BOOKING_OPTIONS.map((o, i) => {
          const isSelected = o.key === selected
          return (
            <button
              key={o.key}
              ref={(el) => {
                tabs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${o.key}`}
              aria-selected={isSelected}
              aria-controls={`${id}-panel`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setSelected(o.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`min-h-[3.75rem] px-4 py-3 text-left transition-colors duration-150 ease-out sm:px-6 ${
                isSelected
                  ? 'bg-paper text-ink shadow-[inset_0_-2px_0_#7002ab]'
                  : 'bg-band text-muted shadow-[inset_0_-1px_0_#E3E3EA] hover:text-ink'
              }`}
            >
              <span className="block font-montserrat text-[0.9375rem] font-semibold leading-tight">{o.label}</span>
              <span className="mt-1 block text-small">{o.detail}</span>
            </button>
          )
        })}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${current.key}`}>
        <iframe
          key={current.key}
          src={widgetUrl(current.serviceId)}
          title={current.title}
          loading={eager ? 'eager' : 'lazy'}
          className="block h-[860px] w-full"
          allowFullScreen
        />
      </div>
    </div>
  )
}
