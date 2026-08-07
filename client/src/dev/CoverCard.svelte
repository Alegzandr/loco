<script lang="ts" module>
  /**
   * The cover size, 3:4 portrait.
   *
   * 600×800 is IGDB's stated minimum and the shape Twitch renders a category in
   * — roughly 285×380 in the directory, and about 40px wide in the sidebar and
   * in a search suggestion. That last number is the one the art is actually
   * designed against: a cover that only works at 285 is a cover nobody
   * recognises in the place they meet it most often.
   *
   * `tools/cover/shoot.mjs` captures at deviceScaleFactor 2, so the files on
   * disk are 1200×1600 and the ratio is unchanged. IGDB takes the larger file
   * and downsamples it, which is strictly better than handing it the floor.
   */
  export const COVER_W = 600
  export const COVER_H = 800
</script>

<script lang="ts">
  /**
   * The game cover, dev-only like every other showcase scene.
   *
   * Built from the real `<LocoLogo />` and the real `<Card />` for the reason
   * `OgCard.svelte` is: the duck on the cover is the duck on the cards is the
   * duck in the tab. A cover redrawn by hand drifts from the mark the first
   * time either is touched, and this one is uploaded to a third party where
   * nothing in this repository can see it go stale.
   *
   * **The only text is the wordmark.** IGDB requires the title to be the
   * largest text on the cover, which is satisfied by there being no other text
   * at all — and it also refuses platform logos, age ratings, watermarks and
   * publisher marks, so none of that is here either. A tagline would be
   * unreadable at 40px and is exactly the kind of thing a moderator rejects a
   * submission over.
   *
   * Three variants, because the same three questions get different answers at
   * different sizes and the pick is a judgement call made by looking:
   *
   *  - `duck`  the wordmark over a hand rising out of the bottom edge. Says
   *            *card game* and *LOCO!* in one glance; the closest relative of
   *            the link preview.
   *  - `fan`   the hand large and the wordmark under it. The most colourful,
   *            and the one that reads most like a game and least like a logo.
   *  - `mark`  the wordmark alone on the felt. Nothing to lose at 40px, which
   *            is where a category is picked out of a list.
   */
  import LocoLogo from '../components/LocoLogo.svelte'
  import Card from '../components/cards/Card.svelte'
  import type { CardDTO } from '../types/protocol'
  import { elementSize } from '../hooks/boardMetrics.svelte'

  let { variant = 'duck' }: { variant?: 'duck' | 'fan' | 'mark' } = $props()

  const card = (color: CardDTO['color'], kind: CardDTO['kind'], value?: number): CardDTO =>
    value === undefined ? { color, kind } : { color, kind, value }

  /**
   * The hand, left to right. All four suits so the palette is complete at a
   * glance, and the +4 dead centre — it is the card that decides matches, and
   * the middle of an arc is the one position no crop can take.
   *
   * Two of the five do something, which is what says *this one bites* without a
   * word of copy.
   */
  const FAN: { card: CardDTO; rot: number; y: number; z: number }[] = [
    { card: card('green', 'number', 4), rot: -26, y: 66, z: 1 },
    { card: card('blue', 'skip'), rot: -13, y: 14, z: 2 },
    { card: card('wild', 'wild_draw_four'), rot: 0, y: 0, z: 5 },
    { card: card('yellow', 'draw_two'), rot: 13, y: 14, z: 4 },
    { card: card('red', 'number', 7), rot: 26, y: 66, z: 3 },
  ]

  /**
   * Card box, the step between them, and how much of the arc's drop to keep.
   *
   * `left` is computed rather than typed: the span is `4 * step + w`, and the
   * fan is centred on the frame from it. Typing the offset by hand is what put
   * the first cut of this art off-centre by 84px — the hand ran off the right
   * edge and the green 4 was clipped on the left, which at 40px reads as a
   * mistake rather than as a bleed.
   *
   * `yScale` is the fan variant paying for its own size: the same arc drop that
   * makes a hand out of five cards at 168px puts the outer two into the
   * wordmark at 182px.
   */
  const GEOM = {
    duck: { w: 168, h: 252, step: 104, yScale: 1 },
    fan: { w: 182, h: 273, step: 115, yScale: 0.66 },
  } as const

  const g = $derived(variant === 'fan' ? GEOM.fan : GEOM.duck)
  /** Centred on the frame, bleed included, so both edges are cut by the same amount. */
  const fanLeft = $derived((COVER_W - (4 * g.step + g.w)) / 2)

  let frame = $state<HTMLDivElement | null>(null)
  const size = elementSize(() => frame)
  // The capture runs at exactly 600×800, so the scale is 1 there. Everywhere
  // else — the gallery, a contact sheet — the cover shrinks whole rather than
  // reflowing. It is one fixed drawing, not a responsive layout.
  const scale = $derived(
    size.current.width && size.current.height
      ? Math.min(1, size.current.width / COVER_W, size.current.height / COVER_H)
      : 1,
  )
