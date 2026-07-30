import { useEffect, useRef, useState } from 'react'
import { MapDef, mapAssets } from '../components/cards/maps'

/**
 * How long to keep waiting on a map's images before telling the server we are
 * ready anyway.
 *
 * Shorter than the server's own MapLoadTimeout on purpose: the server's is the
 * backstop for a client that has stopped answering entirely, and if the two
 * were equal every slow connection would look like a dead one. A player whose
 * table is still a rectangle when this fires would rather join a match late
 * than sit alone on a loading screen while the room waits them out.
 */
export const MAP_PRELOAD_TIMEOUT_MS = 12_000

export interface MapPreloadState {
  /** 0–1 across the map's files. Drives the bar, never a rules decision. */
  progress: number
  /** True once every file has settled: decoded, failed, or timed out. */
  done: boolean
}

/**
 * Downloads and decodes a map's images, reporting progress.
 *
 * `decode()` rather than the `load` event: `load` fires when the bytes have
 * arrived, not when the browser can paint them, and a 300 kB WebP still costs a
 * frame or two to decode. Waiting for the bytes only would move the stall from
 * the loading screen, where it is honest, into the first turn, which is the
 * one moment of the match that has to be responsive.
 *
 * **A failure counts as done.** An image that 404s or is refused must never
 * leave a player stranded: the board falls back to the built-in felt, which is
 * a worse-looking match, not a broken one. The one unforgivable outcome here is
 * a client that never reports ready.
 */
export function useMapPreload(map: MapDef | null, enabled: boolean): MapPreloadState {
  const [state, setState] = useState<MapPreloadState>({ progress: 0, done: false })
  // Keyed on the map id, not the object, so a re-render with an equal-but-new
  // definition does not restart a load that is already half done.
  const startedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !map) return
    if (startedFor.current === map.id) return
    startedFor.current = map.id

    const files = mapAssets(map)
    let settled = 0
    let cancelled = false

    const bump = () => {
      if (cancelled) return
      settled++
      setState({ progress: settled / files.length, done: settled >= files.length })
    }

    const timer = window.setTimeout(() => {
      if (cancelled) return
      cancelled = true
      setState({ progress: 1, done: true })
    }, MAP_PRELOAD_TIMEOUT_MS)

    setState({ progress: 0, done: false })
    for (const src of files) {
      const img = new Image()
      img.src = src
      // decode() rejects on a broken image; `bump` either way (see above).
      const settle = () => bump()
      if (typeof img.decode === 'function') {
        img.decode().then(settle, settle)
      } else {
        img.onload = settle
        img.onerror = settle
      }
    }

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [map, enabled])

  return state
}
