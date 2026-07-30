/**
 * Booting the client's Vite dev server, shared by the capture harnesses
 * (`tools/visual/shoot.mjs`, `tools/og/shoot.mjs`).
 *
 * Both render real components with no server and no WebSocket, so both need the
 * same throwaway dev server on a port nothing else uses.
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
        if (Date.now() > deadline) reject(new Error(`vite did not start on :${port}`))
        else setTimeout(tick, 250)
      })
    }
    tick()
  })
}

/** Starts Vite on `port` and resolves once it accepts connections. */
export async function startVite(port) {
  const bin = path.join(ROOT, 'client', 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [bin, '--port', String(port), '--strictPort'], {
    cwd: path.join(ROOT, 'client'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VITE_HMR_CLIENT_PORT: String(port) },
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
