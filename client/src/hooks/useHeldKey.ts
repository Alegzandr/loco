import { useEffect, useState } from 'react'

/**
 * True while `key` is physically held down.
 *
 * Two things this has to get right, both learned from how a held-key overlay
 * fails in practice:
 *
 * - The keyup never arrives if the window loses focus mid-hold (alt-tab, a
 *   notification stealing focus), so `blur` resets the state. Without it the
 *   overlay stays stuck over the board with no way to dismiss it.
 * - Taking a key that the browser already uses (Tab moves focus) means owning
 *   its default too, hence preventDefault. That is also why callers pass
 *   `enabled: false` while a modal or picker is open, inside a dialog, Tab
 *   belongs to the dialog.
 */
export function useHeldKey(key: string, enabled = true): boolean {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setHeld(false)
      return
    }
    const down = (e: KeyboardEvent) => {
      if (e.key !== key) return
      e.preventDefault()
      setHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key !== key) return
      e.preventDefault()
      setHeld(false)
    }
    const release = () => setHeld(false)

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
    }
  }, [key, enabled])

  return held
}
