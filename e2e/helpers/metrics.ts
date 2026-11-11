/**
 * The server's operator surface, read by the few tests that need a number the
 * wire deliberately never carries (the 1v1 queue's size, the solo count).
 *
 * `/metrics` is Prometheus text: `name value` lines, `#` comments between them.
 */

/** Where the game server is. `LOCO_E2E_WS_PORT` moves it off :8080. */
export const SERVER_PORT = process.env.LOCO_E2E_WS_PORT ?? process.env.VITE_WS_PORT ?? '8080'
export const METRICS_URL = `http://localhost:${SERVER_PORT}/metrics`

/** One metric out of a `/metrics` body, or null. */
export function parseMetric(body: string, name: string): number | null {
  for (const line of body.split('\n')) {
    if (line.startsWith('#')) continue
    const [key, value] = line.trim().split(/\s+/)
    if (key === name) {
      const n = Number(value)
      return Number.isFinite(n) ? n : null
    }
  }
  return null
}

/** Fetches `/metrics` and reads one metric, or null when it cannot be read. */
export async function readMetric(name: string): Promise<number | null> {
  try {
    const res = await fetch(METRICS_URL)
    if (!res.ok) return null
    return parseMetric(await res.text(), name)
  } catch {
    return null
  }
}
