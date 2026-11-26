// Lets `npx vitest run` resolve the @/ imports the app uses (tsconfig "paths"). Vitest isn't a dependency, so run it
// with npx; plain JS keeps this file out of the Next.js type check.
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '')

export default {
  resolve: { alias: { '@': root } },
  test: { include: ['lib/__tests__/**/*.test.ts'] },
}
