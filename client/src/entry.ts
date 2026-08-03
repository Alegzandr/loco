import { mount, type Component } from 'svelte'
import App from './App.svelte'
import { initI18n } from './i18n/store'
import { initTheme } from './theme'
import { initMotion } from './hooks/motionPref'
import { initSessionRestore } from './hooks/sessionRestore'
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
 * external module instead, which the policy allows. See src/test/csp.test.ts.
 */

/**
 * Dev-only visual showcase. `?showcase` mounts a gallery of every screen/state
 * instead of the app so the whole UI can be reviewed (and screenshotted) without
 * a server. `import.meta.env.DEV` is statically false in production builds, so
 * the bundler drops the branch and never emits the chunk. Keeping the
 * query-string contract rather than moving to a route is what leaves
 * tools/visual/shoot.mjs and tools/og/shoot.mjs untouched.
 */
async function resolveRoot(): Promise<Component<Record<string, never>>> {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('showcase')) {
    const { default: Showcase } = await import('./dev/Showcase.svelte')
    return Showcase as Component<Record<string, never>>
  }
  return App as Component<Record<string, never>>
}

/**
 * The home page arrives in one piece.
 *
 * `/` is half markup Astro served (the footer row, the phone's burger, the prose
 * behind the sheet) and half application mounted here from a bundle, and nothing
 * held the two together: the canvas and the static half painted on the first
 * frame, the lobby appeared whenever the bundle finished. Both halves wait on this
 * attribute instead and fade in together — see the boot rules in
 * `layouts/GamePage.astro`, which also carry the fallback that reveals the page if
 * this never runs.
 *
 * Two frames, not one: the mount schedules the work, so the first callback runs
 * with the commit still pending and the fade would start over an empty #root.
 *
 * The value is then spent. What fades is the app's mounted child rather than
 * #root itself — fading the mount point showed the body's gradient through it,
 * which no screen is ever meant to display — and every screen is a fresh child, so
 * a live reveal rule would replay on each one for the rest of the match. The bare
 * attribute is what lifts the hold and it stays; `in` is the animation and it
 * lasts one fade.
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
  // Write data-theme before the first paint: screens without a theme control
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

  // The language the app renders in, detected once and owned by `i18n/store.ts`
  // from here on. It used to be the provider's first render; there is no provider
  // now, so it is a line in the boot sequence like the two above.
  initI18n()

  // A table link carries its code in the URL, and it has to be read before the
  // line below decides whether this tab is reclaiming a seat: following a link is
  // a fresh intent and outranks a stored record naming another table. It also
  // takes the code straight back out of the address bar — see hooks/tableInvite.ts.
  initTableInvite()

  // A reloaded tab has to know it is reclaiming a seat *before* the socket opens:
  // the rejoin is sent from the very first onopen, and the socket connects in an
  // effect on the app's first mount. Seeding the store here, next to the theme and
  // for the same reason, is what puts the restoring screen on the first paint
  // instead of a flash of lobby.
  initSessionRestore()

  void resolveRoot().then((Root) => {
    mount(Root, { target: document.getElementById('root')! })
    markBooted()
  })
}

/**
 * First, before anything reads the URL or writes to storage: is this document
 * even in the right language?
 *
 * Half of this page is markup Astro built per URL, and a stored choice outranks
 * the URL when the app picks its language — so `/` with French stored rendered the
 * game in French under an English footer, on an `<html lang="fr">`.
 * `initLangUrl()` sends the document to `/fr/` instead, where both halves agree.
 * See `src/lang.ts` for why this is a navigation rather than a translation.
 *
 * It also has to run before anything that can only be read once. `initTableInvite()`
 * is the example: it takes the code back out of the address bar, and spending the
 * invitation on a document that is about to be thrown away would land the guest at
 * a home page with no table in it.
 *
 * Nothing else boots when it returns true. The page holds at `opacity: 0` until
 * `data-booted` (see layouts/GamePage.astro), so a document on its way out shows
 * its own flat canvas rather than one frame of the wrong language.
 */
if (!initLangUrl()) boot()
