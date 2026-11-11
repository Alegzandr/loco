/**
 * Booting the client's dev server (Vite with the SvelteKit plugin), shared by
 * the capture harnesses (`tools/visual/shoot.mjs`, `tools/og/shoot.mjs`,
 * `tools/rooms/shoot.mjs`, `tools/cover/shoot.mjs`).
 *
 * They render real components with no server and no WebSocket, so they need the
 * same throwaway dev server on a port nothing else uses. They drive the game
 * through `/?showcase=<id>`, which is a query string on the one page the app
 * lives on, so none of them cares which framework owns the routing.
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
        if (Date.now() > deadline) reject(new Error(`the dev server did not start on :${port}`))
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
 * `--strictPort` matters more than it looks: without it a busy port makes the
 * dev server quietly move to the next one, `waitForPort` then waits out its full
 * timeout, and the harness reports "did not start" for a server that is running
 * perfectly well one port over. Vite takes no lock, so a harness server runs
 * beside `make dev` without either noticing the other.
 */
export async function startDevServer(port) {
  const bin = path.join(ROOT, 'client', 'node_modules', 'vite', 'bin', 'vite.js')
  const env = { ...process.env, VITE_HMR_CLIENT_PORT: String(port), LOCO_STRICT_PORT: '1' }

  const child = spawn(process.execPath, [bin, 'dev', '--port', String(port), '--strictPort'], {
    cwd: path.join(ROOT, 'client'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  })
  child.stdout.on('data', () => {})
  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d.toString() })
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`vite exited (${code})\n${stderr}`)
  })
  await waitForPort(port)
  return child
}
