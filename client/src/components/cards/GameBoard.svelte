<script lang="ts" module>
  import type { CardDTO } from '../../types/protocol'

  /** Imperative handle exposed through `flightRef`: see the prop's comment. */
  export interface GameBoardHandle {
    flyFromHand: (card: CardDTO, idx: number) => void
  }

  /** Localised labels for the floating callouts over the discard pile. */
  export interface FxTexts {
    skip: string
    reverse: string
    colors: Record<'red' | 'yellow' | 'green' | 'blue', string>
  }
</script>

<script lang="ts">
  import type { CardColor, PlayerDTO } from '../../types/protocol'
  import { elementSize, safeAreaInsets } from '../../hooks/boardMetrics.svelte'
  import Deck from './Deck.svelte'
  import DiscardPile from './DiscardPile.svelte'
  import Hand from './Hand.svelte'
  import PlayerSlot from './PlayerSlot.svelte'
  import TurnIndicator, { type TurnTexts } from './TurnIndicator.svelte'
  import DirectionRing from './DirectionRing.svelte'
  import AnimationLayer, { type Flier, type EffectText, type Impact } from './AnimationLayer.svelte'
  import {
    clockwiseOpponents,
    calcHandSlots,
    discardPosition,
    deckPosition,
    seatPosition,
    tableRect,
    seatLayout,
    boardScale,
    boardSpace,
  } from './layout'
  import type { SceneSpec } from './maps'
  import type { FeltAnchor } from './layout'
  import { lightRig, rigCssVars, hexCss } from '../scene/sky'
  import SceneBackdrop from '../scene/SceneBackdrop.svelte'
  import { ACTIVE_RING, CARD_W, CARD_H, DEAL_FLIGHT_MS, DEAL_STAGGER_MS, flightFor } from './cardTheme'
  import { LOCO_MARK_PATH, LOCO_MARK_VIEWBOX } from './locoMark'
  import type { SwapNotice, LastPlay, CatchFlash } from '../../hooks/gameStore'
  import { CATCH_PENALTY_CARDS } from '../../hooks/gameStore'
  import { untrack } from 'svelte'
  import { prefersReducedMotion } from '../../hooks/motionPref'

  type Props = {
    myHand: CardDTO[]
    /**
     * Which round this hand was dealt for. A hand that appears with a new round
     * number is a deal, and a deal is flown from the deck card by card; a hand
     * that merely grew is a draw, which has its own flier below.
     */
    roundNumber?: number
    discard: CardDTO | null
    activeColor: CardColor
    players: PlayerDTO[]
    myIndex: number
    currentTurn: number
    /** Play direction: +1 clockwise on screen, -1 counter-clockwise. */
    direction: number
    /** Localised description of that direction, for the ring's accessible name. */
    directionLabel: string
    pendingDraw: number
    /** True when a card in hand actually stacks the pending penalty (see TurnIndicator). */
    canCounter: boolean
    isPlayable: (card: CardDTO) => boolean
    isInteractive: (card: CardDTO) => boolean
    /**
     * Handles the tap and returns whether the card actually left the hand, i.e.
     * whether a play was sent. The board animates only on `true`: a tap the client
     * refuses, or one that merely opens the colour/player prompt, must not throw
     * the card at the pile and then have it reappear in the fan.
     */
    onCardClick: (card: CardDTO, idx: number) => boolean
    /**
     * Filled in by the board with its imperative animation handle. Plays that are
     * confirmed later (a wild once its colour is named, a Swap once its target is)
     * call `flyFromHand` after sending, so they animate like any other play.
     */
    /**
     * A callback rather than a ref object, and that is load-bearing: props reach
     * this component through a `$state` proxy, which is *deep*, so writing
     * `flightRef.current` here would write into the proxy and leave the object
     * the caller still holds untouched. Silent, and it cost the wild its flight.
     */
    setFlightHandle?: (handle: GameBoardHandle | null) => void
    turnTexts: TurnTexts
    fxTexts: FxTexts
    /** swap / global_switch notice from the store; triggers trail animation. */
    swapNotice: SwapNotice | null
    /**
     * A Contre-LOCO! that landed; flies the penalty cards to the caught seat.
     *
     * The penalty arrives on the wire as an ordinary `card_drawn`, and on a board
     * where hands grow all match long that is indistinguishable from somebody
     * taking their turn. The cards have to be seen leaving the deck for that seat.
     */
    catchFlash: CatchFlash | null
    /** Last play from the store; drives the opponent seat→discard card flight. */
    lastPlay: LastPlay | null
    /** True while reconnect overlay is visible; board fades back in afterwards. */
    isReconnecting: boolean
    /**
     * The room this match is played in, at its hour and under its sky, or null
     * for the built-in felt.
     *
     * A scene replaces how the table is *painted* and nothing else: `tableRect()`
     * still owns the geometry, so the piles, the seats, the direction ring and
     * every animation coordinate are identical with or without one.
     */
    scene: SceneSpec | null
    /** Where the felt lands in the viewport (`feltInViewport`), for the room's podium. */
    anchor: FeltAnchor
    /** True when drawing is legal right now — makes the deck clickable. */
    canDraw: boolean
    onDraw: () => void
    drawLabel: string
  }

  let p: Props = $props()

  const SWAP_TRAIL_W = 28
  const SWAP_TRAIL_H = 40
  const SWAP_TRAIL_R = 4

  // Penalty cards flown to a caught seat. Bigger than a swap trail — this one is
  // the point of the moment rather than a hint that hands moved — and still well
  // short of a full card, which would bury the seat pill it is landing on.
  const CATCH_CARD_W = 42
  const CATCH_CARD_H = 60
  const CATCH_CARD_R = 6
  const CATCH_CARD_MS = 440
  const CATCH_CARD_STAGGER_MS = 130

  // A wild's face names no colour, so the board has to say it out loud once. The
  // ring, the pool and the chip all state the active colour permanently — this
  // callout is what teaches a new player that they mean anything, and it is also
  // the frame a clipped highlight needs: "he changed it to green" has to survive
  // muted playback. Delayed past the +N callout a wild_draw_four also fires, so the
  // two read as a sequence instead of stacking on the same pixels.
  const COLOR_CALLOUT_DELAY_MS = 420

  // Returns the floating SKIP/REVERSE/+N callout shown over the discard pile when a
  // special card resolves. The +N cases are numerals, so they need no translation;
  // the two word callouts do.
  function effectFor(
    card: CardDTO,
    pendingDraw: number,
    texts: FxTexts,
  ): { text: string; color: string } | null {
    switch (card.kind) {
      case 'skip':
        return { text: texts.skip, color: '#ff9f43' }
      case 'reverse':
        return { text: texts.reverse, color: '#74b9ff' }
      case 'draw_two':
        return { text: `+${pendingDraw || 2}`, color: '#e63946' }
      case 'wild_draw_four':
        return { text: `+${pendingDraw || 4}`, color: '#e63946' }
      default:
        return null
    }
  }

  function discardKey(c: CardDTO | null): string {
    return c ? `${c.color}-${c.kind}-${c.value ?? ''}` : ''
  }

  let nextFlierId = 1
  const newId = () => `f${nextFlierId++}`

  let boardEl = $state<HTMLDivElement | null>(null)
  let stageEl = $state<HTMLDivElement | null>(null)

  const size = elementSize(() => boardEl)
  // The element runs edge to edge (viewport-fit=cover) so the room's picture
  // reaches every corner of the screen, which puts part of it under the notch and
  // the home indicator. The picture may live there; the game may not.
  const insets = safeAreaInsets()

  // Everything below works in the board's own coordinate space; <div .stage>
  // scales that space to the element's pixel size. Children — and the pure layout
  // maths they share with the animations — never see the scale.
  const scale = $derived(
    boardScale(
      size.current.width - insets.current.left - insets.current.right,
      size.current.height - insets.current.top - insets.current.bottom,
    ),
  )
  const space = $derived(
    boardSpace(size.current.width, size.current.height, scale, insets.current),
  )
  const width = $derived(space.width)
  const height = $derived(space.height)
  const ready = $derived(width > 0 && height > 0)

  let fliers = $state<Flier[]>([])
  let effectTexts = $state<EffectText[]>([])
  let impacts = $state<Impact[]>([])
  // Landings are scheduled for the end of a flight, so they outlive the update
  // that spawned them and have to be cancelled if the board goes away first.
  let landTimers: number[] = []
  // When the local player plays a card, we already animate the hand→discard fly.
  // Suppress the "discard fade-in" flier for that one update so the two animations
  // don't stack on top of each other.
  let suppressNextDiscardFx = false
  // Rebuild key forces the board's fade-in animation to replay after a reconnect.
  let rebuildKey = $state(0)
  let wasReconnecting = p.isReconnecting

  // The room is painted by this element, but the browser paints anything the page
  // itself does not own with the *root* element's colour: a safe area on a notched
  // phone, the strip a floating browser bar reserves. The app's candy gradient
  // there reads as two bright bands laid across a room, so while a scene is up
  // the root is pinned to the scene's own horizon and a band we never get to
  // draw in still looks like the sky.
  const mapId = $derived(p.scene?.map.id ?? '')
  const rig = $derived(p.scene ? lightRig(p.scene.time, p.scene.weather) : null)
  const horizon = $derived(rig ? hexCss(rig.sky.horizon) : '')
  $effect(() => {
    const root = document.documentElement
    if (!mapId) {
      delete root.dataset.room
      root.style.removeProperty('--room-void')
      return
    }
    root.dataset.room = mapId
    root.style.setProperty('--room-void', horizon)
    return () => {
      delete root.dataset.room
      root.style.removeProperty('--room-void')
    }
  })

  // The table's materials, as CSS. A room's felt and rim never change with the
  // hour: a table is a physical thing and night does not repaint it. What the
  // hour does is in `rigCssVars`: a tint on the sheen and a dimming of the whole.
  const boardStyle = $derived.by(() => {
    if (!p.scene || !rig) return undefined
    const m = p.scene.map
    return [
      `--map-accent: ${m.accent}`,
      `--map-accent-deep: ${m.accentDeep}`,
      `--tbl-felt: ${m.table.felt}`,
      `--tbl-felt-deep: ${m.table.feltDeep}`,
      `--tbl-rim: ${m.table.rim}`,
      `--tbl-rim-light: ${m.table.rimLight}`,
      `--tbl-base: ${m.table.base}`,
      `--tbl-inlay: ${m.table.inlay}`,
      rigCssVars(rig),
    ].join('; ')
  })

  /**
   * Append without subscribing to what is already there.
   *
   * This is the one place the port of these eight effects is not a transcription.
   * React's `setFliers(cur => [...cur, x])` never *reads* the state, so an effect
   * could spawn a flier without depending on the list. In Svelte the obvious
   * `fliers = [...fliers, x]` reads it, which makes every spawning effect depend
   * on its own output and re-run forever — `effect_update_depth_exceeded`, on the
   * first swap. `untrack` restores the original meaning: take the current value,
   * do not subscribe to it.
   */
  function addFliers(...items: Flier[]) {
    fliers = untrack(() => fliers).concat(items)
  }
  function addEffects(...items: EffectText[]) {
    effectTexts = untrack(() => effectTexts).concat(items)
  }
  function addImpacts(...items: Impact[]) {
    impacts = untrack(() => impacts).concat(items)
  }

  const removeFlier = (id: string) => (fliers = fliers.filter((f) => f.id !== id))
  const removeEffect = (id: string) => (effectTexts = effectTexts.filter((e) => e.id !== id))
  const removeImpact = (id: string) => (impacts = impacts.filter((i) => i.id !== id))

  $effect(() => () => {
    landTimers.forEach(clearTimeout)
    landTimers = []
  })

  // The board takes a knock when a legendary lands. Animated through the
  // `translate` property, never `transform`: .stage's transform *is* the board
  // scale, and a WAAPI transform animation would override it mid-kick and resize
  // the whole table.
  function kickBoard() {
    const el = stageEl
    if (!el || typeof el.animate !== 'function') return
    if (prefersReducedMotion()) return
    el.animate(
      [{ translate: '0 0' }, { translate: '0 7px' }, { translate: '-5px -3px' }, { translate: '0 0' }],
      { duration: 260, easing: 'ease-out' },
    )
  }

  // A rare or legendary play leaves a shockwave where it lands. Scheduled for the
  // end of the flight rather than fired on the message: a ring that blooms while
  // its own card is still crossing the table reads as a second, unrelated event.
  function landCard(card: CardDTO, dest: { x: number; y: number }, afterMs: number) {
    const flight = flightFor(card)
    if (flight.impact <= 0) return
    const timer = window.setTimeout(() => {
      landTimers = landTimers.filter((id) => id !== timer)
      addImpacts(
        {
          id: newId(),
          x: dest.x + CARD_W / 2,
          y: dest.y + CARD_H / 2,
          color: ACTIVE_RING[card.color],
          size: flight.impact,
        },
      )
      if (flight.kick) kickBoard()
    }, afterMs)
    landTimers.push(timer)
  }

  const others = $derived(clockwiseOpponents(p.players, p.myIndex))
  // seatLayout picks the pill size and row count that actually fit this viewport,
  // and reports how much vertical space the seats claim so the table can be placed
  // underneath them rather than through them.
  const seats = $derived(seatLayout(ready ? others.length : 0, width, height))
  // Every pile/animation coordinate needs the same seat reserve the felt uses,
  // otherwise the deck, the discard and the fliers drift apart from the table.
  const topReserve = $derived(seats.blockHeight)

  // ─── Animation effect: an opponent played a card ─────────────────────────
  // Flies the card from the opponent's seat to the discard pile so the play is
  // legible without watching the pile. Declared before the discard-change effect
  // so it can claim the update and suppress the generic pile flier.
  let lastPlayAt = p.lastPlay?.at ?? 0
  $effect(() => {
    // Keyed on the play timestamp: one flight per play, never a replay on resize.
    p.lastPlay?.at
    const lp = p.lastPlay
    if (!ready || !lp || lp.at === lastPlayAt) return
    lastPlayAt = lp.at
    // Own plays already fly out of the hand via handleCardClick.
    if (lp.actorIndex === p.myIndex) return
    const from = seatPosition(lp.actorIndex, p.players, p.myIndex, width, height)
    const dest = discardPosition(width, height, topReserve)
    const flight = flightFor(lp.card)
    addFliers(
      {
        id: newId(),
        kind: 'face',
        card: lp.card,
        // seatPosition returns a centre point; fliers are positioned by corner.
        from: { x: from.x - CARD_W / 2, y: from.y - CARD_H / 2, rotation: -0.18 },
        to: { x: dest.x, y: dest.y, rotation: 0 },
        startAlpha: 0.35,
        startScale: 0.72,
        duration: flight.duration,
        arcHeight: flight.arcHeight + 4,
        spin: flight.spin,
        swell: flight.swell,
      },
    )
    landCard(lp.card, dest, flight.duration)
    suppressNextDiscardFx = true
  })

  // ─── Animation effect: discard top changed (any source) ─────────────────
  let lastDiscardKey = ''
  $effect(() => {
    // Keyed on the face *and* the play that put it there. An interject is by
    // definition the same face as the card under it, so keyed on the face alone
    // an intercepted +4 drew no +N, no SKIP, no impact — nothing at all on the
    // loudest moment in the game — and the flag below was left set, swallowing
    // the next genuine change. A Swap's snapshot carries no play and keys on
    // the face, as before.
    const face = discardKey(p.discard)
    const key = face === '' ? '' : `${face}|${p.lastPlay?.at ?? 0}`
    const pending = p.pendingDraw
    const texts = p.fxTexts
    // Read and cleared first, before any early return: the flag describes this
    // update and nothing after it.
    const covered = suppressNextDiscardFx
    suppressNextDiscardFx = false
    if (!ready) return
    if (key === '' || key === lastDiscardKey) return
    const isFirstRender = lastDiscardKey === ''
    lastDiscardKey = key
    if (isFirstRender) return // don't animate the opening card
    // A hand→discard or seat→discard flight already showed the card travelling;
    // only the generic pile flier is redundant. The effect callout still fires —
    // playing your own Skip must announce itself just like an opponent's.
    const card = p.discard!
    if (!covered) {
      const target = discardPosition(width, height, topReserve)
      const flight = flightFor(card)
      addFliers(
        {
          id: newId(),
          kind: 'face',
          card,
          from: { x: target.x, y: target.y + CARD_H / 2 },
          to: { x: target.x, y: target.y },
          startAlpha: 0.1,
          startScale: 0.6,
          duration: flight.duration,
          swell: flight.swell,
        },
      )
      landCard(card, target, flight.duration)
    }
    const eff = effectFor(card, pending, texts)
    if (eff) {
      addEffects(
        {
          id: newId(),
          text: eff.text,
          color: eff.color,
          x: width / 2,
          y: discardPosition(width, height, topReserve).y - 10,
          delayMs: flightFor(card).duration,
        },
      )
    }
  })

  // ─── Animation effect: a wild named a new colour ──────────────────────────
  // Only fires while the top card is a wild: any other card carries its colour on
  // its own face, and announcing what the player can already read is noise.
  let lastActiveColor: CardColor | '' = ''
  $effect(() => {
    const active = p.activeColor
    const disc = p.discard
    const texts = p.fxTexts
    if (!ready) return
    const prev = lastActiveColor
    lastActiveColor = active
    if (prev === '' || prev === active) return
    if (disc?.color !== 'wild') return
    const label = texts.colors[active as 'red' | 'yellow' | 'green' | 'blue']
    if (!label) return
    addEffects(
      {
        id: newId(),
        text: label,
        color: ACTIVE_RING[active],
        x: width / 2,
        y: discardPosition(width, height, topReserve).y - 10,
        delayMs: (disc ? flightFor(disc).duration : 0) + COLOR_CALLOUT_DELAY_MS,
      },
    )
  })

  // ─── Animation effect: the deal ─────────────────────────────────────────
  // Eight cards fading into a fan is a screen being drawn; eight cards flying
  // off the deck one after another, each landing where the fan will hold it,
  // is a hand being dealt. Keyed on the round so a reload mid-round rebuilds
  // the fan quietly (the Hand's own stagger) and only a fresh deal flies.
  let dealtFor = p.roundNumber ?? -1
  let dealtOnce = p.myHand.length > 0
  $effect(() => {
    const n = p.myHand.length
    const round = p.roundNumber ?? -1
    if (!ready) return
    const fresh = !dealtOnce && n >= 2
    const newRound = round !== dealtFor && n >= 2
    if (!fresh && !newRound) return
    dealtFor = round
    dealtOnce = true
    if (prefersReducedMotion()) return
    const slots = calcHandSlots(n, width, height)
    const start = deckPosition(width, height, topReserve)
    addFliers(
      ...slots.map((slot, i) => ({
        id: newId(),
        kind: 'back' as const,
        from: { x: start.x, y: start.y, rotation: 0 },
        to: { x: slot.x, y: slot.y, rotation: slot.rotation },
        startAlpha: 0.85,
        startScale: 0.92,
        duration: DEAL_FLIGHT_MS,
        delayMs: i * DEAL_STAGGER_MS,
        arcHeight: 14,
      })),
    )
  })

  // ─── Animation effect: my hand grew by one (drew a card) ─────────────────
  let prevHandSize = p.myHand.length
  $effect(() => {
    const curr = p.myHand.length
    if (!ready) return
    const prev = prevHandSize
    prevHandSize = curr
    if (curr !== prev + 1) return // only single-card draws (penalty draws batch differently)
    const slots = calcHandSlots(curr, width, height)
    const target = slots[curr - 1]
    const start = deckPosition(width, height, topReserve)
    addFliers(
      {
        id: newId(),
        kind: 'back',
        from: { x: start.x, y: start.y },
        to: { x: target.x, y: target.y, rotation: target.rotation },
        startAlpha: 0.1,
        startScale: 0.7,
        duration: 300,
      },
    )
  })

  function spawnSwapTrail(
    from: { x: number; y: number },
    to: { x: number; y: number },
    delayMs: number,
  ) {
    addFliers(
      {
        id: newId(),
        kind: 'back',
        from: { x: from.x - SWAP_TRAIL_W / 2, y: from.y - SWAP_TRAIL_H / 2, rotation: 0 },
        to: { x: to.x - SWAP_TRAIL_W / 2, y: to.y - SWAP_TRAIL_H / 2, rotation: Math.PI * 0.5 },
        size: { w: SWAP_TRAIL_W, h: SWAP_TRAIL_H, r: SWAP_TRAIL_R },
        startAlpha: 0,
        startScale: 0.7,
        duration: 480,
        delayMs,
        fadeOut: true,
      },
    )
  }

  // ─── Animation effect: swap / global_switch notice ──────────────────────
  // Guarded on the timestamp like the three effects above, and for a reason that
  // is not stylistic: the notice stays in the store for the 3.5s it is on screen,
  // and reading a prop is not a dependency on that prop's *value* — any of the
  // dozen props this board takes moving re-runs this. So every message that
  // arrived while a Swap was announced drew the trails again, and a resize drew
  // them once per frame.
  let lastSwapAt = p.swapNotice?.at ?? 0
  $effect(() => {
    p.swapNotice?.at
    const sn = p.swapNotice
    if (!ready || !sn || sn.at === lastSwapAt) return
    lastSwapAt = sn.at
    if (sn.kind === 'swap' && sn.targetIndex >= 0) {
      const a = seatPosition(sn.actorIndex, p.players, p.myIndex, width, height)
      const b = seatPosition(sn.targetIndex, p.players, p.myIndex, width, height)
      spawnSwapTrail(a, b, 0)
      spawnSwapTrail(b, a, 90)
    } else if (sn.kind === 'global_switch') {
      const ordered = [...p.players].sort((q, r) => q.index - r.index)
      const step = sn.direction >= 0 ? 1 : ordered.length - 1
      for (let i = 0; i < ordered.length; i++) {
        const fromIdx = ordered[i].index
        const toIdx = ordered[(i + step) % ordered.length].index
        if (fromIdx === toIdx) continue
        const a = seatPosition(fromIdx, p.players, p.myIndex, width, height)
        const b = seatPosition(toIdx, p.players, p.myIndex, width, height)
        spawnSwapTrail(a, b, i * 60)
      }
    }
  })

  // ─── Animation effect: a Contre-LOCO! landed ────────────────────────────
  // The penalty cards leave the deck for the caught seat, and a red +N lands on
  // it. Without this the whole mechanic is invisible: the caught hand grows the way
  // it grows on any ordinary draw, and the player who won the race sees nothing at
  // all happen.
  // Same guard as the swap trails, same reason: the flash outlives the message
  // that carried it, so without it the penalty cards left the deck again on every
  // update for as long as the banner was up.
  let lastCatchAt = p.catchFlash?.at ?? 0
  $effect(() => {
    p.catchFlash?.at
    const cf = p.catchFlash
    if (!ready || !cf || cf.at === lastCatchAt) return
    lastCatchAt = cf.at
    const seat = seatPosition(cf.seat, p.players, p.myIndex, width, height)
    const deck = deckPosition(width, height, topReserve)
    const from = {
      x: deck.x + CARD_W / 2 - CATCH_CARD_W / 2,
      y: deck.y + CARD_H / 2 - CATCH_CARD_H / 2,
    }
    const to = { x: seat.x - CATCH_CARD_W / 2, y: seat.y - CATCH_CARD_H / 2 }
    addFliers(
      ...Array.from({ length: CATCH_PENALTY_CARDS }, (_, i) => ({
        id: newId(),
        kind: 'back' as const,
        from: { ...from, rotation: 0 },
        // Fanned apart on arrival so two cards read as two, not as one card
        // landing twice.
        to: { ...to, rotation: (i - (CATCH_PENALTY_CARDS - 1) / 2) * 0.34 },
        size: { w: CATCH_CARD_W, h: CATCH_CARD_H, r: CATCH_CARD_R },
        startAlpha: 0.2,
        startScale: 0.6,
        duration: CATCH_CARD_MS,
        delayMs: i * CATCH_CARD_STAGGER_MS,
        arcHeight: 46,
        fadeOut: true,
      })),
    )
    addEffects(
      {
        id: newId(),
        text: `+${CATCH_PENALTY_CARDS}`,
        color: '#e63946',
        x: seat.x,
        // Just above the pill, not across it: the callout drifts upward as it
        // plays, and a seat whose name is covered by its own penalty is a seat
        // nobody can identify at the moment it matters most.
        y: seat.y - CATCH_CARD_H / 2,
        // Announces the cards landing, not the message that carried them — same
        // rule the SKIP / REVERSE / +N callouts follow.
        delayMs: CATCH_CARD_MS + (CATCH_PENALTY_CARDS - 1) * CATCH_CARD_STAGGER_MS,
      },
    )
  })

  // ─── Reconnect: bump rebuildKey on the false→true→false transition so the
  // board's children fade in once the overlay clears. ────────────────────
  $effect(() => {
    const now = p.isReconnecting
    if (wasReconnecting && !now) rebuildKey += 1
    wasReconnecting = now
  })

  // Spawns the hand→discard flight for a card the player has just committed.
  // Called straight after the send, never before it: the flight is a few hundred
  // milliseconds of local rendering and the message is the thing the whole table is
  // waiting on, so the packet leaves first and the animation catches up on the same
  // frame.
  function flyFromHand(card: CardDTO, idx: number) {
    if (!ready) return
    const slots = calcHandSlots(p.myHand.length, width, height)
    const slot = slots[idx]
    if (!slot) return
    const dest = discardPosition(width, height, topReserve)
    // The lift applied to playable cards in <Hand /> shifts them up by 9px at
    // rest; mirror it so the fly starts at the visually correct spot.
    const liftedY = p.isPlayable(card) ? slot.y - 9 : slot.y
    const flight = flightFor(card)
    addFliers(
      {
        id: newId(),
        kind: 'face',
        card,
        from: { x: slot.x, y: liftedY, rotation: slot.rotation },
        to: { x: dest.x, y: dest.y, rotation: 0 },
        startAlpha: 0.9,
        duration: flight.duration,
        arcHeight: flight.arcHeight,
        spin: flight.spin,
        swell: flight.swell,
      },
    )
    landCard(card, dest, flight.duration)
    suppressNextDiscardFx = true
  }

  // Re-published whenever the hand or the board size changes, so the handle closes
  // over the current ones: the picker calls it a beat after the tap that opened it.
  $effect(() => {
    p.myHand
    width
    height
    p.setFlightHandle?.({ flyFromHand })
    return () => p.setFlightHandle?.(null)
  })

  // The parent owns the rules: it tells us whether the tap became a play. A
  // refused tap (illegal card) and a tap that only opens a prompt both animate
  // nothing: flying the card out and snapping it back reads as a bug rather than
  // as "you can't play that".
  function handleCardClick(card: CardDTO, idx: number) {
    if (p.onCardClick(card, idx)) flyFromHand(card, idx)
  }

  // Felt table — geometry lives in layout.ts so tests and animations share it.
  const table = $derived(tableRect(width, height, topReserve))
