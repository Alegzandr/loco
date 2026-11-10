<script lang="ts">
  import ContentPage from '../../../layouts/ContentPage.svelte'
  import CardsArticle from '../../../content/CardsArticle.svelte'
  import { CARDS, pageJsonLd } from '../../../seo/meta'
</script>

<ContentPage page={CARDS} lang="fr" jsonLd={pageJsonLd(CARDS, 'fr')}>
  <CardsArticle lang="fr" />
</ContentPage>
