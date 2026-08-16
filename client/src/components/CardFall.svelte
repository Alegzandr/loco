<script lang="ts">
  /**
   * What falls when somebody takes the match.
   *
   * It was confetti: sixty rectangles in six hard-coded colours on an
   * `animation-iteration-count: infinite`, so the burst never landed. It looped
   * for as long as the winner left the screen open. Real confetti falls once.
   *
   * The first pass at replacing it drew coloured rectangles at a 2:3 ratio and
   * called them cards, which is confetti with a longer side: at 30px, with no
   * value, no mark and no back, the only thing saying "card" was the aspect
   * ratio, and nobody reads an aspect ratio. So these are the real components,
   * at a size where the face is legible, and each one is a real object with two
   * sides: `<Card />` on the front, `<CardBack />` behind it, both hiding their
   * own backface, so the half-turns show the deck's back the way a card turning
   * over in the air does. That is the thing a rectangle cannot fake.
   *
   * It falls **once**. The version before it looped for as long as the winner
   * left the screen open, which is the detail that gave it away fastest.
   *
   * Still no JavaScript per frame: every card is two nested spans animating
   * `transform` and `opacity`, both of which stay on the compositor.
   */
  import type { CardDTO } from '../types/protocol'
  import Card from './cards/Card.svelte'
  import CardBack from './cards/CardBack.svelte'

  type Props = {
    /**
     * Kept low: these are the real card components, not chips, and this runs on
     * phones. Fourteen full faces at 44-64px fill a phone screen without
     * crowding the card the player is here to read.
     */
    count?: number
  }

  let { count = 14 }: Props = $props()

  /**
   * The deck, not a swatch list: every suit twice or three times, the two cards
   * this game adds among them, and enough numbers that the fall reads as a hand
   * going up rather than as a parade of rule cards.
   */
  const FALL_FACES: readonly CardDTO[] = [
    { color: 'red', kind: 'number', value: 7 },
    { color: 'blue', kind: 'number', value: 2 },
    { color: 'green', kind: 'skip' },
    { color: 'yellow', kind: 'number', value: 5 },
    { color: 'wild', kind: 'global_switch' },
    { color: 'red', kind: 'reverse' },
    { color: 'blue', kind: 'number', value: 9 },
    { color: 'green', kind: 'number', value: 3 },
    { color: 'yellow', kind: 'draw_two' },
    { color: 'wild', kind: 'wild' },
    { color: 'red', kind: 'swap' },
    { color: 'blue', kind: 'number', value: 6 },
    { color: 'green', kind: 'number', value: 8 },
    { color: 'wild', kind: 'wild_draw_four' },
  ]

  /** The face's own geometry, so a scaled card keeps the deck's proportions. */
  const FACE_W = 72
  const FACE_H = 108
  const FACE_R = 5

  /** Half-turns for one card: none for many, one for as many, two for the rest. */
  function turns(): number {
    const r = Math.random()
    if (r < 0.4) return 0
    if (r < 0.8) return 1
    return 2
  }

  // Randomised once, in the script body, which runs on mount and never again.
  // Re-randomising on an update would restart every card's animation, so the
  // fall would stutter instead of landing.
  const cards = Array.from({ length: count }, (_, i) => {
    // One number decides how near the card is, and everything reads off it: a
    // card close to the viewer is bigger and passes faster. Rolling size and
    // speed separately produces a big card drifting down slowly behind a small
    // one, which is the frame where the whole illusion of depth goes.
    const depth = Math.random()
    const w = Math.round(44 + depth * 20)
    return {
      left: Math.random() * 100,
      delay: Math.random() * 0.7,
      duration: 2.4 - depth * 0.7 + Math.random() * 0.4,
      drift: (Math.random() - 0.5) * 210,
      /* A card tumbles; it does not drill. Two and a half turns was the tell. */
      spin: (90 + Math.random() * 190) * (Math.random() < 0.5 ? -1 : 1),
      /* Weighted, and the weights are the readable half of the effect: a card
         turning at a constant rate spends as long edge-on as it does face-on,
         and edge-on it is a hairline. Enough of them never turn over at all
         that the screen stays mostly colour, and the rest land on their back to
         say these are objects with two sides rather than printed shapes. */
      flip: turns() * 180,
      w,
      h: Math.round((w * FACE_H) / FACE_W),
      radius: Math.max(3, Math.round((w * FACE_R) / FACE_W)),
      face: FALL_FACES[i % FALL_FACES.length],
    }
  })
