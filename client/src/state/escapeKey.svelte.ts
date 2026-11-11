/**
 * Escape backs out of anything that opened over the board.
 *
 * One hook for all of them, and that is the rule: every dismissible surface in
 * the game answers this key, and each one answering it with its own effect is
 * how two of them ended up not answering it at all. The listener is on
 * `document` rather than on the panel because the panels do not take focus — a
 * picker opens under the pointer, not under the caret.
 *
 * `enabled` is a getter rather than a value so a control that is merely mounted
 * while shut (the gear, the audio caret) can hand over a live condition and not
 * eat an Escape meant for whatever is actually open.
 */
export function escapeKey(enabled: () => boolean, onEscape: () => void): void {
  $effect(() => {
    if (!enabled()) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
}
