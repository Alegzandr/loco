<script lang="ts">
  // What the home page says about the game, written once.
  //
  // It is what the sheet at the left-hand end of the home page's bar opens, on
  // a wide screen from the bar and on a phone from the drawer's first row — and
  // the only prose on `/` a crawler can read.
  //
  // The sections head at <h3>: the sheet is the rules modal now, and the modal
  // titles itself at <h2>. The document's one <h1> is the served heading on `/`.
  import { ui } from './ui'
  import type { Lang } from '../seo/meta'

  const { lang }: { lang: Lang } = $props()
</script>

<section>
  <h3>{ui('homeAboutH2', lang)}</h3>
  <p>{ui('homeAbout', lang)}</p>
</section>

<section>
  <h3>{ui('homeDiffH2', lang)}</h3>
  <ul>
    <li>{ui('homeDiff1', lang)}</li>
    <li>{ui('homeDiff2', lang)}</li>
    <li>{ui('homeDiff3', lang)}</li>
  </ul>
</section>
