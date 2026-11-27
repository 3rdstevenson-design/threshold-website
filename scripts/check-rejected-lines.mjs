// Lars, 2026-11-26: "When the pain backs off, you're halfway there" and "Test it, then trust it" aren't his words and he
// never signed off on them. This runs before every build (package.json "build") and fails it if either line, or the
// framing around the first, shows up in a page, component or data file. lib/__tests__/rejected-lines.test.ts checks
// the same list in the tests.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REJECTED = [/halfway/i, /rest of the way/i, /pain backs off/i, /other half/i, /then trust it/i]
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (name === '__tests__' || name === 'node_modules') return []
    if (statSync(p).isDirectory()) return files(p)
    return /\.(tsx?|mdx?|json|css)$/.test(p) ? [p] : []
  })
}

const hits = []
for (const dir of ['app', 'components', 'lib']) {
  for (const f of files(join(root, dir))) {
    const text = readFileSync(f, 'utf8')
    for (const re of REJECTED) if (re.test(text)) hits.push(`${relative(root, f)} matches ${re}`)
  }
}
if (hits.length) {
  console.error(`Rejected copy found (Lars, 2026-11-26). Take it out before building:\n${hits.join('\n')}`)
  process.exit(1)
}
console.log('Rejected-copy check passed.')
