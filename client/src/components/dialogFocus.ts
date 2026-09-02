/**
 * Focus for a panel that blocks the board on a decision.
 *
 * The rules modal, the preferences and the mixer all declare themselves as
 * dialogs and move the focus in; the two panels that stop the whole table on a
 * choice — a wild's colour, a Swap's target — did neither, so a player who
 * reached a card on the keyboard was left focused on it *behind* the scrim,
 * told nothing, with the four swatches nowhere in the tab order they could
 * reach. This is the missing half: focus lands on the first control, Tab and
 * Shift+Tab cycle inside the panel, and whatever had the focus gets it back
 * when the panel goes.
 *
 * A Svelte action, so the markup says `use:dialogFocus` beside the
 * `role="dialog"` it goes with.
 */
export function dialogFocus(node: HTMLElement): { destroy(): void } {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const controls = () =>
    Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]'))

  controls()[0]?.focus()

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const items = controls()
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = e.shiftKey
      ? at <= 0
        ? items.length - 1
        : at - 1
      : at < 0 || at === items.length - 1
        ? 0
        : at + 1
    e.preventDefault()
    items[next].focus()
  }
  node.addEventListener('keydown', onKey)

  return {
    destroy() {
      node.removeEventListener('keydown', onKey)
      // A card that has left the hand is a detached node; focusing it is a
      // no-op, which is the right answer for a play that was confirmed.
      if (previous?.isConnected) previous.focus()
    },
  }
}
