import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const CLIENT = path.resolve(__dirname, '..', '..')
const astroConfig = readFileSync(path.join(CLIENT, 'astro.config.mjs'), 'utf8')
// Both halves of the socket. `webSocket.svelte.ts` hands `import.meta.env`
// straight to `webSocketPolicy.ts`, which is where the names now are, so
// scanning only the first would leave this guard asserting nothing.
const socket = [
  readFileSync(path.join(CLIENT, 'src', 'hooks', 'webSocket.svelte.ts'), 'utf8'),
  readFileSync(path.join(CLIENT, 'src', 'hooks', 'webSocketPolicy.ts'), 'utf8'),
].join('\n')

/**
 * The failure this file exists for is silent by construction. Astro narrows
 * Vite's env prefix to `PUBLIC_`, so an `import.meta.env.VITE_*` read survives
 * the transform untouched and evaluates to `undefined` in the browser. Nothing
 * warns. `webSocket.svelte.ts` then falls back to same-origin `/ws`, which in dev is
 * the Vite dev server proxying nothing, and the only thing a player sees is a
 * table that never opens behind a console line about port 5173.
 */
describe('dev WebSocket wiring', () => {
  it('exposes to the browser every env prefix webSocket.svelte.ts reads', () => {
    const declared = astroConfig.match(/envPrefix:\s*(\[[^\]]*\]|'[^']*')/)?.[1]
    expect(declared, 'astro.config.mjs must declare envPrefix').toBeTruthy()

    // Every build-time name the socket path uses, however it is spelled: an
    // `import.meta.env.VITE_X` read, or a field on the env object the hook hands
    // to the policy. Both reach the browser through envPrefix and both are
    // `undefined` without it.
    const reads = [...socket.matchAll(/\b([A-Z0-9]+_)[A-Z0-9_]*\b/g)]
      .map((m) => m[1])
      .filter((prefix) => prefix === 'VITE_')
    expect(
      reads.length,
      'the socket must read its address from the env — is envPrefix still load-bearing?',
    ).toBeGreaterThan(0)
    expect(socket, 'the dev socket port is what this guard was written for').toContain(
      'VITE_WS_PORT',
    )
    for (const prefix of new Set(reads)) {
      expect(declared, `${prefix}* is read but not exposed`).toContain(prefix)
    }
  })
})
