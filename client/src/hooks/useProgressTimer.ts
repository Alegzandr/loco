import { useEffect, useRef, useState } from 'react'

// useProgressTimer drives a 0..100 percentage from `now` toward `deadline` (ms
// since epoch), updated on every animation frame. When `deadline` is null or
// already past, the value is 0.
//
// `totalMs` defines what 100% means:
//  - pass a fixed number for fixed-duration windows (e.g. UNO catch = 5000)
//  - pass `'auto'` to anchor totalMs to (deadline - now) at the moment the
//    deadline becomes active, so the bar starts at 100% regardless of duration.
export function useProgressTimer(
  deadline: number | null,
  totalMs: number | 'auto',
): number {
  const [pct, setPct] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (!deadline) {
      setPct(0)
      return
    }
    const total = totalMs === 'auto' ? deadline - Date.now() : totalMs
    if (total <= 0) {
      setPct(0)
      return
    }
    const tick = () => {
      const remaining = deadline - Date.now()
      const next = Math.max(0, Math.min(100, (remaining / total) * 100))
      setPct(next)
      if (next > 0) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [deadline, totalMs])

  return pct
}