</script>

<div class="layer" aria-hidden="true">
  {#each cards as c, i (i)}
    <span
      class="fall"
      style="left: {c.left}%; width: {c.w}px; height: {c.h}px; --dur: {c.duration}s; --delay: {c.delay}s; --drift: {c.drift}px; --spin: {c.spin}deg; --flip: {c.flip}deg"
    >
      <span class="tumble">
        <span class="side front">
          <Card
            card={c.face}
            style="width: {c.w}px; height: {c.h}px; border-radius: {c.radius}px"
          />
        </span>
        <span class="side back">
          <CardBack width={c.w} height={c.h} radius={c.radius} />
        </span>
      </span>
    </span>
  {/each}
</div>

<style>
  .layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 60;
  }

  /* The fall is split across two elements, and the split is not tidiness.
     A 3D context is flattened by anything that makes the browser composite its
     subtree as a group, and an animated `opacity` is exactly that: with the
     fade and the turn on one element, `preserve-3d` was silently downgraded to
     `flat`, the back was never drawn, and every half-turn showed the *front* in
     mirror image. So `.fall` owns the drift and the fade, `.tumble` owns the
     rotation and the depth, and neither touches the other's property.
     The two animations share `--dur` and `--delay` because a custom property
     inherits and `animation-duration` does not. */
  .fall {
    position: absolute;
    top: -18%;
    /* Per card rather than on the layer: with one perspective for the whole
       screen the cards at the edges turn over more violently than the ones in
       the middle, which reads as a lens rather than as falling. */
    perspective: 700px;
    will-change: transform, opacity;
    /* The fall accelerates and the turn does not, which is the pair of curves a
       tumbling object actually has. Linear on both read as confetti drifting
       down at a set speed; a card that gains on itself and leaves the frame
       faster than it entered is the same animation with weight under it. Not a
       pure ease-in, which starts from a dead stop: these are cards coming off a
       throw, so the curve keeps a little speed at 0. */
    animation: drop var(--dur, 3s) cubic-bezier(0.3, 0.2, 0.8, 0.5) var(--delay, 0s) 1 both;
  }

  .tumble {
    display: block;
    width: 100%;
    height: 100%;
    /* The two sides are stacked in Z, so the turn has to keep its depth. This is
       the declaration the whole effect rests on, and the reason nothing here may
       gain an `opacity`, a `filter` or an `overflow` of its own. */
    transform-style: preserve-3d;
    will-change: transform;
    animation: turn var(--dur, 3s) linear var(--delay, 0s) 1 both;
  }

  .side {
    position: absolute;
    inset: 0;
    /* Each side is drawn only while it faces the viewer. Without this the front
       shows through the back and the card reads as a decal on glass. */
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
  }

  .back {
    transform: rotateY(180deg);
  }

  @keyframes drop {
    0% {
      opacity: 0;
      transform: translate3d(0, 0, 0);
    }
    6% {
      opacity: 1;
    }
    /* Held opaque almost to the end, because the drop is no longer linear: at
       90% of the time an accelerating card is still a third of a screen from
       the bottom edge, so the old figure faded it out in full view. */
    96% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translate3d(var(--drift, 0px), 122vh, 0);
    }
  }

  @keyframes turn {
    0% {
      transform: rotate(0deg) rotateY(0deg);
    }
    100% {
      transform: rotate(var(--spin, 140deg)) rotateY(var(--flip, 180deg));
    }
  }

  /* Falling debris is exactly the kind of motion reduced-motion users opt out of. */
  :root[data-motion='reduce'] .layer {
    display: none;
  }
</style>
