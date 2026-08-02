import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n'
import { MotionGate } from './components/MotionGate'
import { initTheme } from './hooks/useTheme'
import { initMotion } from './hooks/useMotionPref'
import { initSessionRestore } from './hooks/useSessionRestore'
import { initTableInvite } from './hooks/tableInvite'
import { initLangUrl } from './lang'

/**
 * The game, mounted into #root by a module script.
 *
 * Deliberately *not* an Astro island. `client:only` works, but Astro ships its
 * hydration runtime as two inline <script> blocks in the HTML, and
 * `client/nginx.conf` sends `script-src 'self'` with no 'unsafe-inline': in
 * production those blocks are refused, the island never hydrates and the page is
 * blank. Astro's own CSP support emits hashes in a <meta>, which does not help
 * either — a meta policy and a header policy are both enforced, so the header
 * still blocks them. An ordinary <script> in a .astro file is bundled to an
 * external module instead, which the policy allows, and it is exactly the
 * mechanism the app already used under Vite. See src/test/csp.test.ts.
 */

/**
 * Dev-only visual showcase. `?showcase` mounts a gallery of every screen/state
 * instead of the app so the whole UI can be reviewed (and screenshotted) without
 * a server. `import.meta.env.DEV` is statically false in production builds, so
 * Rollup drops the branch and never emits the chunk. Keeping the query-string
 * contract rather than moving to a route is what leaves tools/visual/shoot.mjs
 * and tools/og/shoot.mjs untouched.
 */
async function resolveRoot(): Promise<React.ReactNode> {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('showcase')) {
    const { Showcase } = await import('./dev/Showcase')
    return <Showcase />
  }
  return <App />
}

/**
 * The home page arrives in one piece.
 *
 * `/` is half markup Astro served (the footer row, the phone's burger, the
 * prose behind the sheet) and half application mounted here from a bundle, and
 * nothing held the two together: the canvas and the static half painted on the
 * first frame, the lobby appeared whenever the bundle finished. Both halves wait
 * on this attribute instead and fade in together — see the boot rules in
 * `layouts/GamePage.astro`, which also carry the fallback that reveals the page
 * if this never runs.
 *
 * Two frames, not one: `render()` schedules the work, so the first callback runs
 * with the commit still pending and the fade would start over an empty #root.
 *
 * The value is then spent. What fades is the app's mounted child rather than
 * #root itself — fading the mount point showed the body's gradient through it,
 * which no screen is ever meant to display — and every screen is a fresh child,
 * so a live reveal rule would replay on each one for the rest of the match. The
 * bare attribute is what lifts the hold and it stays; `in` is the animation and
 * it lasts one fade.
 */
const BOOT_FADE_MS = 600

function markBooted() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const root = document.documentElement
      root.dataset.booted = 'in'
      window.setTimeout(() => {
        root.dataset.booted = ''
      }, BOOT_FADE_MS)
    })
  })
}

function boot() {
  // Write data-theme before the first paint: screens without a <ThemeToggle />
  // would otherwise render in the light palette regardless of the user's choice.
  initTheme()

  // Same reason, for the same kind of preference: every reduced-motion rule in
  // the CSS hangs off `data-motion`, and nothing writes that attribute until this
  // runs. Without it a player whose system asks for less motion got the full set
  // of animations for the whole session unless they happened to open Preferences
  // and toggle the switch themselves — the OS setting alone never reached the
  // stylesheet. This also registers the listener that keeps `auto` following the
  // system while the tab is open.
  initMotion()

  // A table link carries its code in the URL, and it has to be read before the
  // line below decides whether this tab is reclaiming a seat: following a link is
  // a fresh intent and outranks a stored record naming another table. It also
  // takes the code straight back out of the address bar — see hooks/tableInvite.ts.
  initTableInvite()

  // A reloaded tab has to know it is reclaiming a seat *before* the socket opens:
  // the rejoin is sent from the very first onopen, and useWebSocket connects in an
  // effect on App's first mount. Seeding the store here, next to the theme and for
  // the same reason, is what puts the restoring screen on the first paint instead
  // of a flash of lobby.
  initSessionRestore()

  resolveRoot().then((node) => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        {/* Transform and layout animations snap to their end state while opacity
            still fades, so the game stays readable without motion. CSS
            transitions are disabled alongside it in tokens.css, off the same
            preference — see <MotionGate />. */}
        <MotionGate>
          <I18nProvider>{node}</I18nProvider>
        </MotionGate>
      </React.StrictMode>,
    )
    markBooted()
  })
}

/**
 * First, before anything reads the URL or writes to storage: is this document
 * even in the right language?
 *
 * Half of this page is markup Astro built per URL, and a stored choice outranks
 * the URL when the app picks its language — so `/` with French stored rendered
 * the game in French under an English footer, on an `<html lang="fr">`.
 * `initLangUrl()` sends the document to `/fr/` instead, where both halves agree.
 * See `src/lang.ts` for why this is a navigation rather than a translation.
 *
 * It has to run before `initTableInvite()`, which takes `?t=CODE` back out of the
 * address bar: spending the invitation and then navigating would land the guest
 * at a home page with no table in it. The redirect carries the query string
 * across untouched, so the invitation is read once, on the page that keeps it.
 *
 * Nothing else boots when it returns true. The page holds at `opacity: 0` until
 * `data-booted` (see layouts/GamePage.astro), so a document on its way out shows
 * its own flat canvas rather than one frame of the wrong language.
 */
if (!initLangUrl()) boot()
