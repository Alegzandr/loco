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
  // to change. Both end on the globe: the language is reached the same way on
  // every page.
  import { afterNavigate } from '$app/navigation'
  import LocoLogo from '../components/LocoLogo.svelte'
  import { HOME, NAV, LEGAL, type Lang, type PageDef } from '../seo/meta'
  import { ui } from '../content/ui'

  interface Props {
    page: PageDef
    lang: Lang
    /** The game page's drawer: About and Preferences rather than Play. */
    home?: boolean
    /**
     * Whether a script is running: the two rows only a script can honour ship
     * `hidden` and are revealed by it, because with no script they would be
     * controls that do nothing.
     */
    hydrated?: boolean
    /** The game page's About row: opens the sheet of prose, from this row. */
    onAbout?: (row: HTMLElement) => void
  }

  const { page, lang, home = false, hydrated = false, onAbout }: Props = $props()

  let drawer = $state<HTMLElement>()

  /** `hidePopover()` throws on a drawer that is not open, and on an engine without the API. */
  function shut() {
    try {
      if (drawer?.matches(':popover-open')) drawer.hidePopover()
    } catch {
      /* no popover support: there was no drawer to close */
    }
  }

  // A destination in the same layout keeps this component, and with it a
  // drawer still standing open over the page the reader chose. Only a move the
  // reader made: the boot's own move to the page in their language (a `goto`)
  // is the same page, and shutting the drawer under a thumb that has just
  // opened it would be the page taking the menu away.
  afterNavigate((nav) => {
    if (nav.type === 'link' || nav.type === 'popstate') shut()
  })

  // The one thing the drawer cannot do natively: shut when it stops being the
  // navigation. A window dragged wider, or a phone turned on its side, left a
  // drawer standing over a page whose own bar was already back underneath it,
  // with the burger that closes it gone. `PHONE` is the breakpoint content.css
  // gates the burger on — two copies of one number, and `contentPages.test.ts`
  // fails if they drift. Checked once on arrival as well: the drawer is native,
  // so it can be opened before the page hydrates, and a window widened in that
  // interval fired its `change` with nobody listening.
  const PHONE = '(max-width: 46rem)'
  $effect(() => {
    const phone = window.matchMedia(PHONE)
    const onChange = () => {
      if (!phone.matches) shut()
    }
    onChange()
    phone.addEventListener('change', onChange)
    return () => phone.removeEventListener('change', onChange)
  })

  function about(e: MouseEvent) {
    shut()
    onAbout?.(e.currentTarget as HTMLElement)
  }

  // The panel it opens is the game's, in the root layout rather than in this
  // tree, so it is asked for by event: `<Preferences />` listens, and only one
  // screen is ever rendered, so only one panel ever opens. Shut first: hiding
  // the popover hands the focus back to the burger, so the panel opens over a
  // closed drawer and the way out lands somewhere real.
  function preferences() {
    shut()
    window.dispatchEvent(new CustomEvent('loco:preferences'))
  }
</script>

<button
  type="button"
  class="menuBtn"
  class:homeBurger={home}
  popovertarget="navPop"
  aria-label={ui('menuLabel', lang)}
>
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"
    ></path>
  </svg>
</button>

<div id="navPop" popover="auto" class="navPop" bind:this={drawer}>
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
    >
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
        <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"
        ></path>
      </svg>
    </button>
  </div>

  <nav class="navPopLinks" aria-label={ui('navLabel', lang)}>
    {#if home}
      <!--
        First row on the game page, and the only one that is not a destination:
        it shuts the drawer and opens the sheet of prose, which under 46rem is
        otherwise out of reach.
      -->
      <button type="button" id="navAbout" class="navPopAbout" hidden={!hydrated} onclick={about}
        >{ui('homeSheetBtn', lang)}</button
      >
    {:else}
      <a class="navPopCta navPopPlay" href={HOME.path[lang]}>{ui('play', lang)}</a>
    {/if}
    {#each NAV as p (p.id)}
      <a href={p.path[lang]} aria-current={p.id === page.id ? 'page' : undefined}
        >{p.navLabel?.[lang] ?? p.title[lang]}</a
      >
    {/each}
    <a href={LEGAL.path[lang]} aria-current={LEGAL.id === page.id ? 'page' : undefined}>{ui('legalNav', lang)}</a>
  </nav>

  <!--
    The settings row. The globe opens the same `#langPop` the bar's does — a
    popover invoked from inside another one nests rather than replacing it.
    On the game page the game's Preferences come first.
  -->
  <div class="navPopEnd">
    {#if home}
      <button type="button" id="navPrefs" class="navPopCta" hidden={!hydrated} onclick={preferences}
        >{ui('prefs', lang)}</button
      >
    {/if}
    <button type="button" class="langBtn" popovertarget="langPop" aria-label={ui('langLabel', lang)}>
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
        <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="9"></circle>
          <ellipse cx="12" cy="12" rx="4.1" ry="9"></ellipse>
          <path d="M3.2 9h17.6M3.2 15h17.6"></path>
        </g>
      </svg>
      <span>{ui('langName', lang)}</span>
    </button>
  </div>
</div>
