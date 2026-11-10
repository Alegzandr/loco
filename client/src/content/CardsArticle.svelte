<script lang="ts">
  // The whole deck, drawn.
  //
  // <Card /> is the game's own component, prerendered into the page: the card on
  // this page is the card in the hand, down to the gradient and the mark behind
  // it, and it is in the served HTML whether a script runs or not. Its face is
  // sized in container-query units against the element, so a size passed as a
  // style is all it takes to draw one bigger.
  import Card from '../components/cards/Card.svelte'
  import { SUITS, entry } from './deck'
  import { ui } from './ui'
  import { en } from '../i18n/en'
  import { fr } from '../i18n/fr'
  import type { CardKind, CardDTO } from '../types/protocol'
  import type { Lang } from '../seo/meta'

  const { lang }: { lang: Lang } = $props()
  const t = $derived(lang === 'fr' ? fr : en)

  const card = (color: CardDTO['color'], kind: CardKind, value?: number): CardDTO => ({
    color,
    kind,
    value,
  })

  const BIG = 'width:104px;height:156px'
  const SMALL = 'width:62px;height:93px'

  const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const ACTIONS: CardKind[] = ['skip', 'reverse', 'draw_two', 'swap']
  const WILDS: CardKind[] = ['wild', 'wild_draw_four', 'global_switch']

  const numbers = entry('number')
</script>

<h1>{ui('cardsH1', lang)}</h1>
<p class="lede">{ui('cardsLede', lang)}</p>

<section>
  <h2>{ui('cardsNumbersH2', lang)}</h2>
  <p>{numbers.effect[lang]}</p>
  <p class="cardFacts">
    <strong>{ui('cardsCopies', lang)}</strong> {numbers.copies} · {numbers.detail[lang]}
  </p>

  <!--
    `tabindex="0"` on every row for the reason the deck table carries it: these
    scroll sideways and hold nothing focusable, so without it the nine cards past
    the right edge belong to whoever can drag them into view.
  -->
  {#each SUITS as color (color)}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="cardRow" tabindex="0">
      {#each NUMBERS as value (value)}
        <Card card={card(color, 'number', value)} shadow style={SMALL} />
      {/each}
    </div>
  {/each}
</section>

<section>
  <h2>{ui('cardsActionsH2', lang)}</h2>
  {#each ACTIONS as kind (kind)}
    {@const e = entry(kind)}
    <article class="cardEntry">
      <!-- h3, because each of these is a card inside the group above it. -->
      <h3>{t.cardNames[kind]}</h3>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="cardRow" tabindex="0">
        {#each SUITS as color (color)}
          <Card card={card(color, kind)} shadow style={BIG} />
        {/each}
      </div>
      <p>{e.effect[lang]}</p>
      <p class="cardFacts">
        <strong>{ui('cardsCopies', lang)}</strong> {e.copies}
        <span aria-hidden="true"> · </span>
        <strong>{ui('cardsWorth', lang)}</strong> {e.points} {ui('cardsPoints', lang)}
      </p>
    </article>
  {/each}
</section>

<section>
  <h2>{ui('cardsWildsH2', lang)}</h2>
  {#each WILDS as kind (kind)}
    {@const e = entry(kind)}
    <article class="cardEntry">
      <h3>{t.cardNames[kind]}</h3>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="cardRow" tabindex="0">
        <Card card={card('wild', kind)} shadow style={BIG} />
      </div>
      <p>{e.effect[lang]}</p>
      <p class="cardFacts">
        <strong>{ui('cardsCopies', lang)}</strong> {e.copies}
        <span aria-hidden="true"> · </span>
        <strong>{ui('cardsWorth', lang)}</strong> {e.points} {ui('cardsPoints', lang)}
      </p>
    </article>
  {/each}
</section>

<p>{ui('cardsOutro', lang)}</p>
