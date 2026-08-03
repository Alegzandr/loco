<script lang="ts" module>
  import type { CardDTO } from '../../types/protocol'

  export interface Flier {
    id: string
    /** 'back' renders a card back; otherwise a card face. */
    kind: 'face' | 'back'
    card?: CardDTO // required when kind === 'face'
    /** rotation is in radians, matching the layout helpers. */
    from: { x: number; y: number; rotation?: number }
    to: { x: number; y: number; rotation?: number }
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
  import { CARD_W, CARD_H, EASE_OUT_CARD, radToDeg } from './cardTheme'
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
   * `fill: 'forwards'` matters: every one of these ends somewhere other than
   * where the element sits, and without it the card would snap back for the one
   * frame before its owner removes it.
   */
  function play(
    node: HTMLElement,
    spec: { frames: Keyframe[]; duration: number; delay: number; done: () => void },
  ) {
    let anim: Animation | null = null
    const start = (s: typeof spec) => {
      anim?.cancel()
      anim = node.animate(s.frames, {
        duration: reducedMotion.current ? 0 : s.duration,
        delay: reducedMotion.current ? 0 : s.delay,
        easing: EASE,
        fill: 'forwards',
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

    const at = (x: number, y: number, rot: number, scale: number, opacity: number): Keyframe => ({
      transform: `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${scale})`,
      opacity,
    })

    // A card thrown across the table reads better with a slight lift in the
    // middle of the flight, and with a moment nearer the camera. Either one adds
    // a middle keyframe; neither adds two.
    if (arc > 0 || swell > 1) {
      const midY = (f.from.y + f.to.y) / 2 - arc
      const midX = (f.from.x + f.to.x) / 2
      const midRot = (fromRot + endRot) / 2
      const midScale = swell > 1 ? swell : (startScale + 1) / 2
      return [
        { ...at(f.from.x, f.from.y, fromRot, startScale, startAlpha), offset: 0 },
        { ...at(midX, midY, midRot, midScale, 1), offset: 0.5 },
        { ...at(f.to.x, f.to.y, endRot, 1, 1), offset: 1 },
      ]
    }
    return [at(f.from.x, f.from.y, fromRot, startScale, startAlpha), at(f.to.x, f.to.y, endRot, 1, 1)]
  }

  // Punch in, hold, then drift up and fade. The overshoot on the way in is what
  // makes the callout read as an impact rather than a label that appeared.
  const EFFECT_FRAMES: Keyframe[] = [
    { opacity: 0, transform: 'translateY(12px) scale(0.3)', offset: 0 },
    { opacity: 1, transform: 'translateY(-6px) scale(1.3)', offset: 0.16 },
    { opacity: 1, transform: 'translateY(-22px) scale(1.08)', offset: 0.6 },
    { opacity: 0, transform: 'translateY(-62px) scale(1.16)', offset: 1 },
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
      {#if f.kind === 'back'}
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
