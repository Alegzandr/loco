import type { Component } from 'svelte'
import Root from './Root.svelte'
import { initI18n } from './i18n/store'
import { initTabLock } from './hooks/tabLock'
import { initMotion } from './hooks/motionPref'
import { initSessionRestore } from './hooks/sessionRestore'
import { initTableInvite } from './hooks/tableInvite'
import { initLang } from './langRoute'
import { initPinchGuard } from './pinchGuard'
import { initContextGuard } from './contextGuard'

/**
 * What the game needs done to the document before its first render, in order,
 * once per document.
 *
 * The root layout (`routes/+layout.svelte`) calls `bootGame()` the first time
 * the router is on a game page, then renders the component it returns into
 * `#root`. Not in `hooks.client.ts`, and not on every page: a tab reading the
 * rules holds no game, and `initTabLock()` electing it would draw the curtain
 * over the tab that does. A document that starts on a content page boots the
 * game the first time it reaches `/`.
 */

/**
 * Dev-only visual showcase. `?showcase` renders a gallery of every screen/state
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
 * Dev-only look panel. `?look=1` on any game page mounts the lil-gui panel over
 * the app (`dev/lookPanel.ts`): every number the room's render reads, live. Same
 * gate as the showcase, so neither the panel nor lil-gui reaches a build.
 */
export function mountLookPanelIfAsked(): void {
  // The constant is repeated here on purpose: folded to `false`, the whole
  // branch goes, and with it the chunk the dynamic import would emit.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('look')) {
    void import('./dev/lookPanel').then((m) => m.mountLookPanel())
  }
}

/**
 * The home page arrives in one piece.
 *
 * `/` is half prerendered markup (the bar, the phone's burger, the prose behind
 * the sheet) and half application rendered in the browser, and nothing held the
 * two together: the canvas and the static half painted on the first frame, the
 * lobby appeared whenever the game had booted. Both halves wait on this
 * attribute instead and fade in together — see the boot rules in
 * `layouts/GamePage.css`, which also carry the fallback that reveals the page if
 * this never runs.
 *
 * Two frames, not one: the render schedules the work, so the first callback
 * runs with the commit still pending and the fade would start over an empty
 * #root.
 *
 * The value is then spent. What fades is the app's rendered child rather than
 * #root itself — fading the mount point showed the body's gradient through it,
 * which no screen is ever meant to display — and every screen is a fresh child,
 * so a live reveal rule would replay on each one for the rest of the match. The
 * bare attribute is what lifts the hold and it stays; `in` is the animation and
 * it lasts one fade.
 */
const BOOT_FADE_MS = 600

export function markBooted(): void {
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

/**
 * The boot sequence, and the component to render once it has run: the game
 * (`Root.svelte`) or, in dev with `?showcase`, the gallery.
 */
export async function bootGame(): Promise<Component<Record<string, never>>> {
  boot()
  if (isShowcase()) {
    const { default: Showcase } = await import('./dev/Showcase.svelte')
    return Showcase as Component<Record<string, never>>
  }
  return Root as Component<Record<string, never>>
}

function boot() {
  // First, before anything reads the URL or renders a word: is this page even
  // in the right language? A stored choice outranks the URL, so `/` with French
  // stored is the wrong page; this moves the router to `/fr/` — the page a
  // reload would find — in place of the history entry. See `src/langRoute.ts`
  // for why it is a navigation and `src/lang.ts` for what outranks what.
  //
  // It is also what makes `/` answer a browser set to French: that page is the
  // root, where nobody has said anything yet. `/fr/` is somebody having asked,
  // so nothing overrules it there.
  //
  // It runs ahead of `initTableInvite()` because that one spends the invitation
  // in the address bar, and this moves the address bar. Neither loses anything
  // to the other in that order: the move carries the query string across, and
  // the invite page is built as no language at all, so nothing here touches it.
  initLang()

  // Every reduced-motion rule in the CSS hangs off `data-motion`, and nothing
  // writes that attribute until this runs. Without it a player whose system asks
  // for less motion got the full set of animations for the whole session unless
  // they happened to open Preferences and toggle the switch themselves — the OS
  // setting alone never reached the stylesheet. This also registers the listener
  // that keeps `auto` following the system while the tab is open.
  initMotion()

  // The language the app renders in, detected once and owned by `i18n/store.ts`
  // from here on. It reads the same three signals `initLang` just did, and
  // `chooseLang` gives the same answer whichever of the two pages it is asked
  // on, so it does not have to wait for the move above to land.
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
  // effect on the app's first render. Seeding the store here is what puts the
  // restoring screen on the first paint instead of a flash of lobby.
  initSessionRestore()
}
