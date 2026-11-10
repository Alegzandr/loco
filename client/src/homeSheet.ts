/**
 * The two gestures a sheet is expected to answer, added on top of <details>.
 *
 * The markup in `layouts/GamePage.svelte` opens and closes with no script at
 * all, which is the point: it is the indexable half of the home page and it has
 * to work for whoever arrives with the bundle still in flight, or with none. This
 * only adds Esc and a click on the scrim, and hands focus back to the control it
 * came from.
 *
 * Wired by the game page when it mounts and unwired when the router replaces
 * it, so a page arrived at twice is listened to once.
 */
import { closeMenuWhenWidened } from './content/navMenu'
import { getLang, setLang } from './i18n/store'
import { isLang, langUrl } from './lang'
import { swapServedLang } from './langSwap'

export function wireHomeSheet(): () => void {
  const undo: (() => void)[] = []
  const on = (target: EventTarget, type: string, fn: (e: Event) => void) => {
    target.addEventListener(type, fn)
    undo.push(() => target.removeEventListener(type, fn))
  }

  // The phone's drawer, shut the moment the window is wide enough for the footer
  // row to be the navigation again — otherwise it stands over a page that has its
  // own links back, with the burger that closes it gone. The sheet below is the
  // wide screen's half of the same job.
  undo.push(closeMenuWhenWidened())

  // The bar's globe — the same panel, in the same place, as on every content
  // page — but here a pick does what the gear's language does rather than
  // follow its link: this is the one page that translates itself in place
  // (`langSwap.ts`), so the game, the bar and the address bar all change
  // together and nothing reloads. The links stay real `<a href>`s for a crawler
  // and for a reader with no script, who get the other home by navigation.
  // Capture phase, so the router never sees a click it would turn into a
  // navigation to the page already on screen.
  const onPick = (e: MouseEvent) => {
    const link = (e.target as Element | null)?.closest?.('#langPop a[lang]')
    const code = link?.getAttribute('lang')
    if (!isLang(code)) return
    e.preventDefault()
    try {
      document.getElementById('langPop')?.hidePopover()
    } catch {
      /* already shut */
    }
    const shown = getLang()
    if (code === shown) return
    setLang(code)
    swapServedLang(
      langUrl(code, document.documentElement.dataset.servedLang, shown, location.search, location.hash),
    )
  }
  document.addEventListener('click', onPick, true)
  undo.push(() => document.removeEventListener('click', onPick, true))

  /**
   * The drawer's one action, and the one place on this page where served markup
   * has to reach the application mounted beside it.
   *
   * A custom event rather than a shared store: the drawer is in `#root`'s
   * sibling, not in its tree, so there is nothing to pass a callback through.
   * `<Preferences />` listens for it; only one screen is ever mounted, so only
   * one panel ever opens.
   *
   * The button ships `hidden` and is revealed here: with no script it opens
   * nothing, and a control that does nothing is worse than one that is not there.
   */
  const prefsRow = document.querySelector<HTMLButtonElement>('#navPrefs')
  if (prefsRow) {
    prefsRow.hidden = false
    on(prefsRow, 'click', () => {
      // Shut first: `hidePopover` hands the focus back to the burger, so the
      // panel opens over a closed drawer and the way out lands somewhere real.
      document.getElementById('navPop')?.hidePopover()
      window.dispatchEvent(new CustomEvent('loco:preferences'))
    })
  }

  const sheet = document.querySelector<HTMLDetailsElement>('.homeSheet')
  const scrim = document.querySelector<HTMLElement>('.homeSheetScrim')
  const summary = sheet?.querySelector<HTMLElement>('.homeSheetBtn')
  const closeX = sheet?.querySelector<HTMLButtonElement>('.homeSheetX')

  /**
   * What the focus goes back to when the sheet shuts.
   *
   * The summary on a wide screen, the drawer's row on a phone — where the summary
   * is `display: none` and focusing it would drop the caret on the body, which is
   * the top of the document and not where the reader was.
   */
  let opener: HTMLElement | null | undefined = summary

  function close() {
    if (!sheet?.open) return
    sheet.open = false
    opener?.focus()
  }

  if (sheet) {
    // The scrim is a sibling of the card, not its parent — the card is the
    // <details> element itself — so anything reaching this element is a press that
    // landed beside the card rather than on it.
    if (scrim) on(scrim, 'click', close)

    // The ✕ beside the title, which only a script can wire: the footer button is
    // the <summary> and closes the sheet on its own, this one has nothing native
    // behind it. Revealed here for the reason the drawer's Preferences row is —
    // with no bundle it would be a control that does nothing.
    if (closeX) {
      closeX.hidden = false
      on(closeX, 'click', close)
    }

    // Only while open, so this never eats an Escape the game wanted. The footer is
    // display:none from the first seat onwards and cannot be open by then anyway.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sheet.open) close()
    }
    document.addEventListener('keydown', onKey)
    undo.push(() => document.removeEventListener('keydown', onKey))

    /*
     * The phone's way into the same sheet.
     *
     * Under 46rem the footer row is display:none and the drawer carries no prose,
     * so a first visit on a phone was a logo, a tagline, two buttons and a burger
     * — and nothing about the game. The prose was in the document the whole time;
     * this is the press that reaches it.
     *
     * Revealed here for the reason the Preferences row is: with no bundle there is
     * nothing to open. The drawer is shut first, so the sheet's own way out (the
     * scrim, the ✕, Escape) lands on a screen with one thing on it.
     */
    const aboutRow = document.querySelector<HTMLButtonElement>('#navAbout')
    if (aboutRow) {
      aboutRow.hidden = false
      on(aboutRow, 'click', () => {
        document.getElementById('navPop')?.hidePopover()
        // The way back is this row, not the summary: at this width the summary is
        // `display: none` and focusing it would put the caret on the body.
        opener = aboutRow
        sheet.open = true
      })
    }

    // Opened from the footer button again, so the way back is the footer button
    // again. Without this the caret stayed on a row nobody can see once the window
    // is wide enough for the drawer to be gone.
    if (summary) {
      on(summary, 'click', () => {
        opener = summary
      })
    }
  }

  return () => {
    for (const fn of undo.splice(0)) fn()
  }
}
