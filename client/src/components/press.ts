/**
 * Act on the press, not on the release.
 *
 * `click` is dispatched when the pointer comes back up, which on a touch
 * screen is 80–150 ms after the finger landed and on a mouse a good part of
 * that. Every hop between a player's finger and the table is on the critical
 * path of a mechanic decided by arrival order (see "the realtime path" in
 * docs/notes/client.md), and this one was the longest hop nothing measured:
 * an interject or a Contre-LOCO! lost to a player whose press had landed
 * *later*, because their finger left the glass sooner.
 *
 * So the handler runs on `pointerdown`, for the primary button, and the
 * `click` that follows the same press is swallowed. A click that no press
 * preceded — the keyboard's Enter or Space on a real button, a synthetic one —
 * still runs it, so nothing that was reachable stops being reachable. A
 * disabled control fires nothing on either path: Chromium dispatches pointer
 * events on disabled form controls, and the attribute is the answer, not the
 * event.
 *
 * What is given up is cancelling a press by sliding off the control before
 * letting go. On a board built around five-second windows that was never a
 * gesture anybody made on purpose.
 */
export type PressHandler = (e: MouseEvent) => void

export function pressToAct(
  node: HTMLElement,
  handler: PressHandler | undefined,
): { update(next: PressHandler | undefined): void; destroy(): void } {
  let current = handler
  // Set by a press, read by the click the same press produces. Reset a tick
  // after the release rather than on it: the click is dispatched after the
  // pointerup and before the next task, so a reset on pointerup would let the
  // click through and the press would count twice.
  let pressed = false
  let reset: ReturnType<typeof setTimeout> | null = null

  const disabled = () => (node as HTMLButtonElement).disabled === true

  const down = (e: PointerEvent) => {
    if (!current || disabled()) return
    if (e.button !== 0) return
    pressed = true
    current(e)
  }
  const release = () => {
    if (reset !== null) clearTimeout(reset)
    reset = setTimeout(() => {
      pressed = false
      reset = null
    }, 0)
  }
  const click = (e: MouseEvent) => {
    if (pressed) {
      e.stopImmediatePropagation()
      e.preventDefault()
      return
    }
    if (!current || disabled()) return
    current(e)
  }

  node.addEventListener('pointerdown', down)
  node.addEventListener('pointerup', release)
  node.addEventListener('pointercancel', release)
  node.addEventListener('click', click)

  return {
    update(next) {
      current = next
    },
    destroy() {
      if (reset !== null) clearTimeout(reset)
      node.removeEventListener('pointerdown', down)
      node.removeEventListener('pointerup', release)
      node.removeEventListener('pointercancel', release)
      node.removeEventListener('click', click)
    },
  }
}
