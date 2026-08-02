import { useEffect, useRef } from 'react'
import { useMapPreload } from './useMapPreload'
import type { MapDef } from '../components/cards/maps'
import type { ClientMsg } from '../types/protocol'

/**
 * The loading gate, from this client's side: preload the room's art while the
 * table is shut, then tell the server the moment we are in.
 *
 * `useMapPreload` reports when the images are *decoded*, not merely downloaded:
 * the whole point of the wait is that the first turn does not spend a frame on
 * a WebP.
 *
 * The once-per-gate guard is a ref rather than a dependency because `mapLoading`
 * gets a new identity on every progress broadcast (each time *another* player
 * arrives), and keying the effect on the object itself would re-send map_ready
 * once per opponent. A map we have no art for is ready immediately: there is
 * nothing to fetch, and a client that never answers is the one outcome the gate
 * cannot survive.
 */
export function useMapGate(
  map: MapDef | null,
  gateOpen: boolean,
  onSend: (msg: ClientMsg) => void,
) {
  const preload = useMapPreload(map, gateOpen)
  const nothingToLoad = map === null
  const sentReady = useRef(false)

  useEffect(() => {
    if (!gateOpen) {
      sentReady.current = false
      return
    }
    if (sentReady.current) return
    if (!preload.done && !nothingToLoad) return
    sentReady.current = true
    onSend({ type: 'map_ready' })
  }, [gateOpen, preload.done, nothingToLoad, onSend])

  return preload
}
