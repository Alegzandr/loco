<script lang="ts">
  // The layout every page shares, and the reason navigating no longer reloads.
  //
  // It carries what every document needs before it can paint a word — the two
  // self-hosted faces, the design tokens and the reset — and nothing else. The
  // header, the footer and the drawer are the content pages' and the game's own
  // (layouts/ContentPage.svelte, layouts/GamePage.svelte): the game page has no
  // header at all, so a shared one here would be one more thing it hides.
  //
  // What survives a navigation is not in this file because it is not markup:
  // the socket, the audio engine and the store are module singletons, and the
  // mounted game itself is kept by src/entry.ts while a content page is up. See
  // docs/notes/client.md, "How the game gets on the page".
  //
  // Self-hosted variable fonts: no CDN request, so the CSP stays closed and the
  // first paint never falls back to a system face mid-animation. Imported here
  // rather than from the game's entry so the content pages are typeset too.
  import '@fontsource-variable/fredoka'
  import '@fontsource-variable/nunito'
  import '../styles/tokens.css'
  import '../styles/base.css'
  import type { Snippet } from 'svelte'

  const { children }: { children: Snippet } = $props()
</script>

{@render children()}
