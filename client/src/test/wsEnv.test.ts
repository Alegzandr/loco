import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const CLIENT = path.resolve(__dirname, '..', '..')
const astroConfig = readFileSync(path.join(CLIENT, 'astro.config.mjs'), 'utf8')
const useWebSocket = readFileSync(path.join(CLIENT, 'src', 'hooks', 'useWebSocket.ts'), 'utf8')

/**
 * The failure this file exists for is silent by construction. Astro narrows
 * Vite's env prefix to `PUBLIC_`, so an `import.meta.env.VITE_*` read survives
 * the transform untouched and evaluates to `undefined` in the browser. Nothing
 * warns. `useWebSocket` then falls back to same-origin `/ws`, which in dev is
 * the Vite dev server proxying nothing, and the only thing a player sees is a
 * table that never opens behind a console line about port 5173.
 */
describe('dev WebSocket wiring', () => {
  it('exposes to the browser every env prefix useWebSocket reads', () => {
    const declared = astroConfig.match(/envPrefix:\s*(\[[^\]]*\]|'[^']*')/)?.[1]
    expect(declared, 'astro.config.mjs must declare envPrefix').toBeTruthy()

    const reads = [...useWebSocket.matchAll(/import\.meta\.env\.([A-Z0-9]+_)[A-Z0-9_]+/g)].map(
      (m) => m[1],
    )
    expect(reads.length, 'useWebSocket must read the socket port from the env').toBeGreaterThan(0)
    for (const prefix of new Set(reads)) {
      expect(declared, `${prefix}* is read but not exposed`).toContain(prefix)
    }
  })
})
