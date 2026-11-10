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
  import LocoLogo from '../components/LocoLogo.svelte'
  import { HOME, NAV, LEGAL, homeJsonLd, type Lang, type PageDef } from '../seo/meta'
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
  game to the content pages — the sitemap lists them, but a link is what
  carries weight.

  It is a footer row, not a block under the fold: the entry screen fits in one
  viewport and nothing about the game is reached by scrolling. The links sit in
  the open, and the prose is one press away in a sheet, which <details> opens
  with no script at all.

  The whole footer goes the moment a seat is taken (see App.svelte:
  data-seated); a player in a match has no use for it.
-->
{#if chrome}
  <footer class="homeIntro">
    <div class="homeIntroMain">
      <!--
        The wide screen's way in: a quiet line at the foot of the page that
        opens the prose over the board. <details>, so it opens with no script at
        all — the prose behind it is the only thing on `/` a crawler can read,
        and it has to work for whoever arrives with the bundle still in flight.
        A phone never sees this: the burger below replaces it.

        Open, it is the rules modal: same card, same headed title, same footer
        button, because a player who opens both in one session meets one game and
        not two designs. The <summary> is that footer button — a native
        disclosure has exactly one control and this is it, which is what keeps
        the whole thing working with the bundle still in flight. The ✕ beside the
        title is the scripted second way out, so it ships `hidden` and
        `homeSheet.ts` reveals it: same contract as the drawer's Preferences row.
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

      <!--
        Privacy and terms closes the row rather than standing off at the
        right-hand end. Held apart it read as a second navigation of one item,
        and the gap between it and the five was wide enough on a desktop that
        the row had two centres. It is last, which is where a legal link
        belongs, and it is in the same list as the rest — the drawer already
        carries it that way, so the two renderings of this navigation now match
        item for item.
      -->
      <nav aria-label={ui('homeMoreH2', lang)} data-alt-aria={ui('homeMoreH2', alt)}>
        <ul class="homeLinks">
          {#each NAV as p (p.id)}
            <li>
              <a
                href={p.path[lang]}
                data-alt-href={p.path[alt]}
                data-alt={p.navLabel?.[alt] ?? p.title[alt]}
              >{p.navLabel?.[lang] ?? p.title[lang]}</a>
            </li>
          {/each}
          <li>
            <a
              href={LEGAL.path[lang]}
              data-alt-href={LEGAL.path[alt]}
              data-alt={ui('legalNav', alt)}
            >{ui('legalNav', lang)}</a>
          </li>
        </ul>
      </nav>
    </div>

    <!--
      The phone's whole navigation: the same burger, in the same corner, opening
      the same drawer as every content page, and styled by the same rules in
      `content/content.css`. The items differ because the page does — there is no
      "Play" in it, this is where playing happens, and the language is already
      behind the gear the lobby carries.

      Native `popover`: Escape and a tap outside close it with nothing loaded,
      which is the state a crawler and a slow connection both arrive in.
    -->
    <button
      type="button"
      class="menuBtn homeBurger"
      popovertarget="navPop"
      aria-label={ui('menuLabel', lang)}
      data-alt-aria={ui('menuLabel', alt)}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <path
          d="M4 7h16M4 12h16M4 17h16"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
        ></path>
      </svg>
    </button>

    <div id="navPop" popover="auto" class="navPop">
      <div class="navPopHead">
        <!-- The same wordmark the content pages' drawer opens with, and here it
             is the only brand on screen: this panel covers the board, and `/`
             has no header bar behind it. -->
        <div class="navPopTitle"><LocoLogo size="1.25rem" /></div>
        <button
          type="button"
          class="navPopClose"
          popovertarget="navPop"
          popovertargetaction="hide"
          aria-label={ui('menuClose', lang)}
          data-alt-aria={ui('menuClose', alt)}
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

      <!--
        The same links as the row above, built from the same registry — and the
        whole drawer, nothing under them. The prose is still in this document for
        a crawler, and still one press away in the sheet.

        First row, and the only one that is not a destination: it shuts the
        drawer and opens the sheet. Under 46rem the footer row is gone and this
        drawer deliberately carries no prose, so a first-time visitor on a phone
        met a logo, a tagline, two buttons and a burger — and nothing at all
        about the game. `hidden` in the markup and revealed by `homeSheet.ts`,
        the same contract as the Preferences row below: with no script it would
        be a control that does nothing.
      -->
      <nav class="navPopLinks" aria-label={ui('navLabel', lang)} data-alt-aria={ui('navLabel', alt)}>
        <button
          type="button"
          id="navAbout"
          class="navPopAbout"
          hidden
          data-alt={ui('homeSheetBtn', alt)}
        >{ui('homeSheetBtn', lang)}</button>
        {#each NAV as p (p.id)}
          <a
            href={p.path[lang]}
            data-alt-href={p.path[alt]}
            data-alt={p.navLabel?.[alt] ?? p.title[alt]}
          >{p.navLabel?.[lang] ?? p.title[lang]}</a>
        {/each}
        <a
          href={LEGAL.path[lang]}
          data-alt-href={LEGAL.path[alt]}
          data-alt={ui('legalNav', alt)}
        >{ui('legalNav', lang)}</a>
      </nav>

      <!--
        Where the content pages put the language, this puts the one thing a
        player opens a menu for during a game. It is the same `navPopEnd` row
        under the same rule, and the same `navPopCta` the other drawer wears on
        `Play`: the two menus carry their accent at opposite ends because their
        action means opposite things, and neither is the grey one.

        `hidden` in the markup, revealed by `homeSheet.ts`. The panel it opens is
        the app's, so with no script this row would be a button that does
        nothing. Everything else in this drawer is a link and works either way.

        On this page only. The drawer goes with the footer the moment a seat is
        taken (`data-seated`), so on the table and in the waiting room the gear in
        the top-right row is still the way in, at every width.
      -->
      <div class="navPopEnd">
        <button
          type="button"
          id="navPrefs"
          class="navPopCta"
          hidden
          data-alt={ui('prefs', alt)}
        >{ui('prefs', lang)}</button>
      </div>
    </div>
  </footer>
{/if}
