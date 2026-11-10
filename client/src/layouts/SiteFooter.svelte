<script lang="ts">
  // The site's one bar, on every page that is not a seat.
  //
  // It used to be two: a fixed bar on the content pages (`.siteFooter`, in
  // content.css) and a quiet footer row under the game (`.homeIntro`, in the
  // game page's stylesheet), deliberately written twice because each had a job
  // the other did not. They had drifted into two objects that looked alike —
  // different padding, a hairline on one and not the other, the legal link in
  // the list on one and at the end on the other, a language globe on one only —
  // so moving from `/rules/` to the game was moving between two sites. This is
  // one component and one ruleset, and the router holds it still across that
  // move (`view-transition-name: site-footer`, see styles/base.css).
  //
  // What still differs is what each page needs at the left-hand end, and it is
  // passed in: the home page's sheet of prose (a <details>, so it opens with no
  // script), or "Play" on a content page. On `/` the bar sits in the flow of a
  // one-viewport page; on a content page it is pinned to the foot of a page that
  // scrolls. In both places it is the same height at the same place.
  //
  // On `/` every string and link also carries its other language (`data-alt*`),
  // because that page translates itself in place (`langSwap.ts`).
  // `homeLangSwap.test.ts` reads this file for that.
  import type { Snippet } from 'svelte'
  import { NAV, LEGAL, LANGS, LOCALE, type Lang, type PageDef } from '../seo/meta'
  import { ui } from '../content/ui'

  interface Props {
    page: PageDef
    lang: Lang
    /** The home page's bar: in the flow, bilingual, and gone at a seat. */
    home?: boolean
    /** What stands at the left-hand end. */
    lead: Snippet
  }

  const { page, lang, home = false, lead }: Props = $props()
  const alt = $derived<Lang>(lang === 'en' ? 'fr' : 'en')
  /** The counterpart of a string, on the one page that swaps them. */
  const other = (value: string): string | undefined => (home ? value : undefined)
</script>

<footer class="siteFooter" class:onHome={home}>
  <div class="footerRow">
    {@render lead()}

    <nav class="footerNav" aria-label={ui('navLabel', lang)} data-alt-aria={other(ui('navLabel', alt))}>
      {#each NAV as p (p.id)}
        <a
          href={p.path[lang]}
          data-alt-href={other(p.path[alt])}
          data-alt={other(p.navLabel?.[alt] ?? p.title[alt])}
          aria-current={p.id === page.id ? 'page' : undefined}>{p.navLabel?.[lang] ?? p.title[lang]}</a
        >
      {/each}
    </nav>

    <div class="footerEnd">
      <!--
        At the right-hand end, apart from the destinations: it is not a page
        anybody came to read, it is the one that has to be findable from
        anywhere.
      -->
      <a
        class="footerLegal"
        href={LEGAL.path[lang]}
        data-alt-href={other(LEGAL.path[alt])}
        data-alt={other(ui('legalNav', alt))}
        aria-current={LEGAL.id === page.id ? 'page' : undefined}>{ui('legalNav', lang)}</a
      >

      <!--
        The language, the same way on every page: a drawn globe (never the
        emoji, which is a different object on every platform), opening two real
        links. `aria-label` says "Language", which is what a button with no text
        owes a screen reader.
      -->
      <button
        type="button"
        class="langBtn"
        popovertarget="langPop"
        aria-label={ui('langLabel', lang)}
        data-alt-aria={other(ui('langLabel', alt))}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
          <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="12" cy="12" r="9"></circle>
            <ellipse cx="12" cy="12" rx="4.1" ry="9"></ellipse>
            <path d="M3.2 9h17.6M3.2 15h17.6"></path>
          </g>
        </svg>
      </button>
    </div>
  </div>

  <!--
    Real links to this page in the other language, not an in-app toggle: the
    href is what makes the hreflang pair navigable, and a crawler follows
    nothing else. `hreflang` and `lang` describe the destination. Inside the bar
    so it is in the document either way — a popover hides its contents, it does
    not withhold them — and outside `.footerRow`, so the phone, which hides the
    row, can still open it from the drawer.

    On `/` these are the two homes, and they do not change when the page swaps
    language: each link names a language, not "the other one".
  -->
  <div id="langPop" popover="auto" class="langPop">
    <div class="langPopHead">
      <p class="langPopTitle" data-alt={other(ui('langTitle', alt))}>{ui('langTitle', lang)}</p>
      <button
        type="button"
        class="langPopClose"
        popovertarget="langPop"
        popovertargetaction="hide"
        aria-label={ui('langClose', lang)}
        data-alt-aria={other(ui('langClose', alt))}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
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
    <ul>
      {#each LANGS as l (l)}
        <li>
          <a
            href={page.path[l]}
            data-alt-href={other(page.path[l])}
            hreflang={LOCALE[l]}
            lang={l}
            aria-current={!home && l === lang ? 'true' : undefined}>{ui('langName', l)}</a
          >
        </li>
      {/each}
    </ul>
  </div>
</footer>
