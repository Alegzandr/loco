<script lang="ts">
  // Which article a content page is, by the registry's page id.
  //
  // Each article is its own component, written for its own page; this is the
  // one place that says which belongs to which, so the two parameterised routes
  // (`routes/(content)/[slug=pageEn]`, `.../fr/[slug=pageFr]`) need no page per
  // file to find it. The ids are `seo/meta.ts`'s.
  import type { Component } from 'svelte'
  import RulesArticle from './RulesArticle.svelte'
  import CardsArticle from './CardsArticle.svelte'
  import TablesArticle from './TablesArticle.svelte'
  import FriendsArticle from './FriendsArticle.svelte'
  import LiveArticle from './LiveArticle.svelte'
  import FaqArticle from './FaqArticle.svelte'
  import LegalArticle from './LegalArticle.svelte'
  import type { Lang } from '../seo/meta'

  const ARTICLES: Record<string, Component<{ lang: Lang }>> = {
    rules: RulesArticle,
    cards: CardsArticle,
    tables: TablesArticle,
    friends: FriendsArticle,
    live: LiveArticle,
    faq: FaqArticle,
    legal: LegalArticle,
  }

  const { id, lang }: { id: string; lang: Lang } = $props()
  const Body = $derived(ARTICLES[id])
</script>

{#if Body}<Body {lang} />{/if}
