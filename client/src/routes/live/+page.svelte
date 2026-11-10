<script lang="ts">
  import ContentPage from '../../layouts/ContentPage.svelte'
  import LiveArticle from '../../content/LiveArticle.svelte'
  import { LIVE, pageJsonLd } from '../../seo/meta'
</script>

<ContentPage page={LIVE} lang="en" jsonLd={pageJsonLd(LIVE, 'en')}>
  <LiveArticle lang="en" />
</ContentPage>
