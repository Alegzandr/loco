<script lang="ts" module>
  import type { CardDTO } from '../../types/protocol'

  export interface Flier {
    id: string
    /** 'back' renders a card back; otherwise a card face. */
    kind: 'face' | 'back'
    card?: CardDTO // required when kind === 'face'
    /** rotation is in radians, matching the layout helpers. */
    /**
     * `squash` flattens the card vertically in screen space, after its tilt:
     * a card lying on the felt, seen in the table's perspective.
     */
    from: { x: number; y: number; rotation?: number; squash?: number }
    to: { x: number; y: number; rotation?: number; squash?: number }
    /** width/height/radius — defaults to full card. Mini cards (swap trail) are smaller. */
    size?: { w: number; h: number; r: number }
    /** 0..1 starting opacity (ends at 1). */
    startAlpha?: number
    /** 0..1 starting scale (ends at 1). */
    startScale?: number
    /** ms; default 300. */
    duration?: number
    /** ms delay before this flier starts. */
    delayMs?: number
    /** Optional fade-out tail after reaching the destination. */
    fadeOut?: boolean
    /** Peak lift of the arc, in px. 0 (default) flies in a straight line. */
    arcHeight?: number
    /** Barrel roll, in *whole turns* (a half turn would land the card face down). */
    spin?: number
    /**
     * Mid-flight scale: the card passes nearer the camera. Most of what separates
     * a card being thrown from a sprite being moved.
     */
    swell?: number
    /**
     * A card that turns over on its way: a face flier leaves face down (an
     * opponent's card coming out of their hand, our own draw coming off the
     * deck); a back flier carrying a `card` leaves face up (our own card going
     * over to somebody else in a Swap). The turn is a half flip about the
     * card's long axis, done in the first half of the flight.
     */
    flip?: boolean
    /**
     * Sideways bow of the path at mid-flight, in px, perpendicular to it (the
     * sign picks the side). `arcHeight` only lifts a card, which on a path that
     * runs up or down the screen is a change of speed and not a curve: the two
     * hands of a Swap flew down the same line through each other.
     */
    curve?: number
  }

  /** Shockwave ring left where a card landed. Rare and legendary plays only. */
  export interface Impact {
    id: string
    /** Centre of the ring, in board coordinates. */
    x: number
    y: number
    /** Ring tint: the caller passes ACTIVE_RING[card.color]. */
    color: string
    /** Diameter in px; the caller sizes it by rarity. */
    size?: number
  }

  export interface EffectText {
    id: string
    text: string
    color: string
    x: number
    y: number
    /**
     * ms to wait before the callout punches in, set to the flight time, so it
     * announces the card's landing rather than the message that carried it.
     */
    delayMs?: number
  }
</script>

