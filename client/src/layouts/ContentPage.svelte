<script lang="ts">
  // The shell every content page shares: a header, one column, and the site's
  // bar at the foot — the same bar, the same drawer and the same language
  // chooser the game page carries (SiteFooter.svelte, SiteDrawer.svelte), so
  // moving between this page and the game is moving inside one app.
  //
  // Prerendered whole, and readable with no script at all: everything below is
  // markup in the served HTML. <LocoLogo /> is the game's own component, so the
  // mark on the page is the mark in the game rather than a redrawn copy — and
  // because the page is rendered on the server first, nothing in it may put its
  // markup inside an effect, which never runs there. The language chooser and the
  // drawer are native popovers for the same reason: they dismiss on Escape and on
  // a click outside with no script behind them.
  //
  // What only this page has is the header: the mark back to the game and the
  // "Play" beside it, pinned, because these documents are long. The game page
  // has none — its entry screen is its own composition, with the wordmark at its
  // centre — and that is the one deliberate difference between the two shells.
  import { onMount, untrack, type Snippet } from 'svelte'
  import Head from './Head.svelte'
  import SiteFooter from './SiteFooter.svelte'
  import SiteDrawer from './SiteDrawer.svelte'
  import LocoLogo from '../components/LocoLogo.svelte'
  import { HOME, type Lang, type PageDef } from '../seo/meta'
  import { applyDocument, documentFor } from '../seo/document'
  import { ui } from '../content/ui'
  import { bootContentPage } from '../content/page-boot'
  import '../content/content.css'

  interface Props {
    page: PageDef
    lang: Lang
    jsonLd?: object
    children: Snippet
  }

  const { page, lang, jsonLd, children }: Props = $props()

  // `<html>` and `<body>` for this page. On a first load the prerendered document
  // already says the same; after a client-side navigation it is what turns the
  // previous page's document — the game's one-viewport body included — into
  // this one.
  if (typeof document !== 'undefined') {
    untrack(() => applyDocument(documentFor(page.path[lang])))
  }

  // The drawer, the language choice, the smooth travel, the way back up, and on
  // `/live/` the list. See content/page-boot.ts.
  onMount(() => bootContentPage())
</script>

<Head {page} {lang} {jsonLd} />

<div class="page">
  <a class="skip" href="#content">{ui('skipToContent', lang)}</a>

  <!--
    The header stays in sight for the whole page. These documents are long and
    everything that leaves them lives up here — the mark back to `/`, the CTA,
    and on a phone the burger that *is* the navigation, since the bar at the
    foot is hidden at that width. The band is full-width and the row inside it
    keeps `--shell`, so the logo still starts at the same x as the <h1> under it.
  -->
  <div class="headerBar" id="top">
    <header class="siteHeader">
      <SiteDrawer {page} {lang} />

      <a class="brand" href={HOME.path[lang]} aria-label={ui('homeLabel', lang)}>
        <LocoLogo size="1.5rem" />
      </a>
      <a class="cta" href={HOME.path[lang]}>{ui('play', lang)}</a>
    </header>
  </div>

  <main class="content" id="content">
    {@render children()}
  </main>

  <!--
    Appears once the reader is a screenful down, above the bar and out of the
    column: these pages are long, the navigation is pinned to the *bottom*, and
    the way back to the top was a scroll the whole way or a key a phone does
    not have. `hidden` in the markup and revealed by `page-boot.ts` — with no
    script it could neither know it was wanted nor animate the return, and a
    reader with no script still has the browser's own way home. A real `href`,
    so it works if the click handler ever does not.
  -->
  <a class="toTop" href="#top" hidden aria-label={ui('toTop', lang)}>
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M12 19V6M6 12l6-6 6 6"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></path>
    </svg>
  </a>

  <SiteFooter {page} {lang}>
    {#snippet lead()}
      <!--
        First, on the left of the links, exactly where the home page's sheet
        button sits: the bar is the one thing these pages share with `/`, and a
        control that moves between two pages is a different control.
      -->
      <a class="footerPlay" href={HOME.path[lang]}>{ui('play', lang)}</a>
    {/snippet}
  </SiteFooter>
</div>
