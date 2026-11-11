<script lang="ts">
  // One route for every content page in this language: the slug is matched
  // against the registry (`src/params.ts`), and the page it names chooses the
  // article. The shell around it is `(content)/+layout.svelte`.
  import { page } from '$app/state'
  import Article from '../../../content/Article.svelte'
  import { routeFor } from '../../../seo/document'

  const route = $derived(routeFor(page.url.pathname))
</script>

{#if route.page}<Article id={route.page.id} lang={route.lang} />{/if}