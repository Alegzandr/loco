<script lang="ts">
  // The layout every page shares, and the reason navigating no longer reloads.
  //
  // It carries what every document needs before it can paint a word — the two
  // self-hosted faces, the design tokens and the reset — and the one thing every
  // move between pages has in common: the cross-fade. The site's chrome is not
  // here but in two components both page layouts render
  // (layouts/SiteFooter.svelte, layouts/SiteDrawer.svelte): the game page's bar
  // closes a one-viewport page and disappears at a seat, the content pages' is
  // pinned under a page that scrolls, and a component placed by each page is
  // what lets one object do both.
  //
  // What survives a navigation is not in this file because it is not markup:
  // the socket, the audio engine and the store are module singletons, and the
  // mounted game itself is kept by src/entry.ts while a content page is up. See
  // docs/notes/client.md, "How the game gets on the page".
  //
  // Self-hosted variable fonts: no CDN request, so the CSP stays closed and the
  // first paint never falls back to a system face mid-animation.
  import '@fontsource-variable/fredoka'
  import '@fontsource-variable/nunito'
  import '../styles/tokens.css'
  import '../styles/base.css'
  import { onNavigate } from '$app/navigation'
  import type { Snippet } from 'svelte'

  const { children }: { children: Snippet } = $props()

  /**
   * Whether this reader asked for less motion. The game's own answer
   * (`data-motion`, written by its boot from the player's preference) wins where
   * it exists, in both directions; before the game has booted — a document that
   * started on a content page — the system's is the only one there is.
   */
  function lessMotion(): boolean {
    const root = document.documentElement
    // `initMotion()` writes `data-motion="reduce"` or nothing, so once the game
    // has booted (`data-booted` exists) an absent attribute is an answer too.
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

{@render children()}
