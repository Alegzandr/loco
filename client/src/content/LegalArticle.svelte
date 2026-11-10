<script lang="ts">
  // Privacy, terms and credits, in one column.
  //
  // One page and not three: they answer three different questions, but only one
  // of them is ever the one somebody came for, and a reader who lands on the
  // wrong one of three URLs has to go looking. The jump list under the lede is
  // what a tab strip was, minus the state and minus the script.
  //
  // The copy is `src/content/legal.ts`. It used to be `t.legal` in the i18n
  // bundle, behind a modal; nothing in the game imports it now, so it travels
  // only with this page's own chunk, to the reader who opened it.
  import { LEGAL, LEGAL_UPDATED } from './legal'
  import { ui } from './ui'
  import type { Lang } from '../seo/meta'

  const { lang }: { lang: Lang } = $props()
  // The anchor comes from the document (`doc.slug`), so a link points at the
  // terms rather than at the page, and the same fragment resolves in both
  // languages.
  const docs = $derived(LEGAL[lang])
</script>

<h1>{ui('legalH1', lang)}</h1>
<p class="lede">{ui('legalLede', lang)}</p>

<!-- Labelled for what it does, not with the page's own <h1>: a landmark that
     repeats the heading above it tells a screen-reader user nothing they have
     not just heard. -->
<nav class="chipRow docJump" aria-label={ui('legalJump', lang)}>
  {#each docs as doc (doc.slug)}<a href={`#${doc.slug}`}>{doc.title}</a>{/each}
</nav>

{#each docs as doc (doc.slug)}
  <section id={doc.slug}>
    <h2>{doc.title}</h2>
    {#each doc.sections as section, s (s)}
      <h3>{section.heading}</h3>
      <ul>
        {#each section.items as item, i (i)}<li>{item}</li>{/each}
      </ul>
    {/each}
  </section>
{/each}

<p class="docUpdated">{LEGAL_UPDATED[lang]}</p>