</script>

<div class="frame" bind:this={frame}>
  <div class="cover cover-{variant}" data-cover-card="" style="transform: scale({scale})">
    <div class="coverGlow" aria-hidden="true"></div>

    {#if variant !== 'mark'}
      <div class="coverFan" aria-hidden="true" style="left: {fanLeft}px">
        {#each FAN as f, i (i)}
          <div
            class="coverSlot"
            style="transform: translate({i * g.step}px, {f.y * g.yScale}px) rotate({f.rot}deg); z-index: {f.z}"
          >
            <Card card={f.card} shadow style="width: {g.w}px; height: {g.h}px" />
          </div>
        {/each}
      </div>
    {/if}

    <div class="coverMark">
      <!-- Stacked everywhere the mark carries the frame; a row where it signs a
           picture the cards already own. Stacked under the fan variant's hand put
           the duck between the cards and the word, which reads as a third object
           nobody placed. -->
      <LocoLogo
        size={variant === 'mark' ? '164px' : '118px'}
        stacked={variant !== 'fan'}
        class="coverLogo"
      />
    </div>
  </div>
</div>

<style>
  /* A fixed 600×800 drawing. The frame only scales it whole, so the gallery can
     show it beside the other scenes without it reflowing into something the
     capture would never produce. */

  .frame {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: #0a0c14;
  }

  .cover {
    position: relative;
    width: 600px;
    height: 800px;
    flex: none;
    overflow: hidden;
    transform-origin: center;

    /* The table, not the app. This image never follows the light/dark theme, so
       every token it inherits is pinned here — a cover captured on a machine in
       light mode and one captured in dark have to be the same file. */
    --color-stroke: #241546;
    --color-primary: #ff3d68;

    /* The same near-black felt the board is dealt on. The cards and the mark are
       the only bright objects on it, which is the whole job at 40px. */
    background:
      radial-gradient(110% 80% at 50% 112%, #2b3145 0%, rgba(43, 49, 69, 0) 60%),
      linear-gradient(168deg, #262b3a 0%, #12151f 56%, #0a0c14 100%);
  }

  /* Three suit-coloured washes behind the artwork. Enough that the corners never
     go flat black in a dark directory listing, far too faint to fight a card.
     Portrait, so they are stacked down the frame rather than across it. */
  .coverGlow {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(58% 34% at 50% 26%, rgba(255, 61, 104, 0.34) 0%, rgba(255, 61, 104, 0) 72%),
      radial-gradient(64% 38% at 22% 62%, rgba(108, 92, 255, 0.32) 0%, rgba(108, 92, 255, 0) 74%),
      radial-gradient(58% 34% at 82% 84%, rgba(21, 212, 255, 0.2) 0%, rgba(21, 212, 255, 0) 72%);
  }

  /* `coverMark` / `coverFan` / `coverSlot`, never `brand` / `fan` / `slot`: this
     scene is mounted on `/`, which loads content/content.css for the footer and
     the drawer. Svelte's scoping adds a class, it does not isolate from one, so
     a global rule of the same name reaches straight in here — which is exactly
     how the OG card's column silently became a row. `coverCard.test.ts` fails on
     any class here that content.css also defines. */
  .coverMark {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 10;
    display: grid;
    place-items: center;
  }

  /* Global: the element wearing it is rendered by <LocoLogo />. */
  .coverMark :global(.coverLogo) {
    /* The wordmark carries the frame, so it gets the room the fan does not use.
       The drop is heavier than the logo's own: at 40px the ink outline is a
       fraction of a pixel and this is what still separates the word from the
       felt. */
    filter: drop-shadow(0 10px 18px rgba(6, 7, 12, 0.65));
  }

  /* Bottom-anchored so the arc rises out of the lower edge the way a hand does,
     and free to bleed past the frame — a fan that stops politely inside the
     edges reads as clip art rather than as cards somebody is holding. */
  .coverFan {
    position: absolute;
    width: 0;
    height: 0;
  }

  .coverSlot {
    position: absolute;
    left: 0;
    bottom: 0;
    transform-origin: 50% 100%;
    filter: drop-shadow(0 14px 0 rgba(6, 7, 12, 0.45)) drop-shadow(0 26px 34px rgba(0, 0, 0, 0.55));
  }

  /* ── duck: the wordmark above a hand rising out of the bottom edge ───────── */

  .cover-duck .coverMark {
    top: 128px;
  }

  .cover-duck .coverFan {
    bottom: 30px;
  }

  /* ── fan: the hand large, the wordmark under it ──────────────────────────── */

  /* The arc sits high and bleeds off both sides; the cards are the picture here
     and the mark signs it. */
  .cover-fan .coverFan {
    bottom: 268px;
  }

  .cover-fan .coverMark {
    bottom: 46px;
  }

  /* ── mark: the wordmark alone, as large as the frame allows ──────────────── */

  .cover-mark .coverMark {
    top: 50%;
    transform: translateY(-50%);
  }
</style>
