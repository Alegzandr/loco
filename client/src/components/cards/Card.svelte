<script lang="ts">
  import type { CardDTO } from '../../types/protocol'
  import { cardLabel, hasGlyph } from './cardTheme'
  import CardArt from './CardArt.svelte'
  import CardGlyph from './CardGlyph.svelte'
  import SuitMark from './SuitMark.svelte'
  import { colorAssistPref } from '../../hooks/colorAssist'
  import { watchPref } from '../../hooks/prefs.svelte'
  import { i18n } from '../../i18n/i18n.svelte'
  import { pressToAct } from '../press'

  type Props = {
    card: CardDTO
    /** Visually marks the card as legal-to-play (bright rim + lift glow). */
    playable?: boolean
    /** Adds the drop-shadow used for in-hand cards. */
    shadow?: boolean
    /** Click/tap handler. Triggers cursor + keyboard binding. */
    onclick?: (e: MouseEvent | KeyboardEvent) => void
    class?: string
    style?: string
  }

  let {
    card,
    playable = false,
    shadow = false,
    onclick,
    class: extra = '',
    style = '',
  }: Props = $props()

  const label = $derived(cardLabel(card))
  const t = $derived(i18n.t)
  // What is read aloud: the suit as a word, the kind by its name, the value
  // when there is one. A wild carries no suit, so it is named by its kind
  // alone rather than "wild wild".
  const spoken = $derived(
    [
      card.color === 'wild' ? '' : t.colorNames[card.color],
      t.cardNames[card.kind].toLowerCase(),
      card.value !== undefined ? String(card.value) : '',
    ]
      .filter(Boolean)
      .join(' '),
  )
  // Subscribes every card on screen, which costs one update on the rare frame the
  // preference is flipped and nothing at all otherwise.
  const assist = watchPref(colorAssistPref)
  const icon = $derived(hasGlyph(card.kind))
  const isWild = $derived(card.color === 'wild')
  // The colour-change card already *is* the four-suit fan at full size; a second
  // copy of it over the middle would only repeat itself.
  const bare = $derived(card.kind === 'wild')
  // A wild carries the four-suit fan across its middle, so its value sits below
  // it. Everything else centres on the card.
  const layout = $derived(isWild && !icon ? 'underFan' : 'centred')
  const size = $derived(icon ? 'iconSize' : label.length === 1 ? 'oneChar' : 'manyChars')

  function handleKey(e: KeyboardEvent) {
    if (!onclick) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onclick(e)
    }
  }
</script>

<!--
  A single card face: full-bleed suit gradient, the LOCO mark behind it in the
  same gradient reversed, one large glyph, and the two corner marks.

  The corners follow the reference art exactly — brand monogram top-left, value
  bottom-left-up (rotated 180°) — which is also the one thing here that costs
  something: in a tightly overlapped fan the visible sliver of each card is its
  top-left corner, so a crowded hand is read from the big glyph and the suit
  colour rather than from the corners.

  Stateless and unanimated. The caller owns any movement or hover effect.

  The children below run together with no line breaks between them, and not for
  compactness: Svelte keeps a whitespace text node where JSX dropped it, so a
  card laid out one element per line reads as "     L" instead of "L" — and that
  corner mark is the whole of a rule card's text.

  In order: the art, the one large glyph, then the two corner marks. Value
  top-left, monogram bottom-right — the reference's two marks, in the reference's
  two corners, the other way round. The reference is a hero shot of one card; in
  a hand the fan can overlap down to the left ~30% of each card, and branding
  that sliver leaves a player holding twelve cards that all say "L". The wild
  already reads this way in the reference, so this is also the rule that makes
  every card consistent.

  The suit silhouette sits under the top-left value, where a printed card puts
  its suit: in a fan the cards overlap down to that corner, so it is the only
  place a mark is still visible in a full hand.
-->
<!-- The role and the tabindex below are one decision written twice: a card
     with an `onclick` is a button and is reachable, one without is a picture
     and is not. The compiler cannot see that the two ternaries agree, so it
     reads the role as unknown and the tabindex as a stop on something inert.
     They agree. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="card {extra}"
  class:shadow
  class:playable
  class:interactive={!!onclick}
  {style}
  use:pressToAct={onclick}
  onkeydown={handleKey}
  role={onclick ? 'button' : undefined}
  tabindex={onclick ? 0 : undefined}
  aria-label={spoken}
  data-card-color={card.color}
  data-card-kind={card.kind}
  data-card-value={card.value ?? ''}
