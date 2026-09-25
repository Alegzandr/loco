<script lang="ts">
  import { untrack } from 'svelte'
  import type { CardDTO } from '../../types/protocol'
  import Card from './Card.svelte'
  import type { FanHold } from './PlayerSlot.svelte'
  import { calcHandSlots, handCardKeys } from './layout'
  import {
    CARD_W,
    CARD_H,
    handCard,
    handScale,
    DEAL_FLIGHT_MS,
    DEAL_STAGGER_MS,
    radToDeg,
  } from './cardTheme'

  type Props = {
    hand: CardDTO[]
    /** The round the hand was dealt for; a new one restarts the deal stagger. */
    roundNumber?: number
    width: number
    height: number
    /** A phone on its side: the fan sits on the bottom edge, not above a bar (`layout.ts`). */
    landscape?: boolean
    /** Predicate run per card to decide playable/highlight state. */
    isPlayable: (card: CardDTO) => boolean
    /**
     * Predicate that decides whether a tap should be allowed at all (turn or legal
     * interrupt). When false, the card renders without pointer cursor.
     */
    isInteractive: (card: CardDTO) => boolean
    onCardClick: (card: CardDTO, idx: number) => void
    /**
     * The deal goes round the table, so our cards leave the deck one seat-turn
     * apart: `dealStep` between two of ours, `dealOffset` before the first.
     * Handed down by the board, which launches the fliers on the same pace.
     */
    dealStep?: number
    dealOffset?: number
    /**
     * Cards not drawn yet, each until its own flier lands: a hand passed to us
     * by a Swap or a GlobalSwitch is still crossing the table. The server's
     * snapshot names the new cards before they arrive; drawing them then
     * showed the hand already taken with its cards still in the air. Per card,
     * like an opponent's fan: one deadline for the whole hand held every card
     * until the *last* flier landed, so the first ones blinked out as their
     * fliers retired and the hand popped back in a beat later.
     */
    hold?: FanHold | null
  }

  let {
    hand,
    roundNumber = -1,
    width,
    height,
    landscape = false,
    isPlayable,
    isInteractive,
    onCardClick,
    dealStep = DEAL_STAGGER_MS,
    dealOffset = 0,
    hold = null,
  }: Props = $props()

  /**
   * Keeps a card out of sight, and out of reach, until its flier has landed on
   * it: `PlayerSlot`'s `arrive`, with `visibility` riding along so a card still
   * in the air cannot be pressed. It comes up over the flight's last few
   * frames, under the flier, so the flier retiring uncovers a card already
   * there. Keyed on the hold's stamp, never on the re-renders around it.
   */
  const ARRIVE_MS = 90
  function arrive(node: HTMLElement, arg: { hold: FanHold | null; i: number }) {
    let armed = 0
    let anim: Animation | undefined
    const run = (a: typeof arg) => {
      const h = a.hold
      if (!h || h.at === armed) return
      armed = h.at
      anim?.cancel()
      anim = undefined
      const d = h.delays[a.i]
      if (d === undefined || typeof node.animate !== 'function') return
      const left = h.at + d - Date.now()
      if (left <= 0) return
      anim = node.animate(
        [
          { opacity: 0, visibility: 'hidden' },
          { opacity: 1, visibility: 'visible' },
        ],
        { duration: ARRIVE_MS, delay: Math.max(0, left - ARRIVE_MS), fill: 'backwards' },
      )
    }
    run(arg)
    return {
      update: run,
      destroy: () => anim?.cancel(),
    }
  }

  let hoveredIdx = $state<number | null>(null)

  // The sweep. Which card is under the mouse is read off the pointer's x
  // against the fan at rest, never off the element the browser hit-tests: a
  // lifted card is drawn over its neighbour, so a hover decided by enter/leave
  // held on to it for a whole card width in one direction and let go a whole
  // card width early in the other, and every straightening moved the target
  // under the pointer.
  //
  // The card under the pointer goes all the way up at once and its neighbours
  // step aside, each on a stiff spring (`LIFT_HZ`, barely underdamped): a game's
  // hand answers the mouse on the frame, it does not drift after it. A
  // continuous wave eased towards the pointer was tried and read as mush —
  // smooth, and a beat late on every card. Written straight onto `.lift` in a
  // frame loop, because nothing continuous goes through reactive state; only
  // the index (`hoveredIdx`, the z-order) is reactive.
  /** The spring's natural frequency: ~40 ms to 90 % of the way. */
  const LIFT_HZ = 8
  /** Just under critical: the card lands with a twitch of life, ~3 % past. */
  const LIFT_DAMPING = 0.72
  /** The neighbours' share of the lift: enough to feel the hand, not a wave. */
  const NEIGHBOUR_LIFT = 0.16
  // A fan leaves wedges of felt between its tilted cards, and a sweep across
  // the hand crosses one between every pair: dropping the lift on the leave
  // made the fan flicker under a mouse. The lift outlives the leave by a beat,
  // long enough for the pointer to reach the next card, and only a pointer
  // that has really left the hand puts it down.
  const HOVER_GRACE_MS = 140
  let hoverDrop: ReturnType<typeof setTimeout> | undefined
  let handEl: HTMLElement | undefined = $state()
  const liftEls: (HTMLElement | null)[] = $state([])
  let pointerX: number | null = null
  let handBox: { left: number; ratio: number } | null = null
  let lifting = false
  let raf = 0
  let lastFrame = 0
  const cur: { w: number; vw: number; dx: number; vdx: number }[] = []

  const reduced = () => document.documentElement.dataset.motion === 'reduce'

  /** The card whose strip the pointer is over, off the resting fan; `fallback` where there is no layout. */
  function cardAt(fallback: number): number {
    const el = handEl
    const n = slots.length
    if (!el || pointerX === null || n === 0) return fallback
    // Read once per visit, not per move: a rect read after the frame loop's
    // writes forces a style recalc on every pointer event of the sweep.
    if (!handBox) {
      const rect = el.getBoundingClientRect()
      if (!rect.width || !el.offsetWidth) return fallback
      handBox = { left: rect.left, ratio: el.offsetWidth / rect.width }
    }
    const x = (pointerX - handBox.left) * handBox.ratio
    // Each card owns the strip its right-hand neighbour leaves showing.
    const step = n > 1 ? slots[1].x - slots[0].x : handCard(landscape).w
    return Math.max(0, Math.min(n - 1, Math.floor((x - slots[0].x) / step)))
  }

  function frame(now: number) {
    raf = 0
    const n = slots.length
    const dt = lastFrame ? Math.min(64, now - lastFrame) / 1000 : 1 / 60
    lastFrame = now
    const snap = reduced()
    if (lifting) hoveredIdx = cardAt(hoveredIdx ?? 0)
    const focus = lifting ? (hoveredIdx ?? -1) : -1
    // Only an overlapping fan needs parting; one spread wider than a card has
    // room already. Board pixels, taken back into the slot's own scale, which
    // `.lift` is drawn inside.
    const step = n > 1 ? slots[1].x - slots[0].x : 0
    const cw = handCard(landscape).w
    const spread = n > 1 ? Math.max(0, Math.min(cw * 0.25, (cw * 1.08 - step) * 0.45)) / scale : 0
    const omega = 2 * Math.PI * LIFT_HZ
    const stiff = omega * omega
    const damp = 2 * LIFT_DAMPING * omega
    // Substeps keep the spring stable through a long frame.
    const steps = Math.max(1, Math.ceil(dt / 0.004))
    const h = dt / steps
    cur.length = Math.min(cur.length, n)
    let moving = false
    for (let i = 0; i < n; i++) {
      const c = (cur[i] ??= { w: 0, vw: 0, dx: 0, vdx: 0 })
      const d = focus < 0 ? Infinity : Math.abs(i - focus)
      const w = d === 0 ? 1 : d === 1 && !snap ? NEIGHBOUR_LIFT : 0
      const dx = snap || d === 0 || d > 2 ? 0 : Math.sign(i - focus) * spread * (d === 1 ? 1 : 0.5)
      if (snap) {
        c.w = w
        c.dx = dx
        c.vw = c.vdx = 0
      } else {
        for (let s = 0; s < steps; s++) {
          c.vw += (stiff * (w - c.w) - damp * c.vw) * h
          c.w += c.vw * h
          c.vdx += (stiff * (dx - c.dx) - damp * c.vdx) * h
          c.dx += c.vdx * h
        }
        if (Math.abs(w - c.w) < 0.002 && Math.abs(c.vw) < 0.01 && Math.abs(dx - c.dx) < 0.05 && Math.abs(c.vdx) < 0.5) {
          c.w = w
          c.dx = dx
          c.vw = c.vdx = 0
        } else moving = true
      }
      const el = liftEls[i]
      if (!el) continue
      el.style.transform =
        c.w === 0 && c.dx === 0
          ? ''
          : `translateX(${c.dx.toFixed(2)}px) rotate(${(-radToDeg(slots[i].rotation) * c.w).toFixed(3)}deg) ` +
            `scale(${(1 + 0.08 * c.w).toFixed(4)}) translateY(${(-14 * c.w).toFixed(2)}px)`
    }
    if (moving) raf = requestAnimationFrame(frame)
    else lastFrame = 0
  }

  function kick() {
    if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame)
  }

  function hoverAt(e: PointerEvent, i: number) {
    if (e.pointerType !== 'mouse') return
    clearTimeout(hoverDrop)
    pointerX = e.clientX
    lifting = true
    const at = cardAt(i)
    if (at !== hoveredIdx || !raf) {
      hoveredIdx = at
      kick()
    }
  }
  function hoverLeave() {
    clearTimeout(hoverDrop)
    hoverDrop = setTimeout(() => {
      lifting = false
      pointerX = null
      handBox = null
      hoveredIdx = null
      kick()
    }, HOVER_GRACE_MS)
  }
  $effect(() => () => {
    clearTimeout(hoverDrop)
    if (raf) cancelAnimationFrame(raf)
  })
  // The board resized under the hand: the box read at the entry is stale.
  $effect(() => {
    void [width, height, landscape]
    handBox = null
  })
  // A card leaving re-spreads the fan: the pointer has not moved but the card
  // under it has, so the wave is aimed again.
  $effect(() => {
    void slots
    if (untrack(() => lifting)) kick()
  })

  // A hand that grows from empty is a deal — worth staggering. Any other growth is
  // a draw, which already has its own deck→hand flier and must not stagger.
  let prevLen = 0
  let prevRound = untrack(() => roundNumber)
  let dealing = $state(false)
  // The deal ends at a wall-clock moment, not after "one timeout from whenever
  // this effect last ran". Any prop moving re-runs the effect and its cleanup
  // takes the timer with it, so a version that only armed on the 0→n transition
  // armed once, lost it to the next message, and left every card wearing its
  // deal delay for the rest of the round. Same shape as `drainBar`: an absolute
  // deadline survives any number of re-runs.
  let dealUntil = 0
  $effect(() => {
    const len = hand.length
    const wasEmpty = prevLen === 0
    const newRound = roundNumber !== prevRound
    prevLen = len
    prevRound = roundNumber
    const now = Date.now()
    // A fresh deal, or the next round's: each card waits for its flier from
    // the deck (GameBoard's deal effect) and appears where it lands.
    if ((wasEmpty || newRound) && len >= 2)
      dealUntil = now + untrack(() => dealOffset + len * dealStep) + DEAL_FLIGHT_MS + 400
    const left = dealUntil - now
    if (left <= 0) {
      dealing = false
      return
    }
    dealing = true
    const id = setTimeout(() => (dealing = false), left)
    return () => clearTimeout(id)
  })

  const slots = $derived(calcHandSlots(hand.length, width, height, landscape))
  // The card is drawn at the pile's size and scaled up about its centre, so the
  // slot is offset by half the growth to land on the box `calcHandSlots` gave.
  const scale = $derived(handScale(landscape))
  const grow = $derived.by(() => {
    const c = handCard(landscape)
    return { x: (c.w - CARD_W) / 2, y: (c.h - CARD_H) / 2 }
  })
  const keys = $derived(handCardKeys(hand))
