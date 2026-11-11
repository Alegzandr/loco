<script lang="ts">
  // The layout every page shares — and, because it is the one component the
  // router never replaces, the place the game lives.
  //
  // Three jobs:
  //
  // 1. What every document needs before it can paint a word: the two
  //    self-hosted faces (no CDN request, so the CSP stays closed), the design
  //    tokens and the reset.
  // 2. The document itself: `<html>` and `<body>` are outside anything a page
  //    renders, so the attributes `hooks.server.ts` wrote at prerender are
  //    rewritten here from the same function (`seo/document.ts: routeFor`)
  //    whenever the router changes page; and every change of page is one short
  //    cross-fade with the site's bar held still.
  // 3. The game. It is rendered into `#root` here, not by a page, so a move to
  //    a content page does not destroy it: the socket, the music, the store
  //    and a running match carry on while the reader is on the rules, hidden
  //    and inert (`.parked`), and are there on the way back. The first time the
  //    router is on a game page the boot sequence runs (`src/boot.ts`), in
  //    order, once per document — never on a content page, where electing the
  //    tab (`initTabLock`) would draw the curtain over the tab actually playing.
  //    It is never server-rendered: the prerendered `#root` is empty, because
  //    the store is seeded from `sessionStorage`, the language from
  //    `localStorage` and the board measured from the viewport, and a server
  //    knows none of those.
  import '@fontsource-variable/fredoka'
  import '@fontsource-variable/nunito'
  import '../styles/tokens.css'
  import '../styles/base.css'
  import { tick, untrack, type Component, type Snippet } from 'svelte'
  import { page } from '$app/state'
  import { onNavigate } from '$app/navigation'
  import { applyDocument, routeFor } from '../seo/document'
  import { bootGame, markBooted, mountLookPanelIfAsked } from '../boot'
  import { initLang } from '../langRoute'
  import { redetectLang } from '../i18n/store'
  import { gameShown } from '../hooks/gameShown.svelte'

  const { children }: { children: Snippet } = $props()

  const route = $derived(routeFor(page.url.pathname))
  const onGame = $derived(route.kind === 'game')

  /** The game, once it has booted; `null` until then, and on the server. */
  let Game = $state<Component<Record<string, never>> | null>(null)
  /** Whether this document has been on a game page — and so holds a game. */
  let hosting = $state(false)
  let booting = false

  // The document's own attributes, before the page under them renders: a game
  // page's language decision reads `data-served-lang`.
  $effect.pre(() => {
    applyDocument(route)
  })

  // Runs on every change of page and on nothing else: the game landing must not
  // re-run the language decision the boot has just made.
  $effect(() => {
    const game = route.kind === 'game'
    gameShown.current = game
    if (!game) return
    untrack(() => {
      hosting = true
      if (Game) {
        // Back from a content page, or across from the other home: the page
        // arrived at may be the other language's, and a choice may have been
        // recorded on the way (the globe writes it). Decide again — moving the
        // router if the answer is the other page — and have the game follow.
        initLang()
        redetectLang()
        return
      }
      if (booting) return
      booting = true
      void bootGame().then(async (component) => {
        Game = component
        await tick()
        markBooted()
        mountLookPanelIfAsked()
      })
    })
  })

  /**
   * Whether this reader asked for less motion. `initMotion()` writes
   * `data-motion="reduce"` or nothing, so once the game has booted (`data-booted`
   * exists) an absent attribute is an answer too; before that — a document that
   * started on a content page — the system's is the only one there is.
   */
  function lessMotion(): boolean {
    const root = document.documentElement
    if (root.dataset.booted !== undefined) return root.dataset.motion === 'reduce'
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  // One page into the next as a cross-fade, with the bar held still between
  // them (`view-transition-name: site-footer`, content.css): moving from the
  // rules to the game is moving inside one app, and the one object both pages
  // share does not blink on the way. Progressive — a browser without the API
  // swaps the page as it always did — and skipped for a reader who asked for
  // less motion, and for a move within one page (a fragment), which is a scroll.
  onNavigate((navigation) => {
    if (!document.startViewTransition || lessMotion()) return
    if (navigation.from?.url.pathname === navigation.to?.url.pathname) return
    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve()
        await navigation.complete
      })
    })
  })
</script>

<!--
  #root is the game's: `tokens.css` styles `html, body, #root` as one selector,
  and `GamePage.css` gives it the space the bar leaves. It exists on a game page
  and stays, parked, once a document has had one. Empty in the prerendered HTML.
-->
{#if onGame || hosting}
  <div id="root" class:parked={!onGame} inert={!onGame} aria-hidden={onGame ? undefined : 'true'}>
    {#if Game}<Game />{/if}
  </div>
{/if}

{@render children()}
