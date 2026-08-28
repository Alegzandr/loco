/**
 * No browser menu over the board.
 *
 * A right-click on a table offers "copy image address", "save image as", "search
 * for this image" and a reload — four entries about a document, over a game that
 * is drawing cards, seats and a five-second window. `WaitingRoom.svelte` already
 * refused it row by row, for exactly that reason and with the same
 * `preventDefault`; this is that refusal made the document's, so a long-press on
 * a card face or a stray two-finger tap mid-round costs nothing either.
 *
 * Two things it deliberately is not:
 *
 *   - **Not the whole site.** The gate is `data-seated`, the same one
 *     `pinchGuard.ts` reads and at the same moment (event time, so leaving the
 *     table gives the menu back on the same frame). Everything a visitor *reads*
 *     — `/`, its prose sheet, every content page — keeps the menu: copying a
 *     link, opening a rule in a new tab and translating a page are the ordinary
 *     use of a landing, and taking them would buy nothing.
 *   - **Not a protection.** Nothing here hides anything: the art is in the
 *     bundle either way. It is the same call as `touch-action` at a taken seat —
 *     a gesture that can only be an accident once the seat is taken.
 *
 * It listens on the bubble phase, so a screen that means something by the
 * right-click (the roster row's ⋯ menu) has already run and opened its own thing
 * by the time the browser's is refused.
 */

let installed = false

function refuseWhileSeated(e: Event) {
  if (document.documentElement.hasAttribute('data-seated')) e.preventDefault()
}

/**
 * Refuse the context menu while a seat is taken. Idempotent, and a no-op outside
 * a browser.
 */
export function initContextGuard(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('contextmenu', refuseWhileSeated)
}