<script lang="ts">
  import Card from './Card.svelte'
  import CardBack from './CardBack.svelte'
  import { CARD_W, CARD_H, CARD_RADIUS, EASE_OUT_CARD, radToDeg } from './cardTheme'
  import { reducedMotion } from '../../hooks/uiPrefs.svelte'

  type Props = {
    fliers: Flier[]
    effectTexts: EffectText[]
    /** Landing rings; omitted entirely when nothing notable landed. */
    impacts?: Impact[]
    onFlierDone: (id: string) => void
    onEffectDone: (id: string) => void
    onImpactDone?: (id: string) => void
  }

  let { fliers, effectTexts, impacts = [], onFlierDone, onEffectDone, onImpactDone }: Props =
    $props()

  const IMPACT_SIZE = 170
  const EASE = `cubic-bezier(${EASE_OUT_CARD.join(', ')})`

  /**
   * One WAAPI animation, and the callback that retires whatever it moved.
   *
   * This is what replaced framer-motion here, and the replacement is closer to
   * the original than the library was: a flight is a list of keyframes with
   * offsets — the arc's three-point y track, the swell's three-point scale — and
   * that is exactly what `element.animate` takes. `onAnimationComplete` becomes
   * `animation.finished`, which is a promise the browser settles rather than a
   * callback a render loop fires.
   *
   * `fill: 'both'` matters, at both ends. Every one of these ends somewhere
   * other than where the element sits, and without the forwards half the card
   * would snap back for the one frame before its owner removes it. And the
   * element sits at the layer's origin: without the backwards half, a card
   * waiting out its delay — the last cards of a ten-seat deal wait over a
   * second — sat in the top-left corner of the board until its turn came.
   *
   * Under reduced motion a flight collapses to its destination: a zero-length
   * animation is the card already there, which is the right answer for a
   * flier and for a landing ring. It is the wrong answer for a callout, whose
   * *destination* is gone — SKIP, REVERSE, +2, +4 and the colour a wild named
   * were finishing in the same frame they started and never painted, for
   * exactly the player who had asked for a board they could read. So a spec
   * may carry a `still`: the frame to hold and for how long, played at the
   * spec's own delay so the sequencing survives (the colour callout still
   * lands `COLOR_CALLOUT_DELAY_MS` after the card's).
   */
  function play(
    node: HTMLElement,
    spec: {
      frames: Keyframe[]
      duration: number
      delay: number
      done: () => void
      still?: { frames: Keyframe[]; duration: number }
    },
  ) {
    let anim: Animation | null = null
    const start = (s: typeof spec) => {
      anim?.cancel()
      const reduced = reducedMotion.current
      anim =
        reduced && s.still
          ? node.animate(s.still.frames, {
              duration: s.still.duration,
              delay: s.delay,
              fill: 'both',
            })
          : node.animate(s.frames, {
              duration: reduced ? 0 : s.duration,
              delay: reduced ? 0 : s.delay,
              easing: EASE,
              fill: 'both',
            })
      anim.finished.then(s.done).catch(() => {})
    }
    start(spec)
    return {
      update(next: typeof spec) {
        start(next)
      },
      destroy() {
        anim?.cancel()
      },
    }
  }

  function flierFrames(f: Flier): Keyframe[] {
    const fromRot = radToDeg(f.from.rotation ?? 0)
    const toRot = radToDeg(f.to.rotation ?? 0)
    const startScale = f.startScale ?? 1
    const arc = f.arcHeight ?? 0
    const swell = f.swell ?? 0
    // The spin is whole turns in the card's own plane, folded into the same
    // rotation as the landing tilt: a full turn is visually a no-op, so the card
    // still settles on exactly `toRot`.
    const endRot = toRot + (f.spin ?? 0) * 360
    const startAlpha = f.startAlpha ?? 1

    const fromSq = f.from.squash ?? 1
    const toSq = f.to.squash ?? 1
    const at = (x: number, y: number, rot: number, scale: number, opacity: number, sq: number): Keyframe => ({
      transform: `translate(${x}px, ${y}px) scale(1, ${sq}) rotate(${rot}deg) scale(${scale})`,
      opacity,
    })

    // A card thrown across the table reads better with a slight lift in the
    // middle of the flight, and with a moment nearer the camera. Either one adds
    // a middle keyframe; neither adds two.
    const curve = f.curve ?? 0
    if (arc > 0 || swell > 1 || curve !== 0) {
      // The perpendicular of the path, for the sideways bow.
      const dx = f.to.x - f.from.x
      const dy = f.to.y - f.from.y
      const len = Math.hypot(dx, dy) || 1
      const midY = (f.from.y + f.to.y) / 2 - arc + (dx / len) * curve
      const midX = (f.from.x + f.to.x) / 2 - (dy / len) * curve
      const midRot = (fromRot + endRot) / 2
      const midScale = swell > 1 ? swell : (startScale + 1) / 2
      // In the air a card is square to us; it takes the felt's perspective
      // as it comes down on it.
      return [
        { ...at(f.from.x, f.from.y, fromRot, startScale, startAlpha, fromSq), offset: 0 },
        { ...at(midX, midY, midRot, midScale, 1, 1), offset: 0.5 },
        { ...at(f.to.x, f.to.y, endRot, 1, 1, toSq), offset: 1 },
      ]
    }
    return [
      at(f.from.x, f.from.y, fromRot, startScale, startAlpha, fromSq),
      at(f.to.x, f.to.y, endRot, 1, 1, toSq),
    ]
  }

  // Punch in, hold, then drift up and fade. The overshoot on the way in is what
  // makes the callout read as an impact rather than a label that appeared.
  const EFFECT_FRAMES: Keyframe[] = [
    { opacity: 0, transform: 'translateY(12px) scale(0.3)', offset: 0 },
    { opacity: 1, transform: 'translateY(-6px) scale(1.3)', offset: 0.16 },
    { opacity: 1, transform: 'translateY(-22px) scale(1.08)', offset: 0.6 },
    { opacity: 0, transform: 'translateY(-62px) scale(1.16)', offset: 1 },
  ]

  // The callout under reduced motion: its held frame, for as long as the full
  // animation spends readable (the 0.16 → 0.6 stretch of a second). Two
  // identical keyframes — a hold, not a tween.
  const EFFECT_STILL_MS = 900
  const EFFECT_STILL_FRAMES: Keyframe[] = [
    { opacity: 1, transform: 'translateY(-16px) scale(1.1)' },
    { opacity: 1, transform: 'translateY(-16px) scale(1.1)' },
  ]

  // Face down to face up, over the first half of the flight, then held. The
  // perspective is part of the frame so the card has depth as it turns.
  const FLIP_FRAMES: Keyframe[] = [
    { transform: 'perspective(520px) rotateY(180deg)', offset: 0 },
    { transform: 'perspective(520px) rotateY(180deg)', offset: 0.12 },
    { transform: 'perspective(520px) rotateY(0deg)', offset: 0.58 },
    { transform: 'perspective(520px) rotateY(0deg)', offset: 1 },
  ]

  // The other way round: face up to face down, for a card we are giving away.
  const FLIP_TO_BACK_FRAMES: Keyframe[] = [
    { transform: 'perspective(520px) rotateY(0deg)', offset: 0 },
    { transform: 'perspective(520px) rotateY(0deg)', offset: 0.12 },
    { transform: 'perspective(520px) rotateY(180deg)', offset: 0.58 },
    { transform: 'perspective(520px) rotateY(180deg)', offset: 1 },
  ]

  const IMPACT_FRAMES: Keyframe[] = [
    { opacity: 0.9, transform: 'scale(0.18)' },
    { opacity: 0, transform: 'scale(1)' },
  ]
