/**
 * The one thing the drawer cannot do natively: shut when it stops being the
 * navigation.
 *
 * The burger and the drawer only exist under 46rem — above it the footer bar is
 * back and the button that opened this is gone. A window dragged wider, or a
 * phone turned on its side, therefore left a drawer standing over a page whose
 * own navigation was already showing underneath it, with the control that closes
 * it no longer on screen. CSS cannot close a popover, so this is the exception
 * to a content page shipping no behaviour: four lines, on the one script those
 * pages already load.
 *
 * `PHONE` is the same breakpoint `content.css` gates the burger on. Two copies
 * of one number, and the only way to keep them honest is to change them
 * together — `contentPages.test.ts` fails if they drift.
 */
const PHONE = '(max-width: 46rem)'

export function closeMenuWhenWidened(): void {
  const drawer = document.querySelector<HTMLElement>('#navPop')
  if (!drawer?.hidePopover) return

  const phone = window.matchMedia(PHONE)
  phone.addEventListener('change', () => {
    if (phone.matches) return
    // `hidePopover()` throws on an element that is not open, and `:popover-open`
    // is a selector an older engine can refuse outright — neither is worth an
    // uncaught error on a page that otherwise runs no code.
    try {
      if (drawer.matches(':popover-open')) drawer.hidePopover()
    } catch {
      /* no popover support: there was no drawer to close */
    }
  })
}
