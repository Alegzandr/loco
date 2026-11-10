<script lang="ts">
  import ContentPage from '../../layouts/ContentPage.svelte'
  import RulesArticle from '../../content/RulesArticle.svelte'
  import { RULES, pageJsonLd } from '../../seo/meta'
</script>

<ContentPage page={RULES} lang="en" jsonLd={pageJsonLd(RULES, 'en')}>
  <RulesArticle lang="en" />
</ContentPage>
