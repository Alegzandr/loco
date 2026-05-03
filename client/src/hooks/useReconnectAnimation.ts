import { useEffect, useRef, useState } from 'react'

const OVERLAY_MS = 600

// useReconnectAnimation orchestrates the post-reconnect visual recovery flow:
//   1. show "Rebuilding table…" overlay for OVERLAY_MS
//   2. clear the isReconnecting flag so the board can fade back in
//
// The fade-in itself lives in <GameBoard /> (keyed by an internal rebuildKey
// that bumps when isReconnecting transitions back to false).
export function useReconnectAnimation(
  isReconnecting: boolean,
  onComplete: () => void,
): boolean {
  const [showOverlay, setShowOverlay] = useState(false)
  const animatedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
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
      onCompleteRef.current()
    }, OVERLAY_MS)
    return () => clearTimeout(id)
  }, [isReconnecting])

  return showOverlay
}
