/**
 * The two gestures a sheet is expected to answer, added on top of <details>.
 *
 * The markup in `layouts/GamePage.astro` opens and closes with no script at all,
 * which is the point: it is the indexable half of the home page and it has to
 * work for whoever arrives with the bundle still in flight. This only adds Esc
 * and a click on the scrim, and hands focus back to the control it came from.
 *
 * Loaded by an ordinary bundled <script>, never `is:inline`: nginx sends
 * `script-src 'self'` and an inline block would simply be refused in production.
 */
import { closeMenuWhenWidened } from './content/navMenu'

// The phone's drawer, shut the moment the window is wide enough for the footer
// row to be the navigation again — otherwise it stands over a page that has its
// own links back, with the burger that closes it gone. The sheet below is the
// wide screen's half of the same job.
closeMenuWhenWidened()

/**
 * The drawer's one action, and the one place on this page where markup Astro
 * rendered has to reach the application mounted beside it.
 *
 * A custom event rather than a shared store: the drawer is in `#root`'s sibling,
 * not in its tree, so there is nothing to pass a callback through, and the
 * alternative — exporting a setter off a module both halves import — would put
 * the app's bundle behind this script. `<Preferences />` listens for it; only
 * one screen is ever mounted, so only one panel ever opens.
 *
 * The button ships `hidden` and is revealed here, for the reason the content
 * pages' theme switch is: with no script it opens nothing, and a control that
 * does nothing is worse than one that is not there.
 */
const prefsRow = document.querySelector<HTMLButtonElement>('#navPrefs')
if (prefsRow) {
  prefsRow.hidden = false
  prefsRow.addEventListener('click', () => {
    // Shut first: `hidePopover` hands the focus back to the burger, so the
    // panel opens over a closed drawer and the way out lands somewhere real.
    document.getElementById('navPop')?.hidePopover()
    window.dispatchEvent(new CustomEvent('loco:preferences'))
  })
}

const sheet = document.querySelector<HTMLDetailsElement>('.homeSheet')
const panel = sheet?.querySelector<HTMLElement>('.homeSheetPanel')
const control = sheet?.querySelector<HTMLElement>('.homeSheetBtn')

function close() {
  if (!sheet?.open) return
  sheet.open = false
  control?.focus()
}

if (sheet && panel) {
  // The scrim is the panel itself; the card sits inside it, so a click that
  // never left the panel is a click outside the card.
  panel.addEventListener('click', (e) => {
    if (e.target === panel) close()
  })
  // Only while open, so this never eats an Escape the game wanted. The footer is
  // display:none from the first seat onwards and cannot be open by then anyway.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet.open) close()
  })
}
