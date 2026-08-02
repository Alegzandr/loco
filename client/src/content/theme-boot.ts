/**
 * The one script a content page loads: the theme, applied and switchable.
 *
 * `tokens.css` keys its dark palette on `[data-theme='dark']`, so without this a
 * player who chose the dark theme in the game and then tapped "Rules" would land
 * on a bright white page. It is the same choice `src/entry.tsx` applies, and it
 * imports `src/theme.ts` rather than the hook so it costs a few hundred bytes
 * instead of all of React. The *system* preference no longer depends on any of
 * it: `tokens.css` carries the dark palette behind
 * `@media (prefers-color-scheme: dark)` as well, so the first frame is already
 * right and this has only the stored choice left to apply.
 *
 * The switch is wired here rather than shipped as a second script, because there
 * is only ever one script on these pages. It starts `hidden` in the markup and
 * is revealed below: with JavaScript off a toggle can neither store a choice nor
 * repaint, and a dead control is worse than none — that reader has already been
 * given the theme their system asks for.
 *
 * Astro bundles this to an external module, which is what `script-src 'self'`
 * allows.
 */
import { applyTheme, readInitialTheme, THEME_STORAGE_KEY, type Theme } from '../theme'
import { closeMenuWhenWidened } from './navMenu'

// The mobile drawer, shut the moment the window is wide enough for the bar to be
// the navigation again. Everything else about it is native.
closeMenuWhenWidened()

// ── Theme ──────────────────────────────────────────────────────────────────

let theme: Theme = readInitialTheme()
applyTheme(theme)

// Two of them, and never both on screen: one in the footer bar and one in the
// mobile drawer, which is the same navigation rendered at two widths. They are
// painted and wired together, so whichever one the reader meets is already
// showing the theme they are on.
const buttons = [...document.querySelectorAll<HTMLButtonElement>('.themeBtn')]

if (buttons.length) {
  const paint = () => {
    for (const button of buttons) {
      // Which of the button's two icons is shown, and what a screen reader is
      // told the control is currently set to.
      button.dataset.themeState = theme
      button.setAttribute('aria-pressed', String(theme === 'dark'))
    }
  }

  for (const button of buttons) {
    button.hidden = false
    button.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark'
      // The same key `useTheme` writes, so a choice made on a page is the one
      // the game opens with, and the other way round.
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
      applyTheme(theme)
      paint()
    })
  }

  paint()
}

// ── Back to top ────────────────────────────────────────────────────────────
//
// Wired here rather than shipped as a second script: there is only ever one
// script on these pages. It appears a screenful down and not before, because a
// button offering to take you where you already are is clutter.
const toTop = document.querySelector<HTMLAnchorElement>('.toTop')

if (toTop) {
  toTop.hidden = false

  let shown = false
  const sync = () => {
    // `documentElement.scrollTop` first: it is what a fragment jump moves, and
    // `window.scrollY` has been observed to lag it by a frame on that path.
    const y = document.documentElement.scrollTop || window.scrollY
    // Half a screen, not a whole one. The jump list at the top of the privacy
    // page lands a reader mid-document in one press, and at a full screenful
    // the button they then need was still hidden.
    const past = y > window.innerHeight * 0.5
    if (past === shown) return
    shown = past
    // Presentation only: the CSS owns the fade, so this never runs a layout.
    if (past) toTop.dataset.shown = ''
    else delete toTop.dataset.shown
  }

  sync()
  // Capture, so a scroll inside any scroller on the page is seen too, not only
  // one on the document itself.
  document.addEventListener('scroll', sync, { passive: true, capture: true })
  window.addEventListener('resize', sync, { passive: true })
  // A fragment jump is not guaranteed to emit a scroll event, and it is the one
  // way to travel half a page here without ever touching the wheel.
  window.addEventListener('hashchange', () => requestAnimationFrame(sync))
  document.addEventListener('click', (e) => {
    const link = (e.target as Element | null)?.closest?.('a[href^="#"]')
    // Same hash re-clicked emits no `hashchange`, so the recheck cannot hang off
    // that event alone.
    if (link) requestAnimationFrame(() => requestAnimationFrame(sync))
  })

  toTop.addEventListener('click', (e) => {
    e.preventDefault()
    // Smooth unless the reader asked for less. There is no `data-motion` here:
    // that attribute is the game's, written by a hook these pages never mount,
    // so the system preference is the only answer available.
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' })
    // The href alone would have moved focus to the header; taking it back to the
    // top of the document is what a keyboard reader expects from "back to top".
    document.querySelector<HTMLElement>('.skip')?.focus()
  })
}
