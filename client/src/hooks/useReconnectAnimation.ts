import { RefObject, useEffect, useRef, useState } from 'react'
import type { PixiGame, GameRenderState } from '../game/PixiGame'

const OVERLAY_MS = 600

// useReconnectAnimation orchestrates the post-reconnect visual recovery flow:
// 1. show "Rebuilding table…" overlay for OVERLAY_MS
// 2. ask PixiGame to staggered-fade-in discard, bubbles, and hand
// 3. clear the isReconnecting flag once the animation completes
//
// `getRenderState` is invoked at animation start (after the overlay delay) so
// the snapshot reflects the freshly applied game_state, not whatever was on
// screen when the reconnect first fired. If pixiRef is not yet mounted, the
// overlay still hides and the flag is cleared so the normal render takes over.
export function useReconnectAnimation(
  isReconnecting: boolean,
  pixiRef: RefObject<PixiGame | null>,
  getRenderState: () => GameRenderState,
  onComplete: () => void,
): boolean {
  const [showOverlay, setShowOverlay] = useState(false)
  const animatedRef = useRef(false)
  const getStateRef = useRef(getRenderState)
  const onCompleteRef = useRef(onComplete)
  getStateRef.current = getRenderState
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (!isReconnecting) {
      animatedRef.current = false
      return
    }
    if (animatedRef.current) return
    animatedRef.current = true

    setShowOverlay(true)
    const id = setTimeout(() => {
      setShowOverlay(false)
      const game = pixiRef.current
      if (!game) {
        onCompleteRef.current()
        return
      }
      game.renderReconnect(getStateRef.current(), () => onCompleteRef.current())
    }, OVERLAY_MS)
    return () => clearTimeout(id)
  }, [isReconnecting, pixiRef])

  return showOverlay
}
