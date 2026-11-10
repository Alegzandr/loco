<script lang="ts">
  // The <head> every page shares, as Svelte renders it into the document head.
  //
  // The tags themselves come from src/seo/meta.ts as data, so a test can assert
  // the values rather than regex a template, and so a second page cannot quietly
  // disagree with the first about what the site is called. The parts of the head
  // that never change from page to page (the icons, the viewport, the charset)
  // are in src/app.html; the reset and the fonts come from the root layout.
  //
  // **Do not preload the two font faces.** It looks like the obvious win — a
  // font is discovered only once the stylesheet naming it has been parsed, and
  // the wordmark is the LCP element on `/` — and it measured as a disaster: with
  // `<link rel="preload">` on the display face, Chrome reported **no LCP
  // candidate at all** on the home page, and a page with no LCP scores 0 on
  // performance in Lighthouse (`NO_LCP`). It buys nothing anyway now that
  // `inlineStyleThreshold` puts the @font-face rules in the document. See
  // docs/notes/seo.md.
  import {
    absolute,
    alternates,
    social,
    OG_IMAGE,
    OG_LOCALE,
    SITE_NAME,
    LANGS,
    type Lang,
    type PageDef,
  } from '../seo/meta'

  interface Props {
    page: PageDef
    lang: Lang
    /** Structured data for this page, serialised into one ld+json block. */
    jsonLd?: object
    /**
     * Keeps the page out of the index, and out of the canonical/hreflang graph
     * with it. A 404 that names a canonical is claiming to be a real page.
     */
    noindex?: boolean
  }

  const { page, lang, jsonLd, noindex = false }: Props = $props()

  const shared = $derived(social(page, lang))
  const canonical = $derived(absolute(page.path[lang]))
  // A page may carry its own art; everything else shares the site's.
  const og = $derived(page.ogImage ?? OG_IMAGE)
  const ogImage = $derived(absolute(og.path[lang]))
  const links = $derived(alternates(page))

  // Structured data has to be in the document for a crawler to read it, so it is
  // written as a data block rather than bundled. CSP's script-src does not apply
  // to it: a script whose type is not a JavaScript MIME type is never executed.
  // `<` is escaped so no string in the data can close the element early; the
  // JSON a crawler parses is unchanged by it. csp.test.ts allows an inline
  // script of exactly this type and no other.
  const ldBlock = $derived(
    jsonLd
      ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}<\/script>`
      : '',
  )
</script>

<svelte:head>
  <title>{page.title[lang]}</title>
  <meta name="description" content={page.description[lang]} />

  <!--
    Canonical and hreflang. The set is reciprocal by construction — both sides
    are generated from the same PageDef — which matters because Google drops a
    hreflang set whose pages do not point back at each other.
  -->
  {#if noindex}
    <meta name="robots" content="noindex, follow" />
  {:else}
    <link rel="canonical" href={canonical} />
    {#each links as l (l.hreflang)}
      <link rel="alternate" hreflang={l.hreflang} href={l.href} />
    {/each}
  {/if}

  <!--
    Link preview (Discord, X, Slack, iMessage…). These crawlers do not run JS,
    so every one of these tags has to be in the served HTML rather than set by
    the app once it mounts — which is what prerendering this component gives.
  -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content={SITE_NAME} />
  <meta property="og:url" content={canonical} />
  <meta property="og:title" content={shared.title} />
  <meta property="og:description" content={shared.description} />
  <meta property="og:image" content={ogImage} />
  <meta property="og:image:type" content={og.type} />
  <meta property="og:image:width" content={String(og.width)} />
  <meta property="og:image:height" content={String(og.height)} />
  <meta property="og:image:alt" content={og.alt[lang]} />
  <meta property="og:locale" content={OG_LOCALE[lang]} />
  {#each LANGS.filter((l) => l !== lang) as l (l)}
    <meta property="og:locale:alternate" content={OG_LOCALE[l]} />
  {/each}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={shared.title} />
  <meta name="twitter:description" content={shared.description} />
  <meta name="twitter:image" content={ogImage} />
  <meta name="twitter:image:alt" content={og.alt[lang]} />

  <!-- eslint-disable-next-line svelte/no-at-html-tags -- our own JSON, `<` escaped -->
  {@html ldBlock}
</svelte:head>
