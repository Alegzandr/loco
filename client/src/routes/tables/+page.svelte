<script lang="ts">
  import ContentPage from '../../layouts/ContentPage.svelte'
  import TablesArticle from '../../content/TablesArticle.svelte'
  import { TABLES, pageJsonLd } from '../../seo/meta'
</script>

<ContentPage page={TABLES} lang="en" jsonLd={pageJsonLd(TABLES, 'en')}>
  <TablesArticle lang="en" />
</ContentPage>
