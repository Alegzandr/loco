<script lang="ts">
  // The shell every content page shares: a header, one column, and the site's
  // bar at the foot — the same bar, drawer and language chooser the game's
  // pages carry (SiteFooter.svelte, SiteDrawer.svelte), so moving between this
  // page and the game is moving inside one app.
  //
  // A layout, not a component each page wraps itself in: a move from the rules
  // to the cards keeps this shell (and its bar, its header) and replaces only
  // the article under it. Everything it shows comes from
  // `routeFor(page.url.pathname)`.
  //
  // Prerendered whole, and readable with no script at all: everything below is
  // markup in the served HTML. <LocoLogo /> is the game's own component, so the
  // mark on the page is the mark in the game — and because the page is rendered
  // on the server first, nothing in it may put its markup inside an effect,
  // which never runs there. The drawer and the language chooser are native
  // popovers for the same reason.
  //
  // What only these pages have is the header: the mark back to the game and the
  // "Play" beside it, pinned, because these documents are long. The game's
  // pages have none — the entry screen is its own composition, with the
  // wordmark at its centre — and that is the one deliberate difference between
  // the two shells.
  import type { Snippet } from 'svelte'
  import { page } from '$app/state'
  import Head from '../../layouts/Head.svelte'
  import SiteFooter from '../../layouts/SiteFooter.svelte'
  import SiteDrawer from '../../layouts/SiteDrawer.svelte'
  import ToTop from '../../layouts/ToTop.svelte'
  import LocoLogo from '../../components/LocoLogo.svelte'
  import { FAQ_PAGE, HOME, RULES, pageJsonLd, LOCALE } from '../../seo/meta'
  import { routeFor } from '../../seo/document'
  import { faqJsonLd } from '../../content/faq'
  import { ui } from '../../content/ui'
  import '../../content/content.css'

  const { children }: { children: Snippet } = $props()

  const route = $derived(routeFor(page.url.pathname))
  const def = $derived(route.page ?? RULES)
  const lang = $derived(route.lang)
  // FAQPage rather than the shared page graph: it is the one structured-data
  // type on this site that can put content directly into a result instead of
  // decorating one, which is the reason that page earns its place.
  const jsonLd = $derived(def.id === FAQ_PAGE.id ? faqJsonLd(lang, LOCALE[lang]) : pageJsonLd(def, lang))

  // ── Smooth in-page travel ────────────────────────────────────────────────
  //
  // The attribute `content.css` hangs `scroll-behavior: smooth` off. Written
  // here rather than declared in the stylesheet because a reduced-motion reader
  // has to keep the instant jump and that file may not carry the media query;
  // `data-motion` is the game's, so the system preference is the only answer
  // available. A live listener: the setting can be flipped while the page is
  // open. Taken back off when the reader leaves for the game, which scrolls
  // nothing, so the router's own jump to the top of the next page is instant.
  $effect(() => {
    const fluid = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      if (fluid.matches) delete document.documentElement.dataset.scroll
      else document.documentElement.dataset.scroll = 'smooth'
    }
    sync()
    fluid.addEventListener('change', sync)
    return () => {
      fluid.removeEventListener('change', sync)
      delete document.documentElement.dataset.scroll
    }
  })
</script>

<Head page={def} {lang} {jsonLd} />

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
      <SiteDrawer page={def} {lang} />

      <a class="brand" href={HOME.path[lang]} aria-label={ui('homeLabel', lang)}>
        <LocoLogo size="1.5rem" />
      </a>
      <a class="cta" href={HOME.path[lang]}>{ui('play', lang)}</a>
    </header>
  </div>

  <main class="content" id="content">
    {@render children()}
  </main>

  <ToTop {lang} />

  <SiteFooter page={def} {lang}>
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
