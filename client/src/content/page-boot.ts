/**
 * The one script a content page loads.
 *
 * Four behaviours, one request: the phone's drawer shutting when the window
 * widens, the language choice being written down on the way out, the smooth
 * in-page travel and the way back to the top, and on `/live/` the list of who
 * is streaming. Each is a few lines, and each is here rather than in a script
 * of its own because there is only ever one script on these pages — a second
 * behaviour is a second `import` below, never a second `<script>`.
 *
 * It used to boot the theme as well, and was named for it. The site has one
 * palette now (see the head of `styles/tokens.css`), so nothing here paints
 * anything: every control this file touches is `hidden` in the markup and
 * revealed here, because a control that needs a script to do its job must not
 * be offered to a reader whose browser runs none.
 *
 * Astro bundles this to an external module, which is what `script-src 'self'`
 * allows.
 */
import { isLang, rememberLang } from '../lang'
import { closeMenuWhenWidened } from './navMenu'
import { fillLiveList } from './liveList'

// The mobile drawer, shut the moment the window is wide enough for the bar to be
// the navigation again. Everything else about it is native.
closeMenuWhenWidened()

// The live-channels list on `/live/`, and nothing at all on every other page —
// it returns immediately when there is no list to fill. The fetch it makes is
// same-origin, which is what leaves `connect-src` alone. See content/liveList.ts.
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
// It appears a screenful down and not before, because a button offering to
// take you where you already are is clutter.
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
