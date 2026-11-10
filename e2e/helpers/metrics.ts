/**
 * The server's operator surface, read by the few tests that need a number the
 * wire deliberately never carries (the 1v1 queue's size, the solo count).
 *
 * Two servers answer `/metrics` during the migration: the Go one with a JSON
 * object, the Rust one with Prometheus text (`name value` lines) under the same
 * names. The format is detected from the body rather than configured, so the
 * suite runs unchanged against either until the Go server is deleted.
 */

/** Where the game server is. `LOCO_E2E_WS_PORT` moves it off :8080. */
export const SERVER_PORT = process.env.LOCO_E2E_WS_PORT ?? process.env.VITE_WS_PORT ?? '8080'
export const METRICS_URL = `http://localhost:${SERVER_PORT}/metrics`

/** One metric out of a `/metrics` body in either format, or null. */
export function parseMetric(body: string, name: string): number | null {
  const trimmed = body.trimStart()
  if (trimmed.startsWith('{')) {
    try {
      const v = (JSON.parse(trimmed) as Record<string, unknown>)[name]
      return typeof v === 'number' ? v : null
    } catch {
      return null
    }
  }
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