</script>

<div
  bind:this={boardEl}
  class="board"
  data-testid="game-board"
  data-map={mapId}
  data-scene-time={p.scene?.time ?? ''}
  data-scene-weather={p.scene?.weather ?? ''}
  style={boardStyle}
>
  {#if p.scene}
    <!-- The room, rendered once, sharp: its podium is under the felt to the
         pixel, so the table stands in it rather than in front of it. -->
    <SceneBackdrop scene={p.scene} anchor={p.anchor} />
    <div class="vignette"></div>
  {/if}
  <div
    bind:this={stageEl}
    class="stage"
    style="width: {width}px; height: {height}px; transform: translate({space.offsetX}px, {space.offsetY}px) scale({scale})"
  >
    {#if ready && !p.isReconnecting}
      {#key rebuildKey}
        <div class="fadeIn">
          <!-- The light the table casts on the room's floor. Drawn under the table
               itself and sized off the felt, so it tracks the board scale like
               everything else. -->
          {#if p.scene}
            <div
              class="tableGlow"
              style="left: {table.left}px; top: {table.top}px; width: {table.width}px; height: {table.height}px"
            ></div>
          {/if}
          <!-- The table: a felt and a rim, CSS on exactly tableRect(). In a room
               it stands on the podium the render carries under it; without one
               it gets a CSS plinth, so the built-in felt is still an object. -->
          {#if !p.scene}
            <div
              class="tablePlinth"
              style="left: {table.left + table.width * 0.3}px; top: {table.top + table.height * 0.62}px; width: {table.width * 0.4}px; height: {table.height * 0.62}px"
            ></div>
          {/if}
          <div
            class="tableOval"
            data-testid="table"
            style="left: {table.left}px; top: {table.top}px; width: {table.width}px; height: {table.height}px"
          >
            <svg class="tableMark" viewBox={LOCO_MARK_VIEWBOX} aria-hidden="true" focusable="false">
              <path d={LOCO_MARK_PATH} fill-rule="evenodd" fill="#ffffff" />
            </svg>
          </div>
          <!-- Keyed on the direction so a Reverse remounts the ring and replays its
               flip: the change of heading is the event. -->
          {#key p.direction >= 0 ? 'cw' : 'ccw'}
            <DirectionRing rect={table} direction={p.direction} label={p.directionLabel} />
          {/key}
          <Deck
            {width}
            {height}
            {topReserve}
            canDraw={p.canDraw}
            onDraw={p.onDraw}
            drawLabel={p.drawLabel}
          />
          <DiscardPile
            card={p.discard}
            playStamp={p.lastPlay?.at ?? 0}
            activeColor={p.activeColor}
            pendingDraw={p.pendingDraw}
            {width}
            {height}
            {topReserve}
          />
          <TurnIndicator
            isMyTurn={p.currentTurn === p.myIndex}
            pendingDraw={p.pendingDraw}
            canCounter={p.canCounter}
            currentTurn={p.currentTurn}
            players={p.players}
            {height}
            texts={p.turnTexts}
          />
          {#each others as o, i (o.index)}
            <PlayerSlot
              nickname={o.nickname}
              handSize={o.hand_size}
              isActiveTurn={o.index === p.currentTurn}
              isDisconnected={o.connected === false}
              x={seats.positions[i].x}
              y={seats.positions[i].y}
              size={seats.size}
            />
          {/each}
          <Hand
            hand={p.myHand}
            roundNumber={p.roundNumber}
            {width}
            {height}
            isPlayable={p.isPlayable}
            isInteractive={p.isInteractive}
            onCardClick={handleCardClick}
          />
        </div>
      {/key}
    {/if}
    <AnimationLayer
      {fliers}
      {effectTexts}
      {impacts}
      onFlierDone={removeFlier}
      onEffectDone={removeEffect}
      onImpactDone={removeImpact}
    />
  </div>
</div>

<style>
  /* The play room: a lit table sitting in a coloured space.
     Everything here is decoration — the board's children own all the geometry. */

  .board {
    position: absolute;
    inset: 0;
    /* Decorative orbs layered over the page gradient. Painted into the element's
       own background (not a pseudo-element) so they always stay behind the table
       and every other child, whatever the stacking order. */
    background:
      radial-gradient(22% 30% at 8% 22%, rgba(255, 201, 60, 0.18) 0%, rgba(255, 201, 60, 0) 70%),
      radial-gradient(26% 34% at 93% 30%, rgba(108, 92, 255, 0.2) 0%, rgba(108, 92, 255, 0) 70%),
      radial-gradient(30% 26% at 76% 88%, rgba(255, 61, 104, 0.14) 0%, rgba(255, 61, 104, 0) 70%),
      var(--bg-gradient);
    overflow: hidden;
  }

  /* ─── Scenes ──────────────────────────────────────────────────────────────
     A scene replaces the painted room, never the geometry: `layout.ts` still owns
     where the felt, the piles, the seats and the direction ring go. Everything
     below is paint.

     The room comes in as <SceneBackdrop />, rendered once by the isometric
     engine and drawn blurred (depth of field: the table is what the eye is
     focused on). It carries its own sky, so the decorative orbs go. */
  .board[data-map]:not([data-map='']) {
    background: var(--room-void);
    /* The backdrop and the vignette are positioned children under the stage,
       and nothing inside the board goes past z-index 3, so isolating keeps the
       whole stack local. */
    isolation: isolate;
  }

  /* The room already carries its own lighting, so the decorative orbs and the
     spotlight are dropped, because two lighting schemes on one image read as
     fog. What stays is a vignette, because the hand and the action bar sit on
     top of the scene's busiest corners. A real element rather than ::before,
     so it paints between the backdrop and the stage in tree order. */
  .board[data-map]:not([data-map=''])::before {
    content: none;
  }

  .vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(
        62% 52% at 50% 44%,
        rgba(0, 0, 0, 0) 0%,
        rgba(0, 0, 0, 0) 55%,
        rgba(3, 2, 10, calc(0.14 + var(--scene-dark, 0) * 0.16)) 100%
      ),
      linear-gradient(
        180deg,
        rgba(3, 2, 10, calc(0.12 + var(--scene-dark, 0) * 0.14)) 0%,
        rgba(3, 2, 10, 0) 24%,
        rgba(3, 2, 10, 0) 62%,
        rgba(3, 2, 10, calc(0.22 + var(--scene-dark, 0) * 0.2)) 100%
      );
  }

  /* The light the table throws on the room. This is where a map's accent colour
     actually lands: wide, low and behind everything, so it tints the scene
     without competing with a card edge, the one thing that must always win. */
  .tableGlow {
    position: absolute;
    border-radius: 50%;
    background: radial-gradient(
      closest-side,
      color-mix(in srgb, var(--map-accent, #ffffff) 42%, transparent) 0%,
      color-mix(in srgb, var(--map-accent-deep, #000000) 26%, transparent) 58%,
      rgba(0, 0, 0, 0) 100%
    );
    transform: scale(1.55);
    filter: blur(26px);
    opacity: calc(0.25 + var(--scene-dark, 1) * 0.35);
    pointer-events: none;
  }

  /* Vignette + overhead spotlight. Pulls the eye to the discard pile and stops
     the corners competing with the hand. */
  .board::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(58% 42% at 50% 38%, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0) 70%),
      radial-gradient(120% 100% at 50% 45%, rgba(0, 0, 0, 0) 42%, rgba(24, 10, 48, 0.28) 100%);
    pointer-events: none;
  }

  /* Scaled coordinate space. The board is laid out at a fixed design size and
     this node scales it to the viewport, so a large monitor gets a bigger table
     and bigger cards rather than the same table adrift in background.
     `transform-origin: 0 0` keeps the space's origin on the element's origin,
     which is what every pixel coordinate in layout.ts assumes. */
  .stage {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }

  .fadeIn {
    position: absolute;
    inset: 0;
    animation: boardFadeIn 0.35s var(--ease-out) both;
  }

  @keyframes boardFadeIn {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* ─── The table ───────────────────────────────────────────────────────────
     A felt inside a rim, standing on a plinth. Every room hands the same object
     its own materials (`--tbl-*`, from `maps.ts`), and the hour hands it a tint
     for the sheen and a dimming for the whole; without a scene the tokens'
     near-black table is what the variables fall back to.

     It obeys the three rules every raised object here obeys: an ink outline on
     both sides of the rim, a hard bottom edge (the `0 16px 0` shadow is the
     rim's thickness, seen from above and in front), and a soft shadow that is
     ambience, never structure. The inlay is the one line of the room's accent
     set into the rim: a neon tube, a brass bead, a rune groove. */
  .tableOval {
    position: absolute;
    border-radius: 50%;
    --felt-1: color-mix(in srgb, var(--tbl-felt, var(--table-felt-1)), #000 calc(var(--scene-dark, 1) * 22%));
    --felt-2: color-mix(in srgb, var(--tbl-felt-deep, var(--table-felt-2)), #000 calc(var(--scene-dark, 1) * 22%));
    background:
      radial-gradient(60% 58% at 50% 28%, color-mix(in srgb, var(--scene-tint, #ffffff) 16%, transparent) 0%, rgba(0, 0, 0, 0) 68%),
      radial-gradient(58% 58% at 50% 34%, color-mix(in srgb, var(--tbl-rim-light, var(--table-rim-light)) 14%, transparent) 0%, rgba(0, 0, 0, 0) 62%),
      linear-gradient(170deg, var(--felt-1) 0%, var(--felt-2) 68%);
    border: 11px solid color-mix(in srgb, var(--tbl-rim, var(--table-rim)), #000 calc(var(--scene-dark, 1) * 18%));
    box-shadow:
      /* the inlay, then the ink line inside the rim */
      inset 0 0 0 2px color-mix(in srgb, var(--tbl-inlay, var(--table-rim-light)) 70%, transparent),
      inset 0 0 0 4px rgba(6, 3, 16, 0.4),
      inset 0 8px 24px color-mix(in srgb, var(--scene-tint, #ffffff) 10%, transparent),
      inset 0 -20px 36px rgba(0, 0, 0, 0.36),
      /* ink outline outside, the sheen on the rim's top edge, the rim's thickness, the ink under that */
      0 0 0 2px rgba(6, 3, 16, 0.55),
      0 -2px 0 2px color-mix(in srgb, var(--tbl-rim-light, var(--table-rim-light)) 45%, transparent),
      0 16px 0 var(--tbl-base, var(--table-rim)),
      0 16px 0 2px rgba(6, 3, 16, 0.55),
      /* the cast shadow lies the way the room's sun lays every other one */
      calc(var(--sun-dx, 0) * 22px) calc(16px + var(--sun-dy, 0.7) * 24px) 44px
        rgba(6, 3, 16, calc(0.35 + var(--scene-dark, 1) * 0.15));
    pointer-events: none;
    overflow: hidden;
  }

  /* The plinth: what the table stands on, drawn under it. Its top is hidden by
     the felt; what shows is the column and the foot, which is what tells the eye
     this is an object standing in the room and not a decal on its floor. */
  .tablePlinth {
    position: absolute;
    border-radius: 50% 50% 46% 46% / 30% 30% 50% 50%;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--tbl-base, var(--table-rim)), #000 10%) 0%,
      color-mix(in srgb, var(--tbl-base, var(--table-rim)), #000 40%) 100%
    );
    box-shadow:
      inset 0 0 0 2px rgba(6, 3, 16, 0.55),
      inset 16px 0 30px rgba(255, 255, 255, 0.05),
      inset -16px 0 30px rgba(0, 0, 0, 0.35),
      0 10px 0 color-mix(in srgb, var(--tbl-base, var(--table-rim)), #000 55%),
      0 10px 0 2px rgba(6, 3, 16, 0.55),
      0 26px 40px rgba(6, 3, 16, 0.4);
    pointer-events: none;
  }

  /* The mark, branded into the felt the way a casino brands its baize. Kept at
     the threshold of visible: the piles sit on top of it, and a table that
     competes with the card being played is a table that has to be looked past. */
  .tableMark {
    position: absolute;
    left: 50%;
    top: 50%;
    /* Sized to fit *inside* the ellipse, not inside its bounding box. The felt
       clips its overflow, so a mark scaled to the box has its corners sliced off
       and reads as a broken drawing rather than a watermark. The mark is
       landscape, and the felt is a *flat* oval (roughly 2.7:1), so even a
       landscape mark is bound by height, not width: at 62% of the height it is
       only ~28% of the width and sits comfortably inside the curve. Driving it off
       the width put the mark half outside the ellipse and sliced it into
       fragments. */
    height: 58%;
    width: auto;
    /* Belt and braces: an absolutely-positioned <svg> with one axis auto does not
       reliably take its intrinsic ratio, and a mark stretched to the felt is the
       bug this whole file exists to avoid. */
    aspect-ratio: 712 / 576;
    transform: translate(-50%, -50%);
    opacity: 0.07;
    pointer-events: none;
  }

  /* Woven felt texture — very low contrast, only there to kill the flat plastic
     look at large sizes. */
  .tableOval::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background:
      repeating-linear-gradient(
        45deg,
        rgba(255, 255, 255, 0.035) 0 2px,
        rgba(0, 0, 0, 0) 2px 4px
      ),
      repeating-linear-gradient(-45deg, rgba(0, 0, 0, 0.03) 0 2px, rgba(0, 0, 0, 0) 2px 4px);
    pointer-events: none;
  }
</style>