><CardArt {card} class="art"
  />{#if !bare}<div class="value {layout} {size}">{#if icon}<CardGlyph kind={card.kind} />{:else}{label}{/if}</div>{/if}<div
    class="corner cornerTL"
    class:cornerSmall={icon || label.length > 1}
  >{#if icon}<CardGlyph kind={card.kind} />{:else}{label}{/if}</div>{#if assist.current && card.color !== 'wild'}<SuitMark
      color={card.color}
      class="suitMark"
    />{/if}<div class="corner cornerBR">L</div></div>

<style>
  /* Full-bleed suit gradient, the LOCO mark behind it in the same gradient
     reversed, one large off-white glyph, two corner marks. No white frame and no
     oval: the reference art carries the card on colour alone. */

  .card {
    position: relative;
    width: 72px;
    height: 108px;
    border-radius: 5px;
    /* Every glyph on the face is sized against the card itself, so one component
       serves the hand, the discard, a flier mid-flight and the showcase without a
       second set of numbers. */
    container-type: size;
    /* Fixed, not themed: a card is a physical object and its face must read the
       same whatever the UI around it is doing. Mirrors CARD_GLYPH_INK. */
    --card-glyph-ink: #120b24;
    color: #efefef;
    font-family: var(--font-display);
    font-weight: 700;
    user-select: none;
    -webkit-user-select: none;
    box-sizing: border-box;
    /* Rule 1 of the art direction: a raised object gets an ink outline. It sits
       outside the box, so the card keeps its exact 72x108 layout size. */
    box-shadow: 0 0 0 2px var(--color-stroke);
    overflow: hidden;
    flex-shrink: 0;
    /* Fallback for anything without container query units. */
    font-size: 53px;
  }

  /* Global: the element wearing it is rendered by <CardArt />. */
  .card :global(.art) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .card.shadow {
    box-shadow:
      0 0 0 2px var(--color-stroke),
      0 4px 10px rgba(20, 8, 45, 0.35);
  }

  /* Legal-to-play: warm rim + glow. Paired with the lift applied in <Hand />, so
     "I can play this" is readable from position alone on a stream. */
  .card.playable {
    box-shadow:
      0 0 0 2px var(--color-stroke),
      0 0 0 4px rgba(255, 201, 60, 0.9),
      0 0 22px 4px rgba(255, 201, 60, 0.5),
      0 6px 14px rgba(20, 8, 45, 0.4);
  }

  /* The one large glyph. Positioned by its own centre so the number sits where
     the reference puts it — a touch above the middle of the card. */
  .value {
    position: absolute;
    left: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    letter-spacing: -0.03em;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  /* Accessibility, not decoration — see CARD_GLYPH_INK. Off-white measures
     1.18:1 against the green suit; outlined it is ~15:1 against its own ink and
     the ink is ~14:1 against any face. `paint-order` keeps the stroke behind the
     fill so the glyph does not thin out. */
  .value,
  .corner {
    color: #efefef;
    -webkit-text-stroke: 0.055em var(--card-glyph-ink);
    paint-order: stroke fill;
  }

  .centred {
    top: 46%;
  }
  /* Wilds: the four-suit fan owns the middle band, the value sits under it. */
  .underFan {
    top: 62%;
  }

  .oneChar {
    font-size: 49cqh;
  }
  .manyChars {
    font-size: 30cqh;
  }
  .iconSize {
    width: 42cqh;
    height: 42cqh;
  }
  .underFan.manyChars {
    font-size: 18cqh;
  }

  .value :global(svg) {
    width: 100%;
    height: 100%;
  }

  /* Corner marks: brand monogram top-left, value bottom-right rotated, exactly
     like the reference (and like a printed card). */
  .corner {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14.5cqh;
    line-height: 1;
    pointer-events: none;
  }

  .cornerSmall {
    font-size: 8.5cqh;
  }

  .cornerTL {
    top: 2.2%;
    left: 5.2%;
  }

  /* Upright, unlike the reference's bottom corner. That corner is rotated so a
     card reads when held the other way up — worth it for a value, meaningless for
     a monogram, which just looks like a glyph that fell over. */
  .cornerBR {
    bottom: 1.5%;
    right: 5%;
  }

  /* Colour assist: the suit's silhouette, tucked under the top-left value.
     Sized against the card like every other glyph, so it holds up from the 12px
     mini fan to the discard pile. Global: <SuitMark /> renders the element. */
  .card :global(.suitMark) {
    position: absolute;
    top: 17%;
    left: 4.4%;
    width: 15cqh;
    height: 15cqh;
    pointer-events: none;
  }

  /* The value sits lower on a wild, and a wild has no suit anyway; the rule is
     here so a future coloured card with the same layout does not overlap. */
  .underFan ~ :global(.suitMark) {
    top: 24%;
  }

  /* An icon corner has no glyph box to size it, so it gets an explicit one. */
  .corner :global(svg) {
    width: 12cqh;
    height: 12cqh;
  }

  .interactive {
    cursor: pointer;
    touch-action: manipulation;
  }

  .interactive:focus-visible {
    outline: 3px solid var(--color-tertiary);
    outline-offset: 3px;
  }
</style>
