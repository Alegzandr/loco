<script lang="ts">
  // Exposes the language module's three answers as DOM, so a test can read them
  // the way a screen does. The React suite spelled this as a function component
  // in the test file itself; a Svelte component has to be its own file.
  import { i18n } from '../i18n/i18n.svelte'
</script>

<div>
  <span data-testid="lang">{i18n.lang}</span>
  <span data-testid="tagline">{i18n.t.tagline}</span>
  <button onclick={() => i18n.setLang('fr')}>fr</button>
  <button onclick={() => i18n.setLang('en')}>en</button>
</div>
