<script lang="ts">
  import ContentPage from '../../../layouts/ContentPage.svelte'
  import LegalArticle from '../../../content/LegalArticle.svelte'
  import { LEGAL, pageJsonLd } from '../../../seo/meta'
</script>

<ContentPage page={LEGAL} lang="fr" jsonLd={pageJsonLd(LEGAL, 'fr')}>
  <LegalArticle lang="fr" />
</ContentPage>
