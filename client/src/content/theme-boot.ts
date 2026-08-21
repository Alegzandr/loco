/**
 * The one script a content page loads: the theme, applied and switchable.
 *
 * `tokens.css` keys its dark palette on `[data-theme='dark']`, so without this a
 * player who chose the dark theme in the game and then tapped "Rules" would land
 * on a bright white page. It is the same choice `src/entry.ts` applies, and it
 * imports `src/theme.ts` — which pulls in no framework — so a content page pays
 * a few hundred bytes and mounts nothing. The *system* preference no longer depends on any of
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
import { applyTheme, getTheme, setTheme, type Theme } from '../theme'
import { isLang, rememberLang } from '../lang'
import { closeMenuWhenWidened } from './navMenu'
import { fillLiveList } from './liveList'

// The mobile drawer, shut the moment the window is wide enough for the bar to be
// the navigation again. Everything else about it is native.
closeMenuWhenWidened()

// The live-channels list on `/live/`, and nothing at all on every other page —
// it returns immediately when there is no list to fill. Here rather than in a
// script of its own for the reason stated above the theme switch: there is only
// ever one script on these pages, so a second behaviour is a few more lines
// rather than a second request. The fetch it makes is same-origin, which is
// what leaves `connect-src` alone. See content/liveList.ts.
fillLiveList()

// ── Language ───────────────────────────────────────────────────────────────
//
// The two links in `#langPop` are real `<a href>`s and stay that way: the href
// is what makes the hreflang pair navigable, and a crawler follows nothing else.
// This only records that the reader *chose*, on the way out.
//
// Without it the choice reached the pages and never the game. A reader who
// switched to French here, read the rules and then pressed "Jouer" arrived at
// `/fr/` with `loco_lang` still saying English — and a stored choice outranks
// the URL — so the game opened in English at a French address. It is the same
// line the lobby's switcher runs before following its own link; both halves of
// the site now write the choice down in the same place.
//
// Delegated from the document rather than bound per link, because the panel is
// opened by two buttons (the bar's globe and the drawer's) and its markup is
// rendered once for both.
document.addEventListener('click', (e) => {
  const link = (e.target as Element | null)?.closest?.('#langPop a[lang]')
  const chosen = link?.getAttribute('lang')
  if (isLang(chosen)) rememberLang(chosen)
})

// ── Theme ──────────────────────────────────────────────────────────────────

// `getTheme()` reads the stored choice — the same one the game reads — and
// `applyTheme` paints it without a fade: there is nothing to fade from on the
// first frame, and crossing into the player's own choice in front of them is the
// flash `themeFlash.test.ts` exists to prevent, animated.
let theme: Theme = getTheme()
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
      // `setTheme` is the whole switch: it stores the choice under the key the
      // game reads, so a theme picked on a page is the one the game opens with
      // and the other way round, and it fades rather than cuts — one definition
      // of what changing the theme looks like, on both halves of the site.
      setTheme(theme)
      paint()
    })
  }

  paint()
}

// ── Smooth in-page travel ──────────────────────────────────────────────────
//
// The attribute `content.css` hangs `scroll-behavior: smooth` off. Read here
// rather than declared in the stylesheet because a reduced-motion reader has to
// keep the instant jump and that file may not carry the media query; there is no
// `data-motion` on these pages either, so the system preference is the only
// answer available. A live listener, not a boot-time read: the setting can be
// flipped while the page is open, and this costs one line to follow.
const fluid = window.matchMedia('(prefers-reduced-motion: reduce)')
const syncScrollMode = () => {
  if (fluid.matches) delete document.documentElement.dataset.scroll
  else document.documentElement.dataset.scroll = 'smooth'
}
syncScrollMode()
fluid.addEventListener('change', syncScrollMode)

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
    window.scrollTo({ top: 0, behavior: fluid.matches ? 'auto' : 'smooth' })
    // The href alone would have moved focus to the header; taking it back to the
    // top of the document is what a keyboard reader expects from "back to top".
    //
    // `detail === 0` is a keyboard activation — Enter or Space on the link — and
    // it is the whole condition, because `:focus-visible` cannot answer this one:
    // Safari treats a programmatic `focus()` as keyboard focus whatever the
    // gesture was, so a tap published "Skip to content" over the wordmark with
    // nothing offering to close it. A pointer press moves no focus at all now.
    //
    // `preventScroll`, and it is the reason the button used to snap: the skip
    // link sits at `top: 0` a screenful off to the left, so focusing it made the
    // browser scroll it into view — instantly, and an instant scroll cancels the
    // smooth one that had just started. The animation was there all along and
    // never got a frame.
    if (e.detail === 0) {
      document.querySelector<HTMLElement>('.skip')?.focus({ preventScroll: true })
    }
  })
}
