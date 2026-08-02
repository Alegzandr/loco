/**
 * Booting the client's Astro dev server, shared by the capture harnesses
 * (`tools/visual/shoot.mjs`, `tools/og/shoot.mjs`).
 *
 * Both render real components with no server and no WebSocket, so both need the
 * same throwaway dev server on a port nothing else uses. They drive the game
 * through `/?showcase=<id>`, which is a query string on the one page the app
 * lives on, so neither harness cares that Astro now owns the routing.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import net from 'node:net'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      const sock = net.connect(port, '127.0.0.1')
      sock.once('connect', () => { sock.destroy(); resolve() })
      sock.once('error', () => {
        sock.destroy()
        if (Date.now() > deadline) reject(new Error(`astro did not start on :${port}`))
        else setTimeout(tick, 250)
      })
    }
    tick()
  })
}

/**
 * Starts the client's dev server on `port` and resolves once it accepts
 * connections.
 *
 * `--ignore-lock` is not optional. `astro dev` is a singleton: it takes a lock,
 * and a second invocation prints "dev server already running" and exits without
 * ever binding the port it was given. A harness server is throwaway, runs on its
 * own port, and must never join that lock — otherwise `make visual` fails for
 * the sole reason that `make dev` is up in another terminal.
 *
 * `strictPort` matters more than it looks: without it a busy port makes the dev
 * server quietly move to the next one, `waitForPort` then waits out its full
 * timeout, and the harness reports "did not start" for a server that is running
 * perfectly well one port over.
 */
export async function startDevServer(port) {
  const bin = path.join(ROOT, 'client', 'node_modules', 'astro', 'bin', 'astro.mjs')

  // `astro dev` auto-backgrounds itself when it detects an agentic environment
  // (am-i-vibing, off CLAUDECODE / CURSOR_TRACE_ID / AGENT / REPL_ID), and a
  // backgrounded server refuses `--ignore-lock`. This harness owns its server's
  // whole lifetime — it spawns it, polls the port and kills it in a `finally` —
  // so being daemonised behind its back is never right, whoever is at the
  // keyboard. Dropping the markers is how you say "foreground, please".
  const env = { ...process.env, VITE_HMR_CLIENT_PORT: String(port), LOCO_STRICT_PORT: '1' }
  for (const marker of ['CLAUDECODE', 'CURSOR_TRACE_ID', 'AGENT', 'REPL_ID']) delete env[marker]

  const child = spawn(process.execPath, [bin, 'dev', '--port', String(port), '--ignore-lock'], {
    cwd: path.join(ROOT, 'client'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  })
  child.stdout.on('data', () => {})
  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d.toString() })
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`astro exited (${code})\n${stderr}`)
  })
  await waitForPort(port)
  return child
}
