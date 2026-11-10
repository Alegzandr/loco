<script lang="ts">
  // The phone's whole navigation, on every page that is not a seat: one burger,
  // one drawer.
  //
  // Under 46rem the bar (SiteFooter.svelte) folds into two lines of 12px text
  // with nothing on it big enough to aim a thumb at, so at that width the bar's
  // row goes and everything it carried moves in here. It used to be written
  // twice, once per layout, and the two drifted the way the two footers did;
  // this is the one copy, and content.css styles it once.
  //
  // Native `popover`: Escape and a tap outside close it with nothing loaded,
  // which is the state a crawler and a slow connection both arrive in. Where the
  // API is missing the burger and the drawer both disappear and the bar stays
  // (content.css, the @supports block at its foot).
  //
  // Each drawer carries exactly one action, and the accent that comes with it
  // (`navPopCta`): "Play" on a content page, where it is where you are going,
  // and "Preferences" on the game page, where it is what you came into the menu
  // to change. Both carry the globe on their last row: the language is reached
  // the same way on every page.
  import LocoLogo from '../components/LocoLogo.svelte'
  import { HOME, NAV, LEGAL, type Lang, type PageDef } from '../seo/meta'
  import { ui } from '../content/ui'

  interface Props {
    page: PageDef
    lang: Lang
    /** The game page's drawer: bilingual, and opening the app's panels. */
    home?: boolean
  }

  const { page, lang, home = false }: Props = $props()
  const alt = $derived<Lang>(lang === 'en' ? 'fr' : 'en')
  const other = (value: string): string | undefined => (home ? value : undefined)
</script>

<button
  type="button"
  class="menuBtn"
  class:homeBurger={home}
  popovertarget="navPop"
  aria-label={ui('menuLabel', lang)}
  data-alt-aria={other(ui('menuLabel', alt))}
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
    <!--
      The wordmark, not the word "Menu", which named the thing the reader had
      just opened. On the game page it is the only brand on screen: this panel
      covers the board, and `/` has no header behind it.
    -->
    <div class="navPopTitle"><LocoLogo size="1.25rem" /></div>
    <button
      type="button"
      class="navPopClose"
      popovertarget="navPop"
      popovertargetaction="hide"
      aria-label={ui('menuClose', lang)}
      data-alt-aria={other(ui('menuClose', alt))}
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

  <nav class="navPopLinks" aria-label={ui('navLabel', lang)} data-alt-aria={other(ui('navLabel', alt))}>
    {#if home}
      <!--
        First row on the game page, and the only one that is not a destination:
        it shuts the drawer and opens the sheet of prose, which under 46rem is
        otherwise out of reach. `hidden` in the markup and revealed by
        `homeSheet.ts`: with no script it would be a control that does nothing.
      -->
      <button type="button" id="navAbout" class="navPopAbout" hidden data-alt={other(ui('homeSheetBtn', alt))}
        >{ui('homeSheetBtn', lang)}</button
      >
    {:else}
      <!-- Never on the game page, so its `other()`s are always empty; they are
           written so that every string in this file carries its pair. -->
      <a
        class="navPopCta navPopPlay"
        href={HOME.path[lang]}
        data-alt-href={other(HOME.path[alt])}
        data-alt={other(ui('play', alt))}>{ui('play', lang)}</a
      >
    {/if}
    {#each NAV as p (p.id)}
      <a
        href={p.path[lang]}
        data-alt-href={other(p.path[alt])}
        data-alt={other(p.navLabel?.[alt] ?? p.title[alt])}
        aria-current={p.id === page.id ? 'page' : undefined}>{p.navLabel?.[lang] ?? p.title[lang]}</a
      >
    {/each}
    <a
      href={LEGAL.path[lang]}
      data-alt-href={other(LEGAL.path[alt])}
      data-alt={other(ui('legalNav', alt))}
      aria-current={LEGAL.id === page.id ? 'page' : undefined}>{ui('legalNav', lang)}</a
    >
  </nav>

  <!--
    The settings row. The globe opens the same `#langPop` the bar's does — a
    popover invoked from inside another one nests rather than replacing it.
    On the game page the app's Preferences come first: `hidden` in the markup,
    revealed by `homeSheet.ts`, because the panel it opens is the app's.
  -->
  <div class="navPopEnd">
    {#if home}
      <button type="button" id="navPrefs" class="navPopCta" hidden data-alt={other(ui('prefs', alt))}
        >{ui('prefs', lang)}</button
      >
    {/if}
    <button
      type="button"
      class="langBtn"
      popovertarget="langPop"
      aria-label={ui('langLabel', lang)}
      data-alt-aria={other(ui('langLabel', alt))}
    >
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
        <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="9"></circle>
          <ellipse cx="12" cy="12" rx="4.1" ry="9"></ellipse>
          <path d="M3.2 9h17.6M3.2 15h17.6"></path>
        </g>
      </svg>
      <span data-alt={other(ui('langName', alt))}>{ui('langName', lang)}</span>
    </button>
  </div>
</div>
