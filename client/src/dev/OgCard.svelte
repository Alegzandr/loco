<script lang="ts" module>
  /** The canonical OG size. Both Discord and X take 1.91:1 without re-cropping. */
  export const OG_W = 1200
  export const OG_H = 630
</script>

<script lang="ts">
  /**
   * The social preview card (Open Graph / X), 1200×630 — dev-only, like every
   * other showcase scene, and captured by `tools/og/shoot.mjs` into
   * `client/public/og.png`.
   *
   * It is built from the real `<LocoLogo />` and the real `<Card />` rather than
   * from a standalone drawing, because that is the whole point: the duck on the
   * link preview is the duck on the cards is the duck in the tab. A hand-authored
   * copy would drift away from the mark the first time it is touched.
   *
   * What it has to do, in the half second a link gets in a Discord channel or on a
   * timeline: say *card game*, say *LOCO*, and look like something you'd click. So
   * the frame is the duck and a fan of real cards, and the text is a wordmark plus
   * one line. Anything longer is unread at preview size anyway — Discord renders
   * this at ~400px wide and X crops it.
   */
  import LocoLogo from '../components/LocoLogo.svelte'
  import Card from '../components/cards/Card.svelte'
  import type { CardDTO } from '../types/protocol'
  import { elementSize } from '../hooks/boardMetrics.svelte'
  import { i18n } from '../i18n/i18n.svelte'

  const card = (color: CardDTO['color'], kind: CardDTO['kind'], value?: number): CardDTO =>
    value === undefined ? { color, kind } : { color, kind, value }

  /**
   * The fan, left to right: all four suits so the palette is complete at a glance,
   * plus the +4 — the card that decides matches — kept in the middle of the arc
   * rather than at an end, where a crop or an avatar overlay could take it. Two of
   * the five are action cards, which is what says "this one bites" without a word
   * of copy.
   */
  const FAN: { card: CardDTO; rot: number; y: number; z: number }[] = [
    { card: card('green', 'number', 4), rot: -18, y: 30, z: 1 },
    { card: card('blue', 'skip'), rot: -9, y: 6, z: 2 },
    { card: card('wild', 'wild_draw_four'), rot: 0, y: 0, z: 5 },
    { card: card('yellow', 'draw_two'), rot: 9, y: 6, z: 4 },
    { card: card('red', 'number', 7), rot: 18, y: 30, z: 3 },
  ]

  const CARD_W = 196
  const CARD_H = 294
  /** Horizontal step between fanned cards — deliberately tight: overlap reads as a hand. */
  const CARD_STEP = 126

  const t = $derived(i18n.t)
  let frame = $state<HTMLDivElement | null>(null)
  const size = elementSize(() => frame)
  // The capture runs at exactly 1200×630, so the scale is 1 there. Everywhere else
  // (the gallery, a contact sheet, a phone) the card shrinks whole rather than
  // reflowing — it is one fixed image, not a responsive layout.
  const scale = $derived(
    size.current.width && size.current.height
      ? Math.min(1, size.current.width / OG_W, size.current.height / OG_H)
      : 1,
  )
  const lines = $derived(t.tagline.split(/(?<=[.!?])\s+/))
</script>

<div class="frame" bind:this={frame}>
  <div class="card" data-og-card="" style="transform: scale({scale})">
    <div class="glow" aria-hidden="true"></div>

    <div class="brand">
      <LocoLogo size="118px" stacked class="logo" />
      <!-- One line per sentence. Left to itself the column breaks the tagline
           wherever the width runs out ("Cards at speed. Nobody / waits their
           turn."), which reads as a text box that ran out of room rather than as a
           line somebody wrote. -->
      <p class="tagline">
        {#each lines as line (line)}
          <span class="taglineLine">{line}</span>
        {/each}
      </p>
    </div>

    <div class="fan" aria-hidden="true">
      {#each FAN as f, i (i)}
        <div
          class="slot"
          style="transform: translate({i * CARD_STEP}px, {f.y}px) rotate({f.rot}deg); z-index: {f.z}"
        >
          <Card card={f.card} shadow style="width: {CARD_W}px; height: {CARD_H}px" />
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  /* A fixed 1200×630 drawing, not a responsive layout: the frame only scales it
     whole so it can also be looked at in the gallery. */

  .frame {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: #0a0c14;
  }

  .card {
    position: relative;
    width: 1200px;
    height: 630px;
    flex: none;
    overflow: hidden;
    transform-origin: center;

    /* The table, not the app: this image never follows the light/dark theme, so
       every token it inherits is pinned here. A link preview is one picture, and
       it must not depend on which theme the machine that captured it was in. */
    --color-stroke: #241546;
    --color-primary: #ff3d68;

    /* Same near-black felt the board uses. The cards are the only bright objects
       on it, which is exactly the job at preview size. */
    background:
      radial-gradient(120% 140% at 78% 108%, #2b3145 0%, rgba(43, 49, 69, 0) 62%),
      linear-gradient(150deg, #262b3a 0%, #12151f 58%, #0a0c14 100%);
    font-family: var(--font-body);
  }

  /* Two suit-coloured washes behind the artwork. Enough to keep the corners from
     going flat black in a dark Discord channel, far too faint to fight a card. */
  .glow {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(46% 62% at 20% 34%, rgba(255, 61, 104, 0.32) 0%, rgba(255, 61, 104, 0) 70%),
      radial-gradient(52% 68% at 74% 22%, rgba(108, 92, 255, 0.34) 0%, rgba(108, 92, 255, 0) 72%),
      radial-gradient(40% 55% at 60% 100%, rgba(21, 212, 255, 0.18) 0%, rgba(21, 212, 255, 0) 70%);
  }

  .brand {
    position: absolute;
    left: 76px;
    top: 50%;
    transform: translateY(-50%);
    width: 344px;
    z-index: 10;
  }

  /* Global: the element wearing it is rendered by <LocoLogo />. */
  .brand :global(.logo) {
    /* The stacked logo centres itself; here it anchors the left column. */
    align-items: flex-start;
    justify-content: flex-start;
  }

  .tagline {
    margin: 26px 0 0 4px;
    max-width: 360px;
    font: 600 27px/1.3 var(--font-display);
    letter-spacing: -0.2px;
    color: #e9e2ff;
    text-shadow: 0 2px 0 rgba(10, 12, 20, 0.55);
  }

  /* One sentence per line. The column is sized for the longest sentence, so this
     is the only break the tagline needs; a sentence longer than the column still
     wraps inside its own line rather than running out of the frame. */
  .taglineLine {
    display: block;
  }

  /* Bottom-anchored so the arc rises out of the lower-right corner the way a hand
     does, and free to bleed a little past the frame — a fan that stops politely
     inside the edges reads as clip art. */
  .fan {
    position: absolute;
    left: 470px;
    bottom: 118px;
    width: 0;
    height: 0;
  }

  .slot {
    position: absolute;
    left: 0;
    bottom: 0;
    transform-origin: 50% 100%;
    filter: drop-shadow(0 14px 0 rgba(6, 7, 12, 0.45)) drop-shadow(0 26px 34px rgba(0, 0, 0, 0.55));
  }
</style>
