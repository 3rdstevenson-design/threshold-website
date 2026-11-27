import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Lars, 2026-11-26: "I never say that/have never said that and I never signed off on it." The 2026-11-12 USP line
// and its framing stay off every page, component and data file. Copy in his name uses his own words or lines he
// approved word for word. scripts/check-rejected-lines.mjs runs the same list before every build.
// Lars, the same day: "Test it, then trust it" goes too.
const REJECTED = [/halfway/i, /rest of the way/i, /pain backs off/i, /other half/i, /then trust it/i]
const ROOT = process.cwd()

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (p.includes('__tests__')) return []
    if (statSync(p).isDirectory()) return files(p)
    return /\.(tsx?|mdx?|json|css)$/.test(p) ? [p] : []
  })
}

describe('rejected lines (Lars, 2026-11-26)', () => {
  it('keeps the old USP line and its framing off the site', () => {
    const hits: string[] = []
    for (const dir of ['app', 'components', 'lib']) {
      for (const f of files(join(ROOT, dir))) {
        const text = readFileSync(f, 'utf8')
        for (const re of REJECTED) if (re.test(text)) hits.push(`${f.slice(ROOT.length + 1)} matches ${re}`)
      }
    }
    expect(hits).toEqual([])
  })
})
