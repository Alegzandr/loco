<script lang="ts">
  // Who is streaming the game, and how to be one of them.
  //
  // Prose first, list second, and that order is the design rather than a layout
  // choice: a list of channels live this afternoon is wrong tomorrow and carries
  // no search value at all, while what the game gives a stream and what it takes
  // to appear in the category are properties of the product. So the indexable
  // half is served in the markup here, and the list is drawn over it once the
  // browser has asked this origin who is live (`content/liveList.ts`) — never
  // Twitch. Every string in a row was written by a stranger, and is rendered as
  // text: no `{@html}`, no `innerHTML`.
  import { onMount } from 'svelte'
  import { ui } from './ui'
  import { EXTERNAL_REL, twitchCategory, twitchChannel } from '../components/twitchLinks'
  import { fetchLiveRows, type LiveRow } from './liveList'
  import { FAQ_PAGE, RULES, type Lang } from '../seo/meta'

  const { lang }: { lang: Lang } = $props()

  /** Nothing until the browser has asked; the served sentence stands in. */
  let rows = $state<LiveRow[]>([])
  onMount(() => {
    let live = true
    void fetchLiveRows().then((found) => {
      if (live) rows = found
    })
    return () => {
      live = false
    }
  })
</script>

<h1>{ui('liveH1', lang)}</h1>
<p class="lede">{ui('liveLede', lang)}</p>

<!-- The list, and the paragraph that stands in for it. That paragraph is served
     rather than written by the script, because it is the answer to two readers
     at once: the one arriving on a quiet evening and the one whose browser runs
     no scripts. Neither is ever shown the word "loading". -->
<section id="liveNow">
  <h2>{ui('liveNowH2', lang)}</h2>
  <!-- The served sentence explains an empty list and a browser with no
       scripts; neither is true any more once there are rows. -->
  <p class="liveNote" hidden={rows.length > 0}>{ui('liveNowNote', lang)}</p>
  <ul class="liveList" hidden={rows.length === 0}>
    {#each rows as row (row.login)}
      <li>
        <a class="liveCard" href={twitchChannel(row.login)} target="_blank" rel={EXTERNAL_REL}>
          {#if row.thumb}
            <!-- Sized on the element: a preview that arrives late must not
                 resize the list under somebody who is reading it. -->
            <img class="liveThumb" src={row.thumb} alt="" width="320" height="180" loading="lazy" decoding="async" />
          {/if}
          <span class="liveName">{row.name}</span>
          <span class="liveCount">{row.viewers.toLocaleString(lang)} {ui('liveViewersLabel', lang)}</span>
        </a>
      </li>
    {/each}
  </ul>
  <!-- The way to the category is a button, the same object every CTA in the
       game is: gradient, ink outline, ledge. It was a line of underlined words
       under the list, which is a footnote, and it is the one thing on this page
       somebody came to press. The arrow is drawn, never a glyph, and says the
       link leaves the site. -->
  <p class="btnRow">
    <a class="btnPrimary" href={twitchCategory()} target="_blank" rel={EXTERNAL_REL}>
      <span>{ui('liveCategoryLink', lang)}</span>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path
          d="M14 5h5v5M19 5l-8 8M10 6H6.5A1.5 1.5 0 0 0 5 7.5v10A1.5 1.5 0 0 0 6.5 19h10a1.5 1.5 0 0 0 1.5-1.5V14"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        ></path>
      </svg>
    </a>
  </p>
</section>

<section>
  <h2>{ui('liveWhyH2', lang)}</h2>
  <p>{ui('liveWhy1', lang)}</p>
  <p>{ui('liveWhy2', lang)}</p>
  <p>{ui('liveWhy3', lang)}</p>
</section>

<section>
  <h2>{ui('liveHowH2', lang)}</h2>
  <ol class="steps">
    <li>
      <h3>{ui('liveHowStep1', lang)}</h3>
      <p>{ui('liveHowStep1Body', lang)}</p>
    </li>
    <li>
      <h3>{ui('liveHowStep2', lang)}</h3>
      <p>{ui('liveHowStep2Body', lang)}</p>
    </li>
    <li>
      <h3>{ui('liveHowStep3', lang)}</h3>
      <p>{ui('liveHowStep3Body', lang)}</p>
    </li>
  </ol>
</section>

<section>
  <h2>{ui('liveListedH2', lang)}</h2>
  <p>{ui('liveListedBody', lang)}</p>
</section>

<!-- Chips, not a line of underlined words: the pages a reader leaves for are
     objects to press, the same ones every other article here ends on. -->
<nav class="chipRow endLinks" aria-label={ui('readNext', lang)}>
  <a href={RULES.path[lang]}>{RULES.navLabel?.[lang]}</a>
  <a href={FAQ_PAGE.path[lang]}>{FAQ_PAGE.navLabel?.[lang]}</a>
</nav>
