<script lang="ts">
  // The game itself, at whatever URL a language puts it, plus the footer that
  // makes this page worth indexing.
  //
  // Both `/` and `/fr/` serve the same application; only the <head> and the copy
  // differ. This exists so the two cannot drift: a mount point that disagreed
  // with the stylesheet, or a boot run on one page and not the other, would be a
  // blank page in one language only.
  //
  // Everything in the markup below is prerendered, and readable with no script
  // at all. The app is not: `#root` is empty in the served HTML, and src/entry.ts
  // mounts the game into it once this component is on the page.
  import { onMount, untrack } from 'svelte'
  import Head from './Head.svelte'
  import HomeProse from '../content/HomeProse.svelte'
  import SiteFooter from './SiteFooter.svelte'
  import SiteDrawer from './SiteDrawer.svelte'
  import { HOME, homeJsonLd, type Lang, type PageDef } from '../seo/meta'
  import { applyDocument, documentFor } from '../seo/document'
  import { ui } from '../content/ui'
  import { attachGame } from '../entry'
  import { wireHomeSheet } from '../homeSheet'
  import '../content/content.css'
  import './GamePage.css'

  interface Props {
    lang: Lang
    /**
     * Which document this is. Defaults to the home page; the invite page passes
     * its own so it can unfurl differently in a chat window.
     *
     * It is a prop rather than a second layout for the reason the two languages
     * share this one: the mount point, the boot and the stylesheet that sizes
     * them are the fragile part, and a copy of them drifts silently — the
     * failure is a blank page on one URL only.
     */
    page?: PageDef
    /**
     * Defaults to the home page's graph. `null` for a page that should describe
     * no entity at all: the invite page is the home page's document twice over,
     * and a second `#webpage` node at a second URL is two answers to one question.
     */
    jsonLd?: object | null
    noindex?: boolean
    /**
     * The indexable half: the footer row, the sheet, the burger. Off for a page
     * that is `noindex` anyway, where it would be a row of links and a page of
     * prose under a table somebody was invited to rather than sent to read.
     */
    chrome?: boolean
  }

  const { lang, page = HOME, jsonLd: givenLd, noindex = false, chrome = true }: Props = $props()

  /**
   * The other language, and the reason every string below is written twice.
   *
   * This page is the one document on the site that can change language without
   * being reloaded: a visitor whose browser is in French lands on `/`, and
   * `src/langSwap.ts` translates what was served here rather than fetching
   * `/fr/`. It walks `data-alt`, `data-alt-href` and `data-alt-aria`, so anything
   * rendered per language must carry its counterpart or it stays behind in
   * English — and a **link** that stays behind sends that visitor to an English
   * content page. `homeLangSwap.test.ts` fails on a `ui(` or a `path[lang]` in
   * this file that has no alternative beside it.
   *
   * Two languages is an assumption the mechanism makes throughout, `HOME_PATH` in
   * `src/lang.ts` included; a third would need more than a second value here.
   */
  const alt = $derived<Lang>(lang === 'en' ? 'fr' : 'en')
  // `undefined` is "not passed", `null` is "none": a default in the destructuring
  // could not tell the two apart.
  const jsonLd = $derived(givenLd === undefined ? homeJsonLd(lang) : givenLd)

  // `<html>` and `<body>` for this page, written before anything below reads
  // them: `initLang` decides off `data-served-lang`. On a first load the
  // prerendered document already says the same; after a client-side navigation
  // it is what turns the previous page's document into this one.
  if (typeof document !== 'undefined') {
    untrack(() => applyDocument(documentFor(page.path[lang])))
  }

  let root: HTMLDivElement

  onMount(() => {
    const unwireSheet = chrome ? wireHomeSheet() : () => {}
    const detach = attachGame(root)
    return () => {
      detach()
      unwireSheet()
    }
  })
</script>

<Head {page} {lang} jsonLd={jsonLd ?? undefined} {noindex} />

<!--
  The document's one heading, in the markup the build serves and off the screen.

  This page is a game. What sits where a title would is the wordmark, which is
  a drawing carrying `role="img"`, and the only real heading used to be the
  one the lobby mounts — so the served HTML had no <h1> at all, and every
  audit read `/` as a page with no heading. A crawler does not wait for a
  bundle, and neither does a screen reader arriving before it lands.

  It is not the word "LOCO". A heading that repeats the logo tells nobody what
  the page is, and this is the one string on `/` that gets to say it in the
  words somebody would have typed. The app's screens head themselves at <h2>
  (`Lobby`, `Searching`, `MapLoadingScreen`) so this stays the only <h1> in
  the document at every moment of a match, not only before the mount.
-->
{#if chrome}<h1 class="sr-only" data-alt={ui('homeH1', alt)}>{ui('homeH1', lang)}</h1>{/if}

<!--
  #root is the mount point: tokens.css styles `html, body, #root` as one
  selector, and src/entry.ts mounts the app into this element — in the
  browser, after this page is on screen, and never on the server.
-->
<div id="root" bind:this={root}></div>

<!--
  The indexable half of this page, in the served HTML rather than in the app: a
  crawler reads it without running a script, and it is the only path from the
  game to the content pages — the sitemap lists them, but a link is what carries
  weight.

  It is the site's one bar (SiteFooter.svelte), the same one every content page
  carries, at the same height in the same place, with the language behind the
  same globe. What stands at its left-hand end here is the sheet of prose rather
  than "Play": this is where playing happens. The whole bar goes the moment a
  seat is taken (see App.svelte: data-seated); a player in a match has no use for
  it, and the board is the board.
-->
{#if chrome}
  <SiteFooter {page} {lang} home>
    {#snippet lead()}
      <!--
        The wide screen's way into the prose: a quiet line in the bar that opens
        it over the board. <details>, so it opens with no script at all — the
        prose behind it is the only thing on `/` a crawler can read, and it has
        to work for whoever arrives with the bundle still in flight. A phone
        reaches it from the drawer's first row instead.

        Open, it is the rules modal: same card, same headed title, same footer
        button, because a player who opens both in one session meets one game
        and not two designs. The <summary> is that footer button — a native
        disclosure has exactly one control and this is it. The ✕ beside the
        title is the scripted second way out, so it ships `hidden` and
        `homeSheet.ts` reveals it.
      -->
      <details class="homeSheet">
        <summary class="homeSheetBtn">
          <span class="homeSheetLabel" data-alt={ui('homeSheetBtn', alt)}>{ui('homeSheetBtn', lang)}</span>
          <span class="homeSheetShut" data-alt={ui('homeSheetClose', alt)}>{ui('homeSheetClose', lang)}</span>
        </summary>

        <div class="homeSheetHead">
          <h2 class="homeSheetTitle" data-alt={ui('homeSheetBtn', alt)}>{ui('homeSheetBtn', lang)}</h2>
          <button
            type="button"
            class="homeSheetX"
            hidden
            aria-label={ui('homeSheetClose', lang)}
            data-alt-aria={ui('homeSheetClose', alt)}
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
        above is the <details> element itself, so anything covering the screen
        from inside it would be painted over that card's own background.
      -->
      <div class="homeSheetScrim"></div>
    {/snippet}
  </SiteFooter>

  <!--
    The phone's whole navigation: the same burger and the same drawer as every
    content page. Here it floats in the top-left corner, over the board, because
    `/` has no header to put it in, and its one action is Preferences rather than
    "Play".
  -->
  <SiteDrawer {page} {lang} home />
{/if}