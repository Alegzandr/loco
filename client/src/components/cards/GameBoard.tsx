import { memo, useEffect, useRef, useState, MutableRefObject } from 'react'
import { CardDTO, CardColor, PlayerDTO } from '../../types/protocol'
import { useElementSize } from '../../hooks/useElementSize'
import { Deck } from './Deck'
import { DiscardPile } from './DiscardPile'
import { Hand } from './Hand'
import { PlayerSlot } from './PlayerSlot'
import { TurnIndicator, TurnTexts } from './TurnIndicator'
import { DirectionRing } from './DirectionRing'
import { AnimationLayer, Flier, EffectText, Impact } from './AnimationLayer'
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
import { ACTIVE_RING, CARD_W, CARD_H, flightFor } from './cardTheme'
import { LOCO_MARK_PATH, LOCO_MARK_VIEWBOX } from './locoMark'
import { SwapNotice, LastPlay } from '../../hooks/useGameStore'
import styles from './GameBoard.module.css'

interface Props {
  myHand: CardDTO[]
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
   * whether a play was sent. The board animates only on `true`: a tap the
   * client refuses, or one that merely opens the colour/player prompt, must not
   * throw the card at the pile and then have it reappear in the fan.
   */
  onCardClick: (card: CardDTO, idx: number) => boolean
  /**
   * Filled in by the board with its imperative animation handle. Plays that are
   * confirmed later (a wild once its colour is named, a Swap once its target
   * is) call `flyFromHand` after sending, so they animate like any other play.
   */
  flightRef?: MutableRefObject<GameBoardHandle | null>
  turnTexts: TurnTexts
  fxTexts: FxTexts
  /** swap / global_switch notice from the store; triggers trail animation. */
  swapNotice: SwapNotice | null
  /** Last play from the store; drives the opponent seat→discard card flight. */
  lastPlay: LastPlay | null
  /** True while reconnect overlay is visible; board fades back in afterwards. */
  isReconnecting: boolean
  /** True when drawing is legal right now — makes the deck clickable. */
  canDraw: boolean
  onDraw: () => void
  drawLabel: string
}

/** Imperative handle exposed through `flightRef`: see the prop's comment. */
export interface GameBoardHandle {
  flyFromHand: (card: CardDTO, idx: number) => void
}

const SWAP_TRAIL_W = 28
const SWAP_TRAIL_H = 40
const SWAP_TRAIL_R = 4

/** Localised labels for the floating callouts over the discard pile. */
export interface FxTexts {
  skip: string
  reverse: string
  colors: Record<'red' | 'yellow' | 'green' | 'blue', string>
}

// A wild's face names no colour, so the board has to say it out loud once. The
// ring, the pool and the chip all state the active colour permanently — this
// callout is what teaches a new player that they mean anything, and it is also
// the frame a clipped highlight needs: "he changed it to green" has to survive
// muted playback. Delayed past the +N callout a wild_draw_four also fires, so
// the two read as a sequence instead of stacking on the same pixels.
const COLOR_CALLOUT_DELAY_MS = 420

// effectFor returns the floating SKIP/REVERSE/+N callout shown over the discard
// pile when a special card resolves. The +N cases are numerals, so they need no
// translation; the two word callouts do.
function effectFor(
  card: CardDTO,
  pendingDraw: number,
  texts: FxTexts,
): { text: string; color: string } | null {
  switch (card.kind) {
    case 'skip':            return { text: texts.skip,    color: '#ff9f43' }
    case 'reverse':         return { text: texts.reverse, color: '#74b9ff' }
    case 'draw_two':        return { text: `+${pendingDraw || 2}`, color: '#e63946' }
    case 'wild_draw_four':  return { text: `+${pendingDraw || 4}`, color: '#e63946' }
    default:                return null
  }
}

function discardKey(c: CardDTO | null): string {
  return c ? `${c.color}-${c.kind}-${c.value ?? ''}` : ''
}

let nextFlierId = 1
const newId = () => `f${nextFlierId++}`

