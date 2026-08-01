import { useEffect, useRef, useState } from 'react'

const OVERLAY_MS = 600

// useReconnectAnimation orchestrates the post-reconnect visual recovery flow:
//   1. show "Rebuilding table…" overlay for OVERLAY_MS
//   2. clear the isReconnecting flag so the board can fade back in
//
// The fade-in itself lives in <GameBoard /> (keyed by an internal rebuildKey
// that bumps when isReconnecting transitions back to false).
//
// Nothing but the timer ends this overlay, so anything that can swallow the
// timer strands it over a live table. A ref used to guard against replaying the
// animation, and it outlived the timer it was guarding: a reload mounts
// <GameView /> with isReconnecting already true, StrictMode mounts the effect
// twice in dev, and the second pass returned early on the ref the first pass had
// set while its cleanup had already cleared the timer. The overlay never came
// down and isReconnecting was never cleared. The effect re-runs only when
// isReconnecting actually changes, so re-arming on every run is both correct and
// the whole guard that is needed. See src/test/reconnectAnimation.test.tsx.
export function useReconnectAnimation(
  isReconnecting: boolean,
  onComplete: () => void,
): boolean {
  const [showOverlay, setShowOverlay] = useState(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    // A reconnect that resolves before the timer must take the overlay with it,
    // rather than leave it standing on a cancelled timeout.
    if (!isReconnecting) {
      setShowOverlay(false)
      return
    }

    setShowOverlay(true)
    const id = setTimeout(() => {
      setShowOverlay(false)
      onCompleteRef.current()
    }, OVERLAY_MS)
    return () => clearTimeout(id)
  }, [isReconnecting])

  return showOverlay
}
