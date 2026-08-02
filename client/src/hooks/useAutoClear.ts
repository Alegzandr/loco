import { useEffect, useRef } from 'react'

/**
 * A piece of table news that takes itself off screen.
 *
 * `trigger` is the identity of the current notice (an `at` timestamp, or the
 * message itself) and the timer re-arms only when it changes. The callback is
 * held in a ref for exactly that reason: written as a dependency, an inline
 * arrow would re-arm the timeout on every render and a notice on a busy board
 * would never reach the end of its own countdown.
 */
export function useAutoClear(trigger: unknown, ms: number, clear: () => void) {
  const cb = useRef(clear)
  cb.current = clear

  useEffect(() => {
    if (!trigger) return
    const id = setTimeout(() => cb.current(), ms)
    return () => clearTimeout(id)
  }, [trigger, ms])
}