// Memoised: this is the expensive half of the screen (seat layout, hand slots,
// pile positions and every card are re-derived on each render) and it sits
// under a <GameView /> that also owns toasts, banners and latency updates.
// Its props are kept referentially stable there (turnTexts, fxTexts, the two
// predicates, onCardClick, onDraw) so this comparison actually bites.
export const GameBoard = memo(function GameBoard(props: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const { width: pxWidth, height: pxHeight } = useElementSize(ref)
  // Everything below works in the board's own coordinate space; <div .stage>
  // scales that space to the element's pixel size. Children — and the pure
  // layout maths they share with the animations — never see the scale.
  const scale = boardScale(pxWidth, pxHeight)
  const { width, height, offsetY } = boardSpace(pxWidth, pxHeight, scale)
  const ready = width > 0 && height > 0

  const [fliers, setFliers] = useState<Flier[]>([])
  const [effectTexts, setEffectTexts] = useState<EffectText[]>([])
  const [impacts, setImpacts] = useState<Impact[]>([])
  // Landings are scheduled for the end of a flight, so they outlive the render
  // that spawned them and have to be cancelled if the board goes away first.
  const landTimers = useRef<number[]>([])
  const stageRef = useRef<HTMLDivElement>(null)
  // When the local player plays a card, we already animate the hand→discard
  // fly. Suppress the "discard fade-in" flier for that one update so the two
  // animations don't stack on top of each other.
  const suppressNextDiscardFx = useRef(false)
  // Rebuild key forces the board's fade-in animation to replay after a reconnect.
  const [rebuildKey, setRebuildKey] = useState(0)
  const wasReconnecting = useRef(props.isReconnecting)

  const removeFlier = (id: string) => setFliers((cur) => cur.filter((f) => f.id !== id))
  const removeEffect = (id: string) => setEffectTexts((cur) => cur.filter((e) => e.id !== id))
  const removeImpact = (id: string) => setImpacts((cur) => cur.filter((i) => i.id !== id))

  useEffect(() => () => {
    landTimers.current.forEach(clearTimeout)
    landTimers.current = []
  }, [])

  // The board takes a knock when a legendary lands. Animated through the
  // `translate` property, never `transform`: .stage's transform *is* the board
  // scale, and a WAAPI transform animation would override it mid-kick and resize
  // the whole table.
  function kickBoard() {
    const el = stageRef.current
    if (!el || typeof el.animate !== 'function') return
    if (typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    el.animate(
      [
        { translate: '0 0' },
        { translate: '0 7px' },
        { translate: '-5px -3px' },
        { translate: '0 0' },
      ],
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
      setImpacts((cur) => [
        ...cur,
        {
          id: newId(),
          x: dest.x + CARD_W / 2,
          y: dest.y + CARD_H / 2,
          color: ACTIVE_RING[card.color],
          size: flight.impact,
        },
      ])
      if (flight.kick) kickBoard()
    }, afterMs)
    landTimers.current.push(timer)
  }

  const others = clockwiseOpponents(props.players, props.myIndex)
  // seatLayout picks the pill size and row count that actually fit this
  // viewport, and reports how much vertical space the seats claim so the table
  // can be placed underneath them rather than through them.
  const seats = seatLayout(ready ? others.length : 0, width, height)
  const positions = seats.positions
  // Every pile/animation coordinate needs the same seat reserve the felt uses,
  // otherwise the deck, the discard and the fliers drift apart from the table.
  const topReserve = seats.blockHeight

  // ─── Animation effect: an opponent played a card ─────────────────────────
  // Flies the card from the opponent's seat to the discard pile so the play is
  // legible without watching the pile. Declared before the discard-change effect
  // so it can claim the update and suppress the generic pile flier.
  const lastPlayAt = useRef(props.lastPlay?.at ?? 0)
  useEffect(() => {
    const lp = props.lastPlay
    if (!ready || !lp || lp.at === lastPlayAt.current) return
    lastPlayAt.current = lp.at
    // Own plays already fly out of the hand via handleCardClick.
    if (lp.actorIndex === props.myIndex) return
    const from = seatPosition(lp.actorIndex, props.players, props.myIndex, width, height)
    const dest = discardPosition(width, height, topReserve)
    const flight = flightFor(lp.card)
    setFliers((cur) => [
      ...cur,
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
    ])
    landCard(lp.card, dest, flight.duration)
    suppressNextDiscardFx.current = true
    // Keyed on the play timestamp: one flight per play, never a replay on resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.lastPlay?.at, ready])

  // ─── Animation effect: discard top changed (any source) ─────────────────
  const lastDiscardKey = useRef('')
  useEffect(() => {
    if (!ready) return
    const key = discardKey(props.discard)
    if (key === '' || key === lastDiscardKey.current) return
    const isFirstRender = lastDiscardKey.current === ''
    lastDiscardKey.current = key
    if (isFirstRender) return  // don't animate the opening card
    // A hand→discard or seat→discard flight already showed the card travelling;
    // only the generic pile flier is redundant. The effect callout still fires —
    // playing your own Skip must announce itself just like an opponent's.
    const covered = suppressNextDiscardFx.current
    suppressNextDiscardFx.current = false
    if (!covered) {
      const target = discardPosition(width, height, topReserve)
      const flight = flightFor(props.discard!)
      setFliers((cur) => [
        ...cur,
        {
          id: newId(),
          kind: 'face',
          card: props.discard!,
          from: { x: target.x, y: target.y + CARD_H / 2 },
          to: { x: target.x, y: target.y },
          startAlpha: 0.1,
          startScale: 0.6,
          duration: flight.duration,
          swell: flight.swell,
        },
      ])
      landCard(props.discard!, target, flight.duration)
    }
    const eff = effectFor(props.discard!, props.pendingDraw, props.fxTexts)
    if (eff) {
      setEffectTexts((cur) => [
        ...cur,
        {
          id: newId(),
          text: eff.text,
          color: eff.color,
          x: width / 2,
          y: discardPosition(width, height, topReserve).y - 10,
          delayMs: flightFor(props.discard!).duration,
        },
      ])
    }
    // landCard is re-created every render and only schedules a timer; listing it
    // would restage the landing on any unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.discard, props.pendingDraw, props.fxTexts, ready, width, height, topReserve])

  // ─── Animation effect: a wild named a new colour ──────────────────────────
  // Only fires while the top card is a wild: any other card carries its colour
  // on its own face, and announcing what the player can already read is noise.
  const lastActiveColor = useRef<CardColor | ''>('')
  useEffect(() => {
    if (!ready) return
    const prev = lastActiveColor.current
    lastActiveColor.current = props.activeColor
    if (prev === '' || prev === props.activeColor) return
    if (props.discard?.color !== 'wild') return
    const label = props.fxTexts.colors[props.activeColor as 'red' | 'yellow' | 'green' | 'blue']
    if (!label) return
    setEffectTexts((cur) => [
      ...cur,
      {
        id: newId(),
        text: label,
        color: ACTIVE_RING[props.activeColor],
        x: width / 2,
        y: discardPosition(width, height, topReserve).y - 10,
        delayMs: (props.discard ? flightFor(props.discard).duration : 0) + COLOR_CALLOUT_DELAY_MS,
      },
    ])
  }, [props.activeColor, props.discard, props.fxTexts, ready, width, height, topReserve])

  // ─── Animation effect: my hand grew by one (drew a card) ─────────────────
  const prevHandSize = useRef(props.myHand.length)
  useEffect(() => {
    if (!ready) return
    const prev = prevHandSize.current
    const curr = props.myHand.length
    prevHandSize.current = curr
    if (curr !== prev + 1) return  // only single-card draws (penalty draws batch differently)
    const slots = calcHandSlots(curr, width, height)
    const target = slots[curr - 1]
    const start = deckPosition(width, height, topReserve)
    setFliers((cur) => [
      ...cur,
      {
        id: newId(),
        kind: 'back',
        from: { x: start.x, y: start.y },
        to: { x: target.x, y: target.y, rotation: target.rotation },
        startAlpha: 0.1,
        startScale: 0.7,
        duration: 300,
      },
    ])
  }, [props.myHand.length, ready, width, height, topReserve])

  // ─── Animation effect: swap / global_switch notice ──────────────────────
  useEffect(() => {
    if (!ready || !props.swapNotice) return
    const sn = props.swapNotice
    if (sn.kind === 'swap' && sn.targetIndex >= 0) {
      const a = seatPosition(sn.actorIndex, props.players, props.myIndex, width, height)
      const b = seatPosition(sn.targetIndex, props.players, props.myIndex, width, height)
      spawnSwapTrail(a, b, 0)
      spawnSwapTrail(b, a, 90)
    } else if (sn.kind === 'global_switch') {
      const ordered = [...props.players].sort((p, q) => p.index - q.index)
      const step = sn.direction >= 0 ? 1 : ordered.length - 1
      for (let i = 0; i < ordered.length; i++) {
        const fromIdx = ordered[i].index
        const toIdx = ordered[(i + step) % ordered.length].index
        if (fromIdx === toIdx) continue
        const a = seatPosition(fromIdx, props.players, props.myIndex, width, height)
        const b = seatPosition(toIdx, props.players, props.myIndex, width, height)
        spawnSwapTrail(a, b, i * 60)
      }
    }
    // Triggered only when a fresh notice arrives (keyed by .at).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.swapNotice?.at, ready])

  function spawnSwapTrail(from: { x: number; y: number }, to: { x: number; y: number }, delayMs: number) {
    setFliers((cur) => [
      ...cur,
      {
        id: newId(),
        kind: 'back',
        from: { x: from.x - SWAP_TRAIL_W / 2, y: from.y - SWAP_TRAIL_H / 2, rotation: 0 },
        to:   { x: to.x   - SWAP_TRAIL_W / 2, y: to.y   - SWAP_TRAIL_H / 2, rotation: Math.PI * 0.5 },
        size: { w: SWAP_TRAIL_W, h: SWAP_TRAIL_H, r: SWAP_TRAIL_R },
        startAlpha: 0,
        startScale: 0.7,
        duration: 480,
        delayMs,
        fadeOut: true,
      },
    ])
  }

  // ─── Reconnect: bump rebuildKey on the false→true→false transition so the
  // board's children fade in once the overlay clears. ────────────────────
  useEffect(() => {
    if (wasReconnecting.current && !props.isReconnecting) {
      setRebuildKey((k) => k + 1)
    }
    wasReconnecting.current = props.isReconnecting
  }, [props.isReconnecting])

  // Spawns the hand→discard flight for a card the player has just committed.
  // Called straight after the send, never before it: the flight is a few
  // hundred milliseconds of local rendering and the message is the thing the
  // whole table is waiting on, so the packet leaves first and the animation
  // catches up on the same frame.
  function flyFromHand(card: CardDTO, idx: number) {
    if (!ready) return
    const slots = calcHandSlots(props.myHand.length, width, height)
    const slot = slots[idx]
    if (!slot) return
    const dest = discardPosition(width, height, topReserve)
    // The lift applied to playable cards in <Hand /> shifts them up by 9px
    // at rest; mirror it so the fly starts at the visually correct spot.
    const liftedY = props.isPlayable(card) ? slot.y - 9 : slot.y
    const flight = flightFor(card)
    setFliers((cur) => [
      ...cur,
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
    ])
    landCard(card, dest, flight.duration)
    suppressNextDiscardFx.current = true
  }

  // Reassigned on every render so the handle closes over the current hand and
  // board size, since the picker calls it a beat after the tap that opened it.
  useEffect(() => {
    if (!props.flightRef) return
    props.flightRef.current = { flyFromHand }
  })

  // The parent owns the rules: it tells us whether the tap became a play. A
  // refused tap (illegal card) and a tap that only opens a prompt both animate
  // nothing: flying the card out and snapping it back reads as a bug rather
  // than as "you can't play that".
  const handleCardClick = (card: CardDTO, idx: number) => {
    if (props.onCardClick(card, idx)) flyFromHand(card, idx)
  }

  // Felt table — geometry lives in layout.ts so tests and animations share it.
  const table = tableRect(width, height, topReserve)

  return (
    <div ref={ref} className={styles.board} data-testid="game-board">
      <div
        ref={stageRef}
        className={styles.stage}
        style={{ width, height, transform: `translateY(${offsetY}px) scale(${scale})` }}
      >
        {ready && !props.isReconnecting && (
          <div key={rebuildKey} className={styles.fadeIn}>
            <div
              className={styles.tableOval}
              style={{ left: table.left, top: table.top, width: table.width, height: table.height }}
            >
              <svg
                className={styles.tableMark}
                viewBox={LOCO_MARK_VIEWBOX}
                aria-hidden="true"
                focusable="false"
              >
                <path d={LOCO_MARK_PATH} fillRule="evenodd" fill="#ffffff" />
              </svg>
            </div>
            {/* Keyed on the direction so a Reverse remounts the ring and
                replays its flip: the change of heading is the event. */}
            <DirectionRing
              key={props.direction >= 0 ? 'cw' : 'ccw'}
              rect={table}
              direction={props.direction}
              label={props.directionLabel}
            />
            <Deck
              width={width}
              height={height}
              topReserve={topReserve}
              canDraw={props.canDraw}
              onDraw={props.onDraw}
              drawLabel={props.drawLabel}
            />
            <DiscardPile
              card={props.discard}
              activeColor={props.activeColor}
              pendingDraw={props.pendingDraw}
              width={width}
              height={height}
              topReserve={topReserve}
            />
            <TurnIndicator
              isMyTurn={props.currentTurn === props.myIndex}
              pendingDraw={props.pendingDraw}
              canCounter={props.canCounter}
              currentTurn={props.currentTurn}
              players={props.players}
              height={height}
              texts={props.turnTexts}
            />
            {others.map((p, i) => (
              <PlayerSlot
                key={p.index}
                nickname={p.nickname}
                handSize={p.hand_size}
                isActiveTurn={p.index === props.currentTurn}
                isDisconnected={p.connected === false}
                x={positions[i].x}
                y={positions[i].y}
                size={seats.size}
              />
            ))}
            <Hand
              hand={props.myHand}
              width={width}
              height={height}
              isPlayable={props.isPlayable}
              isInteractive={props.isInteractive}
              onCardClick={handleCardClick}
            />
          </div>
        )}
        <AnimationLayer
          fliers={fliers}
          effectTexts={effectTexts}
          impacts={impacts}
          onFlierDone={removeFlier}
          onEffectDone={removeEffect}
          onImpactDone={removeImpact}
        />
      </div>
    </div>
  )
})
