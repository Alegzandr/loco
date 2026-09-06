import { mount, type Component } from 'svelte'
import Root from './Root.svelte'
import { initI18n } from './i18n/store'
import { initTabLock } from './hooks/tabLock'
import { initMotion } from './hooks/motionPref'
import { initSessionRestore } from './hooks/sessionRestore'
import { initTableInvite } from './hooks/tableInvite'
import { initLang } from './langSwap'
import { initPinchGuard } from './pinchGuard'
import { initContextGuard } from './contextGuard'

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
function isShowcase(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('showcase')
}

/**
 * Dev-only look panel. `?look=1` on any page mounts the lil-gui panel over the
 * app (`dev/lookPanel.ts`): every number the room's render reads, live. Same
 * gate as the showcase, so neither the panel nor lil-gui reaches a build.
 */
function wantsLookPanel(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('look')
}

async function resolveRoot(): Promise<Component<Record<string, never>>> {
  if (isShowcase()) {
    const { default: Showcase } = await import('./dev/Showcase.svelte')
    return Showcase as Component<Record<string, never>>
  }
  return Root as Component<Record<string, never>>
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
  // First, before anything reads the URL or renders a word: is this document
  // even in the right language?
  //
  // Half of `/` is markup Astro built per URL, and a stored choice outranks the
  // URL when the app picks its language — so `/` with French stored rendered the
  // game in French under an English footer, on an `<html lang="fr">`. This
  // translates the served markup in place and moves the address bar to `/fr/`,
  // where a reload would find the real document. See `src/langSwap.ts` for why
  // it is a swap rather than the navigation it used to be, and `src/lang.ts` for
  // what is allowed to outrank what.
  //
  // It is also what makes `/` answer a browser set to French: that page is the
  // root, where nobody has said anything yet, and translating it costs no round
  // trip now. `/fr/` is somebody having asked, so nothing overrules it there.
  //
  // It runs ahead of `initTableInvite()` because that one spends the invitation
  // in the address bar, and this rewrites the address bar. Neither loses
  // anything to the other in that order: the swap carries the query string
  // across, and the invite page is built as no language at all, so nothing here
  // touches it.
  initLang()

  // Every reduced-motion rule in the CSS hangs off `data-motion`, and nothing
  // writes that attribute until this runs. Without it a player whose system asks for less motion got the full set
  // of animations for the whole session unless they happened to open Preferences
  // and toggle the switch themselves — the OS setting alone never reached the
  // stylesheet. This also registers the listener that keeps `auto` following the
  // system while the tab is open.
  initMotion()

  // The language the app renders in, detected once and owned by `i18n/store.ts`
  // from here on. It used to be the provider's first render; there is no provider
  // now, so it is a line in the boot sequence like the two above.
  initI18n()

  // Order-free, unlike the five around it: it installs listeners that decide
  // nothing until a gesture arrives, and what they answer to (`data-seated`) is
  // written by App.svelte long after this returns. It is here rather than in a
  // component because a table can be left and taken again, and the guard is the
  // document's for the life of the tab either way. See pinchGuard.ts.
  initPinchGuard()

  // Same shape, same gate, same reason it is here and not in a component: the
  // browser's own menu is refused from the waiting room onwards and given back
  // the moment the seat is. See contextGuard.ts.
  initContextGuard()

  // A table link carries its code in the URL, and it has to be read before the
  // line below decides whether this tab is reclaiming a seat: following a link is
  // a fresh intent and outranks a stored record naming another table. It also
  // takes the code straight back out of the address bar — see hooks/tableInvite.ts.
  initTableInvite()

  // Is this tab even the one holding the game? Ahead of the line below because a
  // tab that is not must do none of what it sets up: no restoring screen, no
  // `join_room` lined up for the first onopen, and above all no socket. The
  // election is one synchronous read, so nothing here waits — see
  // hooks/tabLock.ts for why it is storage rather than a race on a channel.
  //
  // After `initTableInvite()` on purpose: the invitation is spent out of the
  // address bar either way, and a tab that takes the game over later still has it
  // in memory to join with.
  //
  // The gallery sits this out. It mounts no app and opens no socket, so it has
  // nothing to be elected for — and taking part would mean opening `?showcase`
  // (or running `make visual`, which opens several at once) silently drew the
  // curtain over the tab somebody was playing in next door.
  if (!isShowcase()) initTabLock()

  // A reloaded tab has to know it is reclaiming a seat *before* the socket opens:
  // the rejoin is sent from the very first onopen, and the socket connects in an
  // effect on the app's first mount. Seeding the store here, next to the theme and
  // for the same reason, is what puts the restoring screen on the first paint
  // instead of a flash of lobby.
  initSessionRestore()

  void resolveRoot().then((Root) => {
    mount(Root, { target: document.getElementById('root')! })
    markBooted()
    // The constant is repeated here on purpose: folded to `false`, the whole
    // branch goes, and with it the chunk the dynamic import would emit.
    if (import.meta.env.DEV && wantsLookPanel()) void import('./dev/lookPanel').then((m) => m.mountLookPanel())
  })
}

/**
 * Nothing is conditional here any more. The language used to be answered with a
 * navigation, so this line asked whether the document was about to be thrown
 * away and booted nothing when it was; the page holding at `opacity: 0` until
 * `data-booted` (see layouts/GamePage.astro) is what kept a document on its way
 * out from showing one frame of the wrong language. It translates itself now, so
 * there is one boot and the hold covers the swap for free.
 */
boot()
