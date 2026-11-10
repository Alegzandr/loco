<script lang="ts">
  import ContentPage from '../../layouts/ContentPage.svelte'
  import CardsArticle from '../../content/CardsArticle.svelte'
  import { CARDS, pageJsonLd } from '../../seo/meta'
</script>

<ContentPage page={CARDS} lang="en" jsonLd={pageJsonLd(CARDS, 'en')}>
  <CardsArticle lang="en" />
</ContentPage>
