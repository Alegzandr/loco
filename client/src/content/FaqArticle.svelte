<script lang="ts">
  // The questions, rendered from the same array the FAQPage structured data is
  // built from — so a question answered in the markup and not in the data, or the
  // reverse, cannot happen.
  import { FAQ } from './faq'
  import { ui } from './ui'
  import { RULES, type Lang } from '../seo/meta'

  const { lang }: { lang: Lang } = $props()
</script>

<h1>{ui('faqH1', lang)}</h1>
<p class="lede">{ui('faqLede', lang)}</p>

{#each FAQ as item (item.q.en)}
  <article class="qa">
    <h2>{item.q[lang]}</h2>
    {#each item.a[lang] as para, i (i)}<p>{para}</p>{/each}
  </article>
{/each}

<nav class="chipRow endLinks" aria-label={ui('readNext', lang)}>
  <a href={RULES.path[lang]}>{RULES.navLabel?.[lang]}</a>
</nav>

<p>{ui('faqOutro', lang)}</p>
