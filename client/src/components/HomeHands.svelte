<script lang="ts">
  /**
   * The two hands the entry screen is held between.
   *
   * The canvas behind a screen stays the designed gradient and nothing is
   * painted on it; what carries the life is objects, and the only objects
   * this game has are its cards. So the first thing a player sees is the
   * deck itself, at a size nothing at the table ever shows it: two fans
   * rising out of the bottom corners, the real `<Card />`, so the face on the
   * home screen is the face in the hand.
   *
   * Decoration and nothing else: out of the accessibility tree, out of the
   * pointer's way, clipped by its own layer so a card hanging under the fold
   * never gives the one-viewport screen something to scroll to. Drawn only
   * where the corners are free (a wide window that is tall enough); a phone
   * gets the screen it had.
   */
  import Card from './cards/Card.svelte'
  import type { CardDTO } from '../types/protocol'

  const card = (color: CardDTO['color'], kind: CardDTO['kind'], value?: number): CardDTO =>
    value === undefined ? { color, kind } : { color, kind, value }

  /** Left to right in each hand; the middle one stands highest. */
  const LEFT: CardDTO[] = [
    card('red', 'number', 7),
    card('yellow', 'skip'),
    card('wild', 'wild_draw_four'),
    card('green', 'number', 2),
    card('blue', 'number', 9),
  ]
  const RIGHT: CardDTO[] = [
    card('blue', 'reverse'),
    card('green', 'number', 5),
    card('wild', 'global_switch'),
    card('red', 'draw_two'),
    card('yellow', 'number', 1),
  ]

  /** Degrees between two neighbours of a fan. */
  const STEP = 14
  const angle = (i: number, n: number) => (i - (n - 1) / 2) * STEP
</script>

<div class="hands" aria-hidden="true" data-testid="home-hands">
  {#each [{ side: 'left', cards: LEFT }, { side: 'right', cards: RIGHT }] as hand (hand.side)}
    <div class="hand {hand.side}">
      {#each hand.cards as c, i (i)}
        <div class="held" style="--a: {angle(i, hand.cards.length)}deg; --i: {i}">
          <Card card={c} shadow style="width: var(--cw); height: calc(var(--cw) * 1.5); border-radius: calc(var(--cw) * 0.07)" />
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .hands {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 0;
    display: none;
    /* One number sizes the whole drawing: a card's width. */
    --cw: clamp(132px, 10.5vw, 208px);
  }

  /* Only where the corners are free: under this the fans would stand in the
     column the lockup and the four buttons hold. */
  @media (min-width: 75rem) and (min-height: 40rem) {
    .hands {
      display: block;
    }
  }

  /* A fan turns round a point under the fold, well below its cards' feet. */
  .hand {
    position: absolute;
    bottom: calc(var(--cw) * -2.35);
    width: 0;
    height: 0;
  }

  .left {
    left: 13vw;
    transform: rotate(9deg);
  }

  .right {
    right: 13vw;
    transform: rotate(-9deg);
  }

  .held {
    position: absolute;
    left: calc(var(--cw) * -0.5);
    bottom: 0;
    transform-origin: 50% 100%;
    transform: rotate(var(--a)) translateY(calc(var(--cw) * -2.2));
    animation: handRise 0.7s var(--ease-out) both;
    animation-delay: calc(var(--i) * 60ms + 120ms);
  }

  /* The hands come up into the frame once, card by card. In only. */
  @keyframes handRise {
    from {
      transform: rotate(var(--a)) translateY(calc(var(--cw) * -0.9));
    }
    to {
      transform: rotate(var(--a)) translateY(calc(var(--cw) * -2.2));
    }
  }

  :root[data-motion='reduce'] .held {
    animation: none;
  }
</style>
