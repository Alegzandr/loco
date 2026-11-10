<script lang="ts">
  import ContentPage from '../../layouts/ContentPage.svelte'
  import FriendsArticle from '../../content/FriendsArticle.svelte'
  import { FRIENDS, pageJsonLd } from '../../seo/meta'
</script>

<ContentPage page={FRIENDS} lang="en" jsonLd={pageJsonLd(FRIENDS, 'en')}>
  <FriendsArticle lang="en" />
</ContentPage>
