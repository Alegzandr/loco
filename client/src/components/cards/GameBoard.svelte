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
  import PlayerSlot, { type FanHold, type FanJolt } from './PlayerSlot.svelte'
  import TurnIndicator, { type TurnTexts } from './TurnIndicator.svelte'
  import DirectionRing from './DirectionRing.svelte'
  import TableTrack from './TableTrack.svelte'
  import { rimSurface, tableCssVars } from './tableSurface'
  import AnimationLayer, { type Flier, type EffectText, type Impact } from './AnimationLayer.svelte'
  import {
    clockwiseOpponents,
    calcHandSlots,
    discardPosition,
    deckPosition,
    PILE_SQUASH,
    seatPosition,
    handSpots,
    fanExtent,
    tableRect,
    seatLayout,
    type CardSpot,
    boardScale,
    boardSpace,
    isLandscape,
    feltSquash,
    pileCentre,
    shoutLine,
  } from './layout'
  import type { SceneSpec } from './maps'
  import type { FeltAnchor } from './layout'
  import { lightRig, rigCssVars, hexCss, mix } from '../scene/sky'
  import SceneBackdrop from '../scene/SceneBackdrop.svelte'
  import {
    ACTIVE_RING,
    CARD_W,
    CARD_H,
    CARD_RADIUS,
    handCard,
    handScale,
    DEAL_FLIGHT_MS,
    SEAT_SPECS,
    dealStagger,
    flightFor,
  } from './cardTheme'
  import { LOCO_MARK_PATH, LOCO_MARK_VIEWBOX } from './locoMark'
  import type { SwapNotice, LastPlay, LastDraw, CatchFlash } from '../../hooks/gameStore'
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
    /** Last hand that grew; drives the deck→hand flights, into the exact places. */
    lastDraw: LastDraw | null
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

  // A hand passed across the table (a Swap, a GlobalSwitch): how many of its
  // backs are seen travelling at most, and how long each takes. Enough that it
  // reads as the hand going over, few enough that ten seats passing at once
  // stay a picture and not a blizzard.
  const PASS_CARDS_MAX = 12
  const PASS_MS = 620
  const PASS_STAGGER_MS = 22
  // How far a passed hand bows off the straight line, px. The same sign on
  // both hands of a Swap is what makes them pass on opposite sides: each bows
  // to its own right.
  const PASS_CURVE = 90

  // One card drawn off the deck into a hand.
  const DRAW_MS = 340
  const DRAW_STAGGER_MS = 90

  // Penalty cards flown to a caught seat: higher, slower and further apart
  // than a draw, because this one is the point of the moment.
  const CATCH_CARD_MS = 460
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

  // A phone on its side gets another composition (see `layout.ts`), decided
  // here from the element's pixel size and handed to every layout call below:
  // the virtual space cannot tell the two apart on its own.
  const landscape = $derived(isLandscape(size.current.width, size.current.height))
  // Everything below works in the board's own coordinate space; <div .stage>
  // scales that space to the element's pixel size. Children — and the pure layout
  // maths they share with the animations — never see the scale.
  const scale = $derived(
    boardScale(
      size.current.width - insets.current.left - insets.current.right,
      size.current.height - insets.current.top - insets.current.bottom,
      landscape,
    ),
  )
  const space = $derived(
    boardSpace(size.current.width, size.current.height, scale, insets.current, landscape),
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
  let wasReconnecting = untrack(() => p.isReconnecting)

  // The room is painted by this element, but the browser paints anything the page
  // itself does not own with the *root* element's colour: a safe area on a notched
  // phone, the strip a floating browser bar reserves. The app's candy gradient
  // there reads as two bright bands laid across a room, so while a scene is up
  // the root is pinned to the scene's own horizon and a band we never get to
  // draw in still looks like the sky.
  const mapId = $derived(p.scene?.map.id ?? '')
  const rig = $derived(p.scene ? lightRig(p.scene.time, p.scene.weather, p.scene.map.id) : null)
  // The horizon, taken well down towards the void. A noon sky is a near-white,
  // and a band of it across the top of a phone in dark mode is the brightest
  // thing on the screen — the opposite of what this property is for. Mixed
  // down it is still the room's own sky rather than a neutral black.
  const horizon = $derived(rig ? hexCss(mix(rig.sky.horizon, 0x07060f, 0.72)) : '')
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
      ...tableCssVars(m.table),
      rigCssVars(rig),
    ].join('; ')
  })

  // The rim's wood again, for the racetrack the play direction is inlaid in:
  // the same image the rim is drawn with, so the two are one piece of wood.
  const trackWood = $derived(p.scene ? rimSurface(p.scene.map.table) : null)
  /**
   * Whether the room's frame carries the table under the felt as it stands now
   * (`SceneBackdrop`'s `tableDrawn`). While it does, the render is the table —
   * cloth, racetrack and rail in the room's own light, the rail's shadow on the
   * cloth — and the CSS draws none of it; until then, and whenever the frame is
   * out of step with the felt, the CSS table stands in.
   */
  let tableRendered = $state(false)

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
  const seats = $derived(seatLayout(ready ? others.length : 0, width, height, landscape))
  // Every pile/animation coordinate needs the same seat reserve the felt uses,
  // otherwise the deck, the discard and the fliers drift apart from the table.
  const topReserve = $derived(seats.blockHeight)

  // Where the three shouts land (LOCO!, the interception, the catch stamp), in
  // screen pixels, for the overlays in `GameView` that cannot see the board's
  // space: the free band either side of the piles (`shoutLine`). A fixed height
  // above the piles sat on the hand of whoever faces us.
  const shoutY = $derived(
    ready ? space.offsetY + shoutLine(width, height, seats.seats, topReserve, landscape) * scale : 0,
  )
  $effect(() => {
    const root = document.documentElement
    if (!shoutY) return
    root.style.setProperty('--shout-y', `${Math.round(shoutY)}px`)
    return () => root.style.removeProperty('--shout-y')
  })

  // ─── Hands, and the holds that keep a card out of one until it lands ─────
  // Every hand at the table is drawn card for card, so a card on its way to a
  // hand must not already be sitting in it: the board launches the fliers and,
  // in the same breath, tells the seat which of its backs to keep hidden and
  // for how long (`FanHold`). Written without reading, like the fliers.
  let holds = $state<Record<number, FanHold>>({})
  let jolts = $state<Record<number, FanJolt>>({})
  function holdSeat(seat: number, delays: Record<number, number>, at: number) {
    holds = { ...untrack(() => holds), [seat]: { at, delays } }
  }
  function joltSeat(seat: number, delay: number) {
    jolts = { ...untrack(() => jolts), [seat]: { at: Date.now(), delay } }
  }

  /** How big the hand of `seat` is right now, ours included. */
  function sizeOf(seat: number): number {
    if (seat === p.myIndex) return p.myHand.length
    return p.players.find((q) => q.index === seat)?.hand_size ?? 0
  }

  /** The places of a hand of `size` at `seat`, in board coordinates. */
  function spotsOf(seat: number, size: number): CardSpot[] {
    return handSpots(seat, size, p.players, p.myIndex, width, height, landscape)
  }

  /** The deck's top card, as a spot. */
  function deckSpot(): CardSpot {
    const d = deckPosition(width, height, topReserve, landscape)
    return { x: d.x + CARD_W / 2, y: d.y + CARD_H / 2, rotation: 0, w: CARD_W, h: CARD_H, squash: PILE_SQUASH }
  }

  /**
   * A back flown from one spot to another, arriving at the size the target
   * holds it and leaving at the size the source did — a hand card shrinking
   * into an opponent's fan, a back swelling into ours.
   */
  function backFlight(
    from: CardSpot,
    to: CardSpot,
    o: { duration: number; delayMs: number; arcHeight: number; startAlpha?: number },
  ): Flier {
    return {
      id: newId(),
      kind: 'back',
      from: { x: from.x - to.w / 2, y: from.y - to.h / 2, rotation: from.rotation, squash: from.squash },
      to: { x: to.x - to.w / 2, y: to.y - to.h / 2, rotation: to.rotation, squash: to.squash },
      size: { w: to.w, h: to.h, r: to.w >= CARD_W ? CARD_RADIUS : 3 },
      startScale: from.w / to.w,
      startAlpha: o.startAlpha ?? 1,
      duration: o.duration,
      delayMs: o.delayMs,
      arcHeight: o.arcHeight,
    }
  }

  // ─── Animation effect: an opponent played a card ─────────────────────────
  // The card comes out of their hand: it leaves the middle of the fan face
  // down, at the size the fan holds it, and turns over on its way to the pile,
  // so the play is legible without watching the pile and the hand is seen to
  // give it up. Declared before the discard-change effect so it can claim the
  // update and suppress the generic pile flier.
  let lastPlayAt = untrack(() => p.lastPlay?.at ?? 0)
  $effect(() => {
    // Keyed on the play timestamp: one flight per play, never a replay on resize.
    p.lastPlay?.at
    const lp = p.lastPlay
    if (!ready || !lp || lp.at === lastPlayAt) return
    lastPlayAt = lp.at
    // Own plays already fly out of the hand via handleCardClick.
    if (lp.actorIndex === p.myIndex) return
    // The fan as it stood with the card still in it.
    const before = untrack(() => spotsOf(lp.actorIndex, sizeOf(lp.actorIndex) + 1))
    const seat = seatPosition(lp.actorIndex, p.players, p.myIndex, width, height, landscape)
    const src: CardSpot = before[Math.floor(before.length / 2)] ?? {
      x: seat.x,
      y: seat.y,
      rotation: 0,
      w: CARD_W * 0.4,
      h: CARD_H * 0.4,
    }
    const dest = discardPosition(width, height, topReserve, landscape)
    const flight = flightFor(lp.card)
    addFliers(
      {
        id: newId(),
        kind: 'face',
        card: lp.card,
        flip: true,
        // Spots are centres; fliers are positioned by corner.
        from: { x: src.x - CARD_W / 2, y: src.y - CARD_H / 2, rotation: src.rotation, squash: src.squash },
        to: { x: dest.x, y: dest.y, rotation: 0, squash: PILE_SQUASH },
        startScale: src.w / CARD_W,
        duration: flight.duration + 80,
        arcHeight: flight.arcHeight + 26,
        spin: flight.spin,
        swell: Math.max(flight.swell, 1.12),
      },
    )
    landCard(lp.card, dest, flight.duration + 80)
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
      const target = discardPosition(width, height, topReserve, landscape)
      const flight = flightFor(card)
      addFliers(
        {
          id: newId(),
          kind: 'face',
          card,
          from: { x: target.x, y: target.y + CARD_H / 2 },
          to: { x: target.x, y: target.y, squash: PILE_SQUASH },
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
          y: discardPosition(width, height, topReserve, landscape).y - 10,
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
        y: discardPosition(width, height, topReserve, landscape).y - 10,
        delayMs: (disc ? flightFor(disc).duration : 0) + COLOR_CALLOUT_DELAY_MS,
      },
    )
  })

  // ─── Animation effect: the deal ─────────────────────────────────────────
  // The whole table is dealt, the way a table is: one card to each seat in
  // turn, starting with the next player and ending with us, round after round,
  // every card landing where its hand will hold it. Keyed on the round so a
  // reload mid-round rebuilds the hands quietly and only a fresh deal flies.
  let dealtFor = untrack(() => p.roundNumber ?? -1)
  let dealtOnce = untrack(() => p.myHand.length > 0)
  /** The pace our own Hand reveals its cards at, matched to the fliers below. */
  let dealPace = $state({ step: 0, offset: 0 })
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
    untrack(() => {
      const order = [...others.map((o) => o.index), p.myIndex]
      const sizes = order.map(sizeOf)
      const stagger = dealStagger(sizes.reduce((a, b) => a + b, 0))
      const ring = order.length
      dealPace = { step: stagger * ring, offset: stagger * (ring - 1) }
      const deck = deckSpot()
      const now = Date.now()
      const flights: Flier[] = []
      order.forEach((seat, j) => {
        const spots = spotsOf(seat, sizes[j])
        const delays: Record<number, number> = {}
        spots.forEach((to, k) => {
          const delayMs = (k * ring + j) * stagger
          const f = backFlight(deck, to, { duration: DEAL_FLIGHT_MS, delayMs, arcHeight: 14, startAlpha: 0.85 })
          // Ours turn face up on the way and land face up.
          const card = seat === p.myIndex ? p.myHand[k] : undefined
          flights.push(card ? { ...f, kind: 'face', card, flip: true } : f)
          delays[k] = delayMs + DEAL_FLIGHT_MS
        })
        if (seat !== p.myIndex) holdSeat(seat, delays, now)
      })
      addFliers(...flights)
    })
  })

  // ─── Animation effect: a hand grew ──────────────────────────────────────
  // Every card drawn is seen leaving the deck and landing in its place in the
  // hand that drew it — ours, or the exact backs of an opponent's fan, which
  // stay hidden until their card arrives. Ours turn over on the way, since we
  // are allowed to see them. The cards a Contre-LOCO! charged fly higher and
  // slower, and the hand takes the knock when they land.
  let lastDrawAt = untrack(() => p.lastDraw?.at ?? 0)
  $effect(() => {
    p.lastDraw?.at
    const d = p.lastDraw
    if (!ready || !d || d.at === lastDrawAt) return
    lastDrawAt = d.at
    if (prefersReducedMotion()) return
    untrack(() => {
      const size = sizeOf(d.seat)
      const spots = spotsOf(d.seat, size)
      // The newest cards are the last places of the fan. A fan already drawn in
      // full takes them into its last places all the same: the hand is seen to
      // take them, and the count on the plate says how many it holds.
      const targets = spots.slice(Math.max(0, spots.length - d.count))
      const first = spots.length - targets.length
      const ms = d.penalty ? CATCH_CARD_MS : DRAW_MS
      const gap = d.penalty ? CATCH_CARD_STAGGER_MS : DRAW_STAGGER_MS
      const deck = deckSpot()
      const now = Date.now()
      const mine = d.seat === p.myIndex
      const delays: Record<number, number> = {}
      const flights = targets.map((to, i): Flier => {
        delays[first + i] = i * gap + ms
        const back = backFlight(deck, to, {
          duration: ms,
          delayMs: i * gap,
          arcHeight: d.penalty ? 56 : 22,
          startAlpha: 0.4,
        })
        if (!mine) return back
        const card = p.myHand[first + i]
        return card
          ? { ...back, kind: 'face', card, flip: true }
          : back
      })
      addFliers(...flights)
      if (!mine) holdSeat(d.seat, delays, now)
      if (d.penalty) joltSeat(d.seat, ms + (targets.length - 1) * gap)
    })
  })

  // ─── Animation effect: swap / global_switch notice ──────────────────────
  // A hand passed is a hand seen crossing the table. Every card of it leaves
  // the place it held in the giver's hand, the hand travels as one packet, and
  // it fans out into the receiver's places. The two hands of a Swap bow to
  // opposite sides so they are seen to pass each other rather than fly down
  // the same line through each other; a GlobalSwitch sends every hand one seat
  // along the ring. Between two other seats a hand travels face down. **Our
  // own cards are face up in our hand and nowhere else**: ours going out turn
  // face down on the way, and the cards coming to us turn face up on the way
  // and land face up — landing as backs and then turning into faces read as
  // the hand being dealt a second time. The hands that receive are held empty
  // until their cards land, ours included.
  //
  // The counts are the server's roster, never `myHand`: the notice rides
  // `card_played`, and the snapshot carrying our new hand is a message behind
  // it, so at this instant `myHand` is still the hand we are giving away.
  //
  // Guarded on the timestamp like the effects above, and for a reason that
  // is not stylistic: the notice stays in the store for the 3.5s it is on screen,
  // and reading a prop is not a dependency on that prop's *value* — any of the
  // dozen props this board takes moving re-runs this. So every message that
  // arrived while a Swap was announced drew the trails again, and a resize drew
  // them once per frame.
  // Our own hand's hold, card by card like an opponent's (`FanHold`).
  let myHold = $state<FanHold | null>(null)
  // Cards on their way to us whose faces the server has not named yet: the
  // snapshot with our new hand is a message behind the play. They take off
  // the moment it lands (the effect below), or as backs if it never does.
  type Incoming = { flights: { f: Flier; k: number }[]; at: number; given: CardDTO[] }
  let incoming: Incoming | null = null
  const INCOMING_WAIT_MS = 400
  function launchIncoming(hand: CardDTO[] | null) {
    const pend = incoming
    if (!pend) return
    incoming = null
    const flights = pend.flights.map(({ f, k }): Flier => {
      const card = hand?.[k]
      return card ? { ...f, kind: 'face', card, flip: true } : f
    })
    addFliers(...flights)
    // Each card comes up as its own flier lands; one nobody flew to (a hand
    // larger than the packet) with the last of them.
    const delays: Record<number, number> = {}
    const last = Math.max(...flights.map((f) => (f.delayMs ?? 0) + (f.duration ?? 0)))
    const size = Math.max(hand?.length ?? 0, ...pend.flights.map(({ k }) => k + 1))
    for (let k = 0; k < size; k++) delays[k] = last
    pend.flights.forEach(({ f, k }) => (delays[k] = (f.delayMs ?? 0) + (f.duration ?? 0)))
    // A fresh stamp even inside the same millisecond: the stamp is what re-arms it.
    myHold = { at: Math.max(Date.now(), (untrack(() => myHold)?.at ?? 0) + 1), delays }
  }
  $effect(() => {
    const hand = p.myHand
    if (!incoming || hand === incoming.given) return
    untrack(() => launchIncoming(hand))
  })
  $effect(() => () => {
    incoming = null
  })

  let lastSwapAt = untrack(() => p.swapNotice?.at ?? 0)
  $effect(() => {
    p.swapNotice?.at
    const sn = p.swapNotice
    if (!ready || !sn || sn.at === lastSwapAt) return
    lastSwapAt = sn.at
    if (prefersReducedMotion()) return
    untrack(() => {
      const now = Date.now()
      const flights: Flier[] = []
      const given = sn.givenHand ?? p.myHand
      // Already here if the snapshot landed in the same frame as the play.
      const received = p.myHand !== given ? p.myHand : null
      const toMe: { f: Flier; k: number }[] = []
      const count = (seat: number) => p.players.find((q) => q.index === seat)?.hand_size ?? 0
      // The hand of `from` goes to `to`: it has as many cards as `to` holds now.
      const pass = (from: number, to: number, curve: number, delay0: number, most: number) => {
        const n = count(to)
        const src = from === p.myIndex ? spotsOf(from, given.length) : spotsOf(from, n)
        const dst = spotsOf(to, n)
        const m = Math.min(src.length, dst.length)
        if (m === 0) return
        const picks = m <= most ? [...Array(m).keys()] : [...Array(most).keys()].map((k) => Math.round((k * (m - 1)) / (most - 1)))
        const land = delay0 + (picks.length - 1) * PASS_STAGGER_MS + PASS_MS
        const delays: Record<number, number> = {}
        for (let k = 0; k < dst.length; k++) delays[k] = land
        picks.forEach((k, i) => {
          const delayMs = delay0 + i * PASS_STAGGER_MS
          const f = backFlight(src[k], dst[k], { duration: PASS_MS, delayMs, arcHeight: 0 })
          f.curve = curve
          f.swell = 1.12
          delays[k] = delayMs + PASS_MS
          // Ours leave face up and turn face down on the way.
          if (from === p.myIndex && given[k]) {
            f.card = given[k]
            f.flip = true
          }
          if (to === p.myIndex) toMe.push({ f, k })
          else flights.push(f)
        })
        if (to === p.myIndex) {
          // Nothing flies to us before the snapshot names the cards, so until
          // then the whole hand is held; `launchIncoming` re-arms it card by card.
          for (let k = 0; k < Math.max(given.length, dst.length); k++) delays[k] = land
          myHold = { at: now, delays }
        } else holdSeat(to, delays, now)
      }
      if (sn.kind === 'swap' && sn.targetIndex >= 0) {
        pass(sn.actorIndex, sn.targetIndex, PASS_CURVE, 0, PASS_CARDS_MAX)
        pass(sn.targetIndex, sn.actorIndex, PASS_CURVE, 0, PASS_CARDS_MAX)
      } else if (sn.kind === 'global_switch') {
        const ordered = [...p.players].sort((q, r) => q.index - r.index)
        const step = sn.direction >= 0 ? 1 : ordered.length - 1
        const most = ordered.length > 6 ? 4 : 6
        for (let i = 0; i < ordered.length; i++) {
          const fromIdx = ordered[i].index
          const toIdx = ordered[(i + step) % ordered.length].index
          if (fromIdx === toIdx) continue
          // Every hand bows the same way round, so the ring is seen turning.
          pass(fromIdx, toIdx, PASS_CURVE * 0.6, 0, most)
        }
      }
      addFliers(...flights)
      if (toMe.length > 0) {
        incoming = { flights: toMe, at: now, given }
        if (received) launchIncoming(received)
        else
          window.setTimeout(() => {
            if (incoming?.at === now) launchIncoming(null)
          }, INCOMING_WAIT_MS)
      }
    })
  })

  // ─── Animation effect: a Contre-LOCO! landed ────────────────────────────
  // The penalty cards themselves arrive through the ordinary card_drawn, and
  // the draw effect above flies them — as a penalty, because the store marks
  // a hand that grew straight after its catch. What is left here is the news:
  // a red +N over the caught seat, announcing the cards' landing rather than
  // the message that carried it. Without it the whole mechanic is invisible:
  // the caught hand grows the way it grows on any ordinary draw.
  // Same guard as the swap, same reason: the flash outlives the message.
  let lastCatchAt = untrack(() => p.catchFlash?.at ?? 0)
  $effect(() => {
    p.catchFlash?.at
    const cf = p.catchFlash
    if (!ready || !cf || cf.at === lastCatchAt) return
    lastCatchAt = cf.at
    const seat = seatPosition(cf.seat, p.players, p.myIndex, width, height, landscape)
    // Just above the hand, not across its plate: the callout drifts upward as
    // it plays, and a seat whose name is covered by its own penalty is a seat
    // nobody can identify at the moment it matters most.
    const place = untrack(() => others.findIndex((o) => o.index === cf.seat))
    const s = place >= 0 ? seats.seats[place] : null
    const fan = s ? fanExtent(s.size, Math.max(1, untrack(() => sizeOf(cf.seat))), s.lay) : null
    const y = s ? Math.min(s.y + (fan?.top ?? 0), s.y + s.plate.y - SEAT_SPECS[s.size].plateH / 2) - 8 : seat.y - CARD_H / 2
    addEffects(
      {
        id: newId(),
        text: `+${CATCH_PENALTY_CARDS}`,
        color: '#e63946',
        x: seat.x,
        y,
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
    const slots = calcHandSlots(p.myHand.length, width, height, landscape)
    const slot = slots[idx]
    if (!slot) return
    const dest = discardPosition(width, height, topReserve, landscape)
    // The lift applied to playable cards in <Hand /> shifts them up by 9px at
    // rest; mirror it so the fly starts at the visually correct spot.
    const liftedY = p.isPlayable(card) ? slot.y - 9 : slot.y
    const flight = flightFor(card)
    addFliers(
      {
        id: newId(),
        kind: 'face',
        card,
        // The slot is the card as our hand draws it, larger than the pile's:
        // the flier leaves from its centre at that size and shrinks onto it.
        from: {
          x: slot.x + handCard(landscape).w / 2 - CARD_W / 2,
          y: liftedY + handCard(landscape).h / 2 - CARD_H / 2,
          rotation: slot.rotation,
        },
        to: { x: dest.x, y: dest.y, rotation: 0, squash: PILE_SQUASH },
        startScale: handScale(landscape),
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
    landscape
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
  const table = $derived(tableRect(width, height, topReserve, landscape))
  // The table's depth as the chair sees it: every width measured on the table
  // is drawn in its plane and squashed by this (`feltSquash`).
  const feltK = $derived(feltSquash(table.width, table.height))
</script>

<div
  bind:this={boardEl}
  class="board"
  data-testid="game-board"
  data-map={mapId}
  class:inRoom={!!p.scene}
  data-scene-time={p.scene?.time ?? ''}
  data-scene-weather={p.scene?.weather ?? ''}
  style={boardStyle}
>
  {#if p.scene}
    <!-- The room, rendered once, sharp: its podium is under the felt to the
         pixel, so the table stands in it rather than in front of it. -->
    <SceneBackdrop scene={p.scene} anchor={p.anchor} bind:tableDrawn={tableRendered} />
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
            class:rendered={tableRendered && !!p.scene}
            data-testid="table"
            style="left: {table.left}px; top: {table.top}px; width: {table.width}px; height: {table.height}px; --felt-k: {feltK}"
          >
            <svg class="tableMark" viewBox={LOCO_MARK_VIEWBOX} aria-hidden="true" focusable="false">
              <path d={LOCO_MARK_PATH} fill-rule="evenodd" fill="#ffffff" />
            </svg>
          </div>
          <!-- The racetrack round the inside of the rim: part of the table. -->
          {#if !(tableRendered && p.scene)}
            <TableTrack rect={table} wood={trackWood} />
          {/if}
          <!-- Keyed on the direction so a Reverse remounts the ring and replays its
               turn: the change of heading is the event. -->
          {#key p.direction >= 0 ? 'cw' : 'ccw'}
            <DirectionRing
              centre={pileCentre(width, height, topReserve, landscape)}
              direction={p.direction}
              label={p.directionLabel}
            />
          {/key}
          <Deck
            {landscape}
            {width}
            {height}
            {topReserve}
            canDraw={p.canDraw}
            onDraw={p.onDraw}
            drawLabel={p.drawLabel}
          />
          <DiscardPile
            {landscape}
            card={p.discard}
            playStamp={p.lastPlay?.at ?? 0}
            activeColor={p.activeColor}
            pendingDraw={p.pendingDraw}
            {width}
            {height}
            {topReserve}
          />
          <TurnIndicator
            {width}
            {topReserve}
            {landscape}
            isMyTurn={p.currentTurn === p.myIndex}
            pendingDraw={p.pendingDraw}
            canCounter={p.canCounter}
            currentTurn={p.currentTurn}
            players={p.players}
            {height}
            texts={p.turnTexts}
            onDraw={p.onDraw}
          />
          {#each others as o, i (o.index)}
            {#if seats.seats[i]}
              <PlayerSlot
                nickname={o.nickname}
                handSize={o.hand_size}
                isActiveTurn={o.index === p.currentTurn}
                isDisconnected={o.connected === false}
                seat={seats.seats[i]}
                hold={holds[o.index] ?? null}
                jolt={jolts[o.index] ?? null}
              />
            {/if}
          {/each}
          <Hand
            {landscape}
            hand={p.myHand}
            roundNumber={p.roundNumber}
            {width}
            {height}
            isPlayable={p.isPlayable}
            isInteractive={p.isInteractive}
            onCardClick={handleCardClick}
            dealStep={dealPace.step || undefined}
            dealOffset={dealPace.offset}
            hold={myHold}
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
     A felt inside a rim, both of a room's own materials (`--tbl-*`, from
     `maps.ts` through `tableSurface.ts`), and the hour hands it a tint for the
     sheen and a dimming for the whole; without a scene the tokens' near-black
     table is what the variables fall back to.

     One element, two surfaces: the felt is every layer clipped to the padding
     box, the rim every layer clipped to the border box (the transparent
     border is the rim). Each is lit the same way, back to front: its colour,
     the rim's grain (a seeded noise image of the material, `--tbl-rim-tex`;
     the felt has none, by choice), the hour's dimming, then the light — a broad sheen
     and, on a glossy rim, the room's lights caught in the finish
     (`--tbl-rim-gloss`).

     The edge is a darker note of the rim's own colour, never the interface's
     ink: the table stands in a rendered room, and there the outline rule
     bends the way it bends for every block (`kit.ts: inkFor`). */
  .tableOval {
    position: absolute;
    border-radius: 50%;
    --rim-dim: rgba(0, 0, 0, calc(var(--scene-dark, 1) * 0.18));
    --felt-1: color-mix(in srgb, var(--tbl-felt, var(--table-felt-1)), #000 calc(var(--scene-dark, 1) * 22%));
    --felt-2: color-mix(in srgb, var(--tbl-felt-deep, var(--table-felt-2)), #000 calc(var(--scene-dark, 1) * 22%));
    --rim-color: var(--tbl-rim, var(--table-rim));
    /* The rim is 11px all the way round: its inner edge is the felt's ellipse
       taken in by the same amount on both axes, the kind of oval every line
       round the table is (`tableTrackEllipse`). */
    border: 11px solid transparent;
    background:
      /* the felt: the light, the cloth (no texture: its colour is the cloth) */
      radial-gradient(60% 58% at 50% 28%, color-mix(in srgb, var(--scene-tint, #ffffff) 16%, transparent) 0%, rgba(0, 0, 0, 0) 68%) padding-box,
      radial-gradient(58% 58% at 50% 34%, color-mix(in srgb, var(--tbl-rim-light, var(--table-rim-light)) 10%, transparent) 0%, rgba(0, 0, 0, 0) 62%) padding-box,
      linear-gradient(170deg, var(--felt-1) 0%, var(--felt-2) 68%) padding-box,
      /* the rim: its reflections, the hour, the grain, the material */
      var(--tbl-rim-gloss, none),
      linear-gradient(var(--rim-dim), var(--rim-dim)) border-box,
      var(--tbl-rim-tex, none) center / 540px 180px repeat border-box,
      linear-gradient(var(--rim-color), var(--rim-color)) border-box;
    box-shadow:
      /* the rim's lip shading the felt, and the light falling off towards the
         near side (the metal bead at the cloth's edge is the racetrack's filet) */
      inset calc(var(--sun-dx, 0) * -3px) calc(var(--sun-dy, 0.7) * -3px + 3px) 6px rgba(0, 0, 0, 0.45),
      inset 0 8px 24px color-mix(in srgb, var(--scene-tint, #ffffff) 10%, transparent),
      inset 0 -20px 36px rgba(0, 0, 0, 0.36),
      /* the rim's outer edge, in its own darker note */
      0 0 0 1.5px color-mix(in srgb, var(--rim-color), #000 65%);
    pointer-events: none;
  }

  /* The rim's section: a rounded edge rolling away from the light. The far
     side's outer lip catches it, the near side turns down into its own shade.
     Inset shadows on a box the size of the rim's outer edge, kept inside the
     rim's width so none of it lands on the cloth. */
  .tableOval::before {
    content: '';
    position: absolute;
    inset: -11px;
    border-radius: 50%;
    box-shadow:
      inset 0 2px 1px -1px color-mix(in srgb, var(--scene-tint, #ffffff) 55%, transparent),
      inset 0 -3px 3px -1px rgba(0, 0, 0, 0.5),
      inset 0 0 0 1px rgba(255, 255, 255, 0.06);
    pointer-events: none;
  }

  /* Without a room the CSS carries the whole object: the rim's thickness as a
     hard edge under it, the ink under that, and a soft shadow on the floor.
     In a room the render carries the edge (`vistaTable`: a profile swept
     round the felt, in the rim's material) and its real shadow, and a flat
     band drawn over it would hide the one thing the render adds. */
  .board:not(.inRoom) .tableOval {
    box-shadow:
      inset 0 0 0 1.5px var(--table-rim-light),
      inset 0 0 0 4px rgba(6, 3, 16, 0.4),
      inset 0 8px 24px rgba(255, 255, 255, 0.1),
      inset 0 -20px 36px rgba(0, 0, 0, 0.36),
      0 0 0 2px rgba(6, 3, 16, 0.55),
      0 -2px 0 2px color-mix(in srgb, var(--table-rim-light) 45%, transparent),
      0 16px 0 var(--table-rim),
      0 16px 0 2px rgba(6, 3, 16, 0.55),
      0 30px 44px rgba(6, 3, 16, 0.4);
  }

  /* The render carries the table: nothing of the CSS one is drawn but the
     mark branded into the cloth. */
  .board.inRoom .tableOval.rendered {
    border-color: transparent;
    background: none;
    box-shadow: none;
  }

  .board.inRoom .tableOval.rendered::before {
    content: none;
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
    /* It lies on the cloth, so it is foreshortened with it (`--felt-k`): sized
       on the table, a third of its width, then squashed like the rim. */
    width: 34%;
    height: auto;
    /* Belt and braces: an absolutely-positioned <svg> with one axis auto does not
       reliably take its intrinsic ratio, and a mark stretched to the felt is the
       bug this whole file exists to avoid. */
    aspect-ratio: 712 / 576;
    transform: translate(-50%, -50%) scaleY(var(--felt-k, 1));
    opacity: 0.07;
    pointer-events: none;
  }
</style>
