import { useEffect, useRef, useState } from 'react'

// useCountdown returns the seconds remaining (rounded up) while `active` is true,
// then calls `onExpire` exactly once when totalMs has elapsed. Resets to 0 when
// `active` becomes false. Polled every 250ms — fine for second-resolution UI
// counters. Use useProgressTimer instead for smooth bar animations.
//
// `onExpire` is captured via ref so callers don't need useCallback to keep the
// timer stable across renders.
export function useCountdown(active: boolean, totalMs: number, onExpire: () => void): number {
  const [remainingSec, setRemainingSec] = useState(0)
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  useEffect(() => {
    if (!active) {
      setRemainingSec(0)
      return
    }
    setRemainingSec(Math.ceil(totalMs / 1000))
    const start = Date.now()
    const id = setInterval(() => {
      const remaining = totalMs - (Date.now() - start)
      if (remaining <= 0) {
        clearInterval(id)
        setRemainingSec(0)
        onExpireRef.current()
      } else {
        setRemainingSec(Math.ceil(remaining / 1000))
      }
    }, 250)
    return () => clearInterval(id)
  }, [active, totalMs])

  return remainingSec
}
