'use client'

import { useEffect, useState } from 'react'

// DEV ONLY: a switch panel for comparing the four candidate animations on localhost.
// Each switch sets a data-m-* attribute on <html>; the moments read it. Lars picks the keepers,
// then this panel and the losing variants are deleted before launch.

export const MOMENTS = [
  { key: 'chapters', label: 'Photo chapters (How I work)' },
  { key: 'words', label: 'Words fill in (The other half)' },
  { key: 'develop', label: 'Portrait develops (About)' },
  { key: 'behind', label: 'Headline behind you (hero)' },
] as const

const STORAGE_KEY = 'threshold-demo-moments'

export function applyMoments(on: Record<string, boolean>) {
  for (const m of MOMENTS) {
    document.documentElement.toggleAttribute(`data-m-${m.key}`, !!on[m.key])
  }
  window.dispatchEvent(new Event('moments-change'))
}

export default function DemoPanel() {
  const [on, setOn] = useState<Record<string, boolean> | null>(null)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let saved: Record<string, boolean> = Object.fromEntries(MOMENTS.map((m) => [m.key, true]))
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) saved = { ...saved, ...JSON.parse(raw) }
    } catch {}
    setOn(saved)
    applyMoments(saved)
  }, [])

  function toggle(key: string) {
    if (!on) return
    const next = { ...on, [key]: !on[key] }
    setOn(next)
    applyMoments(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {}
  }

  if (!on) return null

  return (
    <div className="fixed bottom-4 right-4 z-[70] w-72 border border-ink/15 bg-paper font-nunito text-[0.875rem] text-ink shadow-[0_16px_40px_-16px_rgba(13,13,24,0.35)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left font-montserrat font-semibold"
        aria-expanded={open}
      >
        Animation demo (local only)
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="space-y-2 border-t border-hairline px-4 py-3">
          {MOMENTS.map((m) => (
            <li key={m.key}>
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={!!on[m.key]}
                  onChange={() => toggle(m.key)}
                  className="h-4 w-4 accent-[#7002AB]"
                />
                {m.label}
              </label>
            </li>
          ))}
          <li className="pt-1 text-[0.8125rem] text-muted">Scroll the homepage and open About to see each one.</li>
        </ul>
      )}
    </div>
  )
}