</script>

<!--
  The absolute-positioned overlay holding every transient animation: flying cards
  (plays, draws, swap/global_switch trails), floating effect text (SKIP / REVERSE /
  +N) and landing rings. Each entry retires itself through its done callback.

  Movement is expressed as transforms rather than left/top so the browser can
  composite each flier on the GPU instead of running layout on every frame — the
  difference is visible once several cards fly at once.
-->
<div class="layer" aria-hidden="true">
  {#each fliers as f (f.id)}
    <div
      class="flier"
      data-flier-face={f.kind}
      style="width: {f.size?.w ?? CARD_W}px; height: {f.size?.h ?? CARD_H}px"
      use:play={{
        frames: flierFrames(f),
        duration: f.duration ?? 300,
        delay: f.delayMs ?? 0,
        done: () => onFlierDone(f.id),
      }}
    >
      {#if f.card && f.flip}
        <!-- The outer node owns the flight, this one the turn: one transform
             animation per element. -->
        <div
          class="flip"
          style="width: {f.size?.w ?? CARD_W}px; height: {f.size?.h ?? CARD_H}px"
          use:play={{
            frames: f.kind === 'back' ? FLIP_TO_BACK_FRAMES : FLIP_FRAMES,
            duration: f.duration ?? 300,
            delay: f.delayMs ?? 0,
            done: () => {},
          }}
        >
          <!-- The face is drawn at hand size and scaled onto a smaller flier. -->
          <div
            class="side"
            style="transform-origin: 0 0; transform: scale({(f.size?.w ?? CARD_W) / CARD_W})"
          >
            <Card card={f.card} />
          </div>
          <div class="side sideBack">
            <CardBack
              width={f.size?.w ?? CARD_W}
              height={f.size?.h ?? CARD_H}
              radius={f.size?.r ?? CARD_RADIUS}
            />
          </div>
        </div>
      {:else if f.kind === 'back'}
        <CardBack width={f.size?.w ?? CARD_W} height={f.size?.h ?? CARD_H} radius={f.size?.r ?? 10} />
      {:else if f.card}
        <Card card={f.card} />
      {/if}
    </div>
  {/each}

  <!-- Outer node owns the position and the centering transform; the inner node
       owns the animation, so the generated transform cannot clobber the
       -50%/-50% centering. -->
  {#each effectTexts as et (et.id)}
    <div class="effectAnchor" style="left: {et.x}px; top: {et.y}px">
      <div
        class="effectText"
        style="color: {et.color}"
        use:play={{
          frames: EFFECT_FRAMES,
          duration: 1000,
          delay: et.delayMs ?? 0,
          done: () => onEffectDone(et.id),
          still: { frames: EFFECT_STILL_FRAMES, duration: EFFECT_STILL_MS },
        }}
      >
        {et.text}
      </div>
    </div>
  {/each}

  <!-- Same split as the effect text, for the same reason: the anchor owns the
       position, the ring owns the expansion. -->
  {#each impacts as im (im.id)}
    <div class="impactAnchor" style="left: {im.x}px; top: {im.y}px">
      <div
        class="impactRing"
        style="width: {im.size ?? IMPACT_SIZE}px; height: {im.size ??
          IMPACT_SIZE}px; color: {im.color}"
        use:play={{
          frames: IMPACT_FRAMES,
          duration: 500,
          delay: 0,
          done: () => onImpactDone?.(im.id),
        }}
      ></div>
    </div>
  {/each}
</div>

<style>
  .layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .flier {
    position: absolute;
    /* Movement comes from the animated transform, so the box itself stays pinned
       at the layer origin — the browser never needs to re-run layout mid-flight. */
    left: 0;
    top: 0;
    pointer-events: none;
    will-change: transform, opacity;
  }

  /* A card turning over in flight: two sides back to back, each hiding the
     moment it faces away. */
  .flip {
    position: relative;
    transform-style: preserve-3d;
  }

  .side {
    position: absolute;
    inset: 0;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
  }

  .sideBack {
    transform: rotateY(180deg);
  }

  /* Positions the effect text and owns the centering transform, leaving the inner
     node free to animate its own. */
  .effectAnchor {
    position: absolute;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  /* Floating SKIP! / REVERSE! / +N callout. Outlined rather than shadowed so it
     stays legible over the felt, over a card face, or over the background — the
     three very different things it can land on. */
  .effectText {
    font-family: var(--font-display);
    font-size: clamp(34px, 5vw, 52px);
    font-weight: 700;
    letter-spacing: -1px;
    color: currentColor;
    -webkit-text-stroke: 5px var(--color-stroke);
    paint-order: stroke fill;
    text-shadow: 0 4px 0 var(--color-stroke-soft);
    pointer-events: none;
    white-space: nowrap;
    will-change: transform, opacity;
  }

  /* Shockwave left by a rare/legendary landing. */
  .impactAnchor {
    position: absolute;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .impactRing {
    border: 4px solid currentColor;
    border-radius: 50%;
    box-shadow: 0 0 24px currentColor;
    /* No transform here: the anchor owns the centering, the animation owns the
       expansion. Two owners on one node and the ring would jump. */
    pointer-events: none;
    will-change: transform, opacity;
  }
</style>