</script>

<!--
  The local player's fanned cards. Pure presentational — position and rotation come
  from `calcHandSlots`, hover state is local.

  The hover is a mouse's and nobody else's. It listened to `mouseenter`, which a
  touch screen synthesises on the tap and never follows with a `mouseleave`
  until the finger lands somewhere else: a card tapped and refused stayed lifted
  and straightened over the fan for the rest of the turn, which read as the game
  having picked it. Pointer events say what the pointer is, so a finger lifts
  nothing — the press feedback below is the touch's whole answer — and a
  refused tap leaves the fan exactly as it found it.

  Each slot is positioned purely by transform, so when a card leaves the fan the
  neighbours glide into the gap instead of snapping to their new left/top. Framer
  Motion ran that on a spring per card; it is a CSS transition now, which keeps the
  reflow on the compositor and off the main thread — the thing that matters most on
  a board whose whole point is answering a tap instantly. A fresh deal staggers the
  cards in through a per-card delay.
-->
{#if hand.length > 0}
  <div class="hand" aria-label="hand" bind:this={handEl}>
    {#each hand as card, i (keys[i])}
      {@const slot = slots[i]}
      {@const playable = isPlayable(card)}
      {@const interactive = isInteractive(card)}
      <!-- Playable cards lift slightly even at rest so they stand out. -->
      {@const restLift = playable ? -9 : 0}
      {@const hovered = hoveredIdx === i}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="slot"
        class:hovered
        class:dealing
        use:arrive={{ hold, i }}
        style="width: {CARD_W}px; height: {CARD_H}px; z-index: {hovered
          ? 100
          : i}; transform: translate({slot.x + grow.x}px, {slot.y +
          grow.y +
          restLift}px) rotate({radToDeg(slot.rotation)}deg) scale({scale}); transition-delay: {dealing
          ? dealOffset + i * dealStep
          : 0}ms; animation-delay: {dealing ? dealOffset + i * dealStep + DEAL_FLIGHT_MS : 0}ms"
        onpointerenter={(e) => hoverAt(e, i)}
        onpointermove={(e) => hoverAt(e, i)}
        onpointerleave={hoverLeave}
      >
        <div class="lift" bind:this={liftEls[i]}>
          <Card
            {card}
            {playable}
            shadow
            onclick={interactive ? () => onCardClick(card, i) : undefined}
            class="card"
          />
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .hand {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .slot {
    position: absolute;
    /* Pinned at the origin: placement and rotation are the inline transform, so
       nothing here may set left/top/transform or it would fight the reflow. */
    left: 0;
    top: 0;
    pointer-events: auto;
    transform-origin: 50% 50%;
    will-change: transform;
    /* The fan re-spreads when a card leaves and straightens under the pointer.
       Cubic-bezier rather than a spring: the overshoot a spring gave was never
       readable at this size, and this costs no frame budget at all. */
    transition: transform 420ms cubic-bezier(0.22, 1, 0.28, 1);
    animation: handCardIn 380ms cubic-bezier(0.22, 1, 0.28, 1) both;
  }

  @keyframes handCardIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* Three nested transforms, one owner each: the slot's is the fan's, `.lift`'s
     the sweep's (written per frame by `frame()`, which does its own easing, so
     it carries no transition), the card's the press. At full lift `.lift` undoes
     the slot's tilt and draws `scale(1.08) translateY(-14px)`, the transform
     `turnPillPlace`'s reserve is written from.

     The card's transition is transform alone. It also transitioned `box-shadow`, and nothing the hover
     does moves the shadow: the one shadow change a card in hand ever sees is
     the playable glow, which flips for the whole fan at once on a turn change
     and was being tweened on every card of it. */
  .slot :global(.card) {
    transform-origin: 50% 50%;
    transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  /* Its own layer: `frame()` moves it every frame of a sweep, and without one
     every step repainted the whole card, face, masks and shadow, for each of
     the three or four cards the wave was carrying. */
  .lift {
    width: 100%;
    height: 100%;
    transform-origin: 50% 50%;
    will-change: transform;
  }

  /* The press: the card gives under the thumb for the frame before it flies.
     A control that does not move when pressed is a picture of a control. */
  .slot:active :global(.card.interactive) {
    transform: scale(1.02) translateY(-6px);
    transition-duration: 60ms;
  }

  :root[data-motion="reduce"] .slot {
    transition: none;
    animation: none;
  }

  :root[data-motion="reduce"] .slot :global(.card) {
    transition: none;
  }
</style>
