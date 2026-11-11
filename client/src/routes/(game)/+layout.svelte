<script lang="ts">
  // The frame around the game, on `/`, `/fr/` and `/i/`.
  //
  // The game itself is not here: the root layout renders it into `#root` above
  // this, so it survives a trip to a content page. What is here is everything
  // the page says around it, prerendered and readable with no script — the
  // head, the document's one heading, the site's bar with the sheet of prose,
  // and the drawer — all from `routeFor(page.url.pathname)`, so the three URLs
  // are one layout and cannot drift into a blank page on one of them.
  //
  // `/i/` is the invitation: the home page's document with its own head
  // (`INVITE`: its own title, its own art, `noindex`) and no chrome, because
  // somebody arriving there was handed a seat, not sent a row of links and a
  // page of prose.
  import { onMount, type Snippet } from 'svelte'
  import { page } from '$app/state'
  import Head from '../../layouts/Head.svelte'
  import SiteFooter from '../../layouts/SiteFooter.svelte'
  import SiteDrawer from '../../layouts/SiteDrawer.svelte'
  import HomeProse from '../../content/HomeProse.svelte'
  import { HOME, INVITE, homeJsonLd } from '../../seo/meta'
  import { routeFor } from '../../seo/document'
  import { ui } from '../../content/ui'
  import '../../content/content.css'
  import '../../layouts/GamePage.css'

  const { children }: { children: Snippet } = $props()

  const route = $derived(routeFor(page.url.pathname))
  const def = $derived(route.page ?? HOME)
  const lang = $derived(route.lang)
  const invite = $derived(def.id === INVITE.id)

  /**
   * Whether a script is running. Controls only a script can honour — the
   * sheet's ✕, the drawer's About and Preferences rows — ship `hidden` and are
   * revealed by this: with no script they would be controls that do nothing.
   */
  let hydrated = $state(false)
  onMount(() => {
    hydrated = true
  })

  // ── The sheet of prose ────────────────────────────────────────────────────
  //
  // A native <details>, so it opens with no script at all: the prose behind it
  // is the only thing on `/` a crawler reads, and it has to work for whoever
  // arrives with the bundle still in flight. What a script adds is the two
  // gestures a sheet is expected to answer — Escape and a click on the scrim —
  // the ✕, the drawer's way in, and handing focus back to the control the
  // sheet was opened from.
  let sheetOpen = $state(false)
  let summary = $state<HTMLElement>()
  /**
   * What the focus goes back to when the sheet shuts: the summary on a wide
   * screen, the drawer's row on a phone — where the summary is `display: none`
   * and focusing it would drop the caret on the body.
   */
  let opener: HTMLElement | undefined

  function closeSheet() {
    if (!sheetOpen) return
    sheetOpen = false
    ;(opener ?? summary)?.focus()
  }

  function openSheetFrom(row: HTMLElement) {
    opener = row
    sheetOpen = true
  }

  // Only while open, so this never eats an Escape the game wanted. The bar is
  // display:none from the first seat onwards and the sheet cannot be open by
  // then anyway.
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && sheetOpen) closeSheet()
  }
</script>

<svelte:document onkeydown={onKey} />

<Head
  page={def}
  {lang}
  jsonLd={invite ? undefined : homeJsonLd(lang)}
  noindex={invite}
/>

{#if !invite}
  <!--
    The document's one heading, in the served markup and off the screen.

    This page is a game. What sits where a title would is the wordmark, which is
    a drawing carrying `role="img"`, and the only real heading used to be the one
    the lobby mounts — so the served HTML had no <h1> at all, and every audit
    read `/` as a page with no heading. It is not the word "LOCO": a heading that
    repeats the logo tells nobody what the page is. The app's screens head
    themselves at <h2>, so this stays the only <h1> at every moment of a match.
  -->
  <h1 class="sr-only">{ui('homeH1', lang)}</h1>

  <!--
    The indexable half of this page: the site's bar (the same one every content
    page carries) with the sheet of prose at its left-hand end, and the drawer.
    It is the only path from the game to the content pages — the sitemap lists
    them, but a link is what carries weight. Gone the moment a seat is taken
    (App.svelte: data-seated): at a seat the board is the board.
  -->
  <SiteFooter page={def} {lang} home>
    {#snippet lead()}
      <!--
        Open, it is the rules modal: same card, same headed title, same footer
        button. The <summary> is that footer button — a native disclosure has
        exactly one control, and it is the one thing on this card a reader with
        no script can press.
      -->
      <details class="homeSheet" bind:open={sheetOpen}>
        <summary class="homeSheetBtn" bind:this={summary} onclick={() => (opener = summary)}>
          <span class="homeSheetLabel">{ui('homeSheetBtn', lang)}</span>
          <span class="homeSheetShut">{ui('homeSheetClose', lang)}</span>
        </summary>

        <div class="homeSheetHead">
          <h2 class="homeSheetTitle">{ui('homeSheetBtn', lang)}</h2>
          <button
            type="button"
            class="homeSheetX"
            hidden={!hydrated}
            aria-label={ui('homeSheetClose', lang)}
            onclick={closeSheet}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
              ></path>
            </svg>
          </button>
        </div>

        <div class="homeSheetCard">
          <HomeProse {lang} />
        </div>
      </details>

      <!--
        The scrim, and a sibling of the sheet rather than a child of it: the card
        is the <details> element itself, so anything covering the screen from
        inside it would be painted over that card's own background.
      -->
      <!-- Escape and the ✕ are the keyboard's ways out; this is the pointer's. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="homeSheetScrim" onclick={closeSheet}></div>
    {/snippet}
  </SiteFooter>

  <SiteDrawer page={def} {lang} home {hydrated} onAbout={openSheetFrom} />
{/if}

{@render children()}
