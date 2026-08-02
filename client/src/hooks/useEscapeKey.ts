import { useEffect } from 'react'

/**
 * Escape backs out of anything that opened over the board.
 *
 * Every dismissible surface in the game has to answer this key, and each one
 * answering it with its own `useEffect` is how two of them ended up not
 * answering it at all: the wild colour picker and the swap target picker both
 * had a tap-outside and a ✕ and nothing on the keyboard. The listener is on
 * `document` rather than on the panel because the panels do not take focus —
 * a picker opens under the pointer, not under the caret.
 *
 * `enabled` exists so a control that is merely mounted while shut (the gear,
 * the audio caret) does not eat an Escape meant for whatever is actually open.
 */
export function useEscapeKey(enabled: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [enabled, onEscape])
}
