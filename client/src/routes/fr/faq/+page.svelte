<script lang="ts">
  import ContentPage from '../../../layouts/ContentPage.svelte'
  import FaqArticle from '../../../content/FaqArticle.svelte'
  import { faqJsonLd } from '../../../content/faq'
  import { FAQ_PAGE, LOCALE } from '../../../seo/meta'
</script>

<!--
  FAQPage rather than the shared page graph: it is the one structured-data
  type on this site that can put content directly into a result instead of
  decorating one, which is the reason this page earns its place.
-->
<ContentPage page={FAQ_PAGE} lang="fr" jsonLd={faqJsonLd('fr', LOCALE.fr)}>
  <FaqArticle lang="fr" />
</ContentPage>
