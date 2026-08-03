<script lang="ts">
  /**
   * Dev-only contact sheet of the whole deck: every kind in every suit, the back,
   * and the states a card can be in.
   *
   * A card is the one component the game draws forty of at once, and no screen
   * scene shows more than a handful of kinds — a change to the face is only
   * reviewable if the whole deck is on screen at once. Laid out to fit the capture
   * viewport in one shot, big row first: the face is designed at poster size and
   * read at 72px, and only the big row shows whether it survives.
   */
  import Card from '../components/cards/Card.svelte'
  import CardBack from '../components/cards/CardBack.svelte'
  import type { CardDTO, CardColor, CardKind } from '../types/protocol'

  const SUITS: CardColor[] = ['red', 'yellow', 'green', 'blue']
  const ACTIONS: CardKind[] = ['skip', 'reverse', 'draw_two', 'swap']
  const WILDS: CardKind[] = ['wild', 'wild_draw_four', 'global_switch']
  const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

  const card = (color: CardColor, kind: CardKind, value?: number): CardDTO => ({
    color,
    kind,
    value,
  })
  const BIG = 'width: 150px; height: 225px'
  const SMALL = 'width: 58px; height: 87px'
</script>

<div class="sheet">
  <h1>LOCO · le jeu complet</h1>

  <div class="row">
    <Card card={card('yellow', 'number', 1)} shadow style={BIG} />
    <Card card={card('red', 'number', 1)} shadow style={BIG} />
    <Card card={card('wild', 'wild_draw_four')} shadow style={BIG} />
    <Card card={card('blue', 'skip')} shadow style={BIG} />
    <CardBack width={150} height={225} radius={5} />
    <Card card={card('green', 'number', 4)} shadow style={SMALL} />
    <Card card={card('green', 'number', 4)} shadow playable style={SMALL} />
  </div>

  <div class="cols">
    <section>
      <h2>Nombres</h2>
      {#each SUITS as c (c)}
        <div class="row">
          {#each NUMBERS as v (v)}
            <Card card={card(c, 'number', v)} shadow style={SMALL} />
          {/each}
        </div>
      {/each}
    </section>

    <section>
      <h2>Actions</h2>
      {#each SUITS as c (c)}
        <div class="row">
          {#each ACTIONS as k (k)}
            <Card card={card(c, k)} shadow style={SMALL} />
          {/each}
        </div>
      {/each}
    </section>

    <section>
      <h2>Jokers · dos</h2>
      <div class="row">
        {#each WILDS as k (k)}
          <Card card={card('wild', k)} shadow style={SMALL} />
        {/each}
      </div>
      <div class="row">
        <CardBack width={58} height={87} radius={4} />
        <CardBack width={34} height={51} radius={3} />
        <CardBack width={20} height={30} radius={2} />
      </div>
    </section>
  </div>
</div>

<style>
  .sheet {
    min-height: 100vh;
    padding: 24px 28px 48px;
    box-sizing: border-box;
    font-family: var(--font-body);
    color: var(--color-text);
  }

  .sheet h1 {
    font-family: var(--font-display);
    font-size: 28px;
    margin: 0 0 4px;
  }

  .sheet h2 {
    font-family: var(--font-display);
    font-size: 16px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    opacity: 0.65;
    margin: 26px 0 10px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 8px;
    margin-bottom: 8px;
  }

  .cols {
    display: flex;
    align-items: flex-start;
    gap: 34px;
    flex-wrap: wrap;
  }
</style>
