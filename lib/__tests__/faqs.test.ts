import { describe, it, expect } from 'vitest'
import { FAQS } from '../faqs'

const all = Object.entries(FAQS).flatMap(([page, items]) => items.map((f) => ({ page, ...f })))

describe('site FAQs (lib/faqs.ts)', () => {
  it('never repeats a question on another page (Google marks up one instance of a repeated FAQ)', () => {
    const seen = new Map<string, string>()
    for (const f of all) {
      const key = f.q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      expect(seen.get(key), `"${f.q}" is on both ${seen.get(key)} and ${f.page}`).toBeUndefined()
      seen.set(key, f.page)
    }
  })

  it('keeps every page between 4 and 8 questions', () => {
    for (const [page, items] of Object.entries(FAQS)) {
      expect(items.length, page).toBeGreaterThanOrEqual(4)
      expect(items.length, page).toBeLessThanOrEqual(8)
    }
  })

  it('uses no em dashes and no "we" (Voice DNA)', () => {
    for (const f of all) {
      expect(`${f.q} ${f.a}`, f.q).not.toMatch(/—/)
      expect(`${f.q} ${f.a}`, f.q).not.toMatch(/\bwe\b/i)
    }
  })

  it('names no prices', () => {
    for (const f of all) expect(f.a, f.q).not.toMatch(/\$\s?\d/)
  })

  it('keeps Online coaching to coaching words, apart from its one disclaimer question', () => {
    const online = FAQS.onlineCoaching
    const disclaimers = online.filter((f) => /physical therap|treatment|diagnos/i.test(`${f.q} ${f.a}`))
    expect(disclaimers.map((f) => f.q)).toEqual(['Is online coaching the same as physical therapy?'])
    for (const f of online) {
      expect(`${f.q} ${f.a}`, f.q).not.toMatch(/\bDPT\b|\bPT\b|\bDr\.|HSA|FSA/)
    }
  })

  it('ties HSA and FSA to physical therapy only', () => {
    for (const f of all.filter((x) => /\b(HSA|FSA)\b/.test(x.a))) {
      expect(f.page).toBe('physicalTherapy')
      expect(f.a).toMatch(/physical therapy/i)
    }
  })
})
