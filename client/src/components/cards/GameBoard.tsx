import { memo, useEffect, useRef, useState } from 'react'
import { CardDTO, CardColor, PlayerDTO } from '../../types/protocol'
import { useElementSize } from '../../hooks/useElementSize'
import { Deck } from './Deck'
import { DiscardPile } from './DiscardPile'
import { Hand } from './Hand'
import { PlayerSlot } from './PlayerSlot'
import { TurnIndicator, TurnTexts } from './TurnIndicator'
import { AnimationLayer, Flier, EffectText } from './AnimationLayer'
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
import { CARD_W, CARD_H } from './cardTheme'
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
  pendingDraw: number
  /** True when a card in hand actually stacks the pending penalty (see TurnIndicator). */
  canCounter: boolean
  isPlayable: (card: CardDTO) => boolean
  isInteractive: (card: CardDTO) => boolean
  onCardClick: (card: CardDTO, idx: number) => void
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

const SWAP_TRAIL_W = 28
const SWAP_TRAIL_H = 40
const SWAP_TRAIL_R = 4

/** Localised labels for the floating callouts over the discard pile. */
export interface FxTexts {
  skip: string
  reverse: string
}

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
  // When the local player plays a card, we already animate the hand→discard
  // fly. Suppress the "discard fade-in" flier for that one update so the two
  // animations don't stack on top of each other.
  const suppressNextDiscardFx = useRef(false)
  // Rebuild key forces the board's fade-in animation to replay after a reconnect.
  const [rebuildKey, setRebuildKey] = useState(0)
  const wasReconnecting = useRef(props.isReconnecting)

  const removeFlier = (id: string) => setFliers((cur) => cur.filter((f) => f.id !== id))
  const removeEffect = (id: string) => setEffectTexts((cur) => cur.filter((e) => e.id !== id))

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
        duration: 340,
        arcHeight: 26,
      },
    ])
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
          duration: 300,
        },
      ])
    }
    const eff = effectFor(props.discard!, props.pendingDraw, props.fxTexts)
    if (eff) {
      setEffectTexts((cur) => [
        ...cur,
        { id: newId(), text: eff.text, color: eff.color, x: width / 2, y: discardPosition(width, height, topReserve).y - 10 },
      ])
    }
  }, [props.discard, props.pendingDraw, props.fxTexts, ready, width, height, topReserve])

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

  // Wrap card click so we can spawn the hand→discard fly before the parent
  // sends the WS message and the store updates myHand/discard.
  const handleCardClick = (card: CardDTO, idx: number) => {
    if (ready) {
      const slots = calcHandSlots(props.myHand.length, width, height)
      const slot = slots[idx]
      if (slot) {
        const dest = discardPosition(width, height, topReserve)
        // The lift applied to playable cards in <Hand /> shifts them up by 9px
        // at rest; mirror it so the fly starts at the visually correct spot.
        const liftedY = props.isPlayable(card) ? slot.y - 9 : slot.y
        setFliers((cur) => [
          ...cur,
          {
            id: newId(),
            kind: 'face',
            card,
            from: { x: slot.x, y: liftedY, rotation: slot.rotation },
            to: { x: dest.x, y: dest.y, rotation: 0 },
            startAlpha: 0.9,
            duration: 300,
            arcHeight: 22,
          },
        ])
        suppressNextDiscardFx.current = true
      }
    }
    props.onCardClick(card, idx)
  }

  // Felt table — geometry lives in layout.ts so tests and animations share it.
  const table = tableRect(width, height, topReserve)

  return (
    <div ref={ref} className={styles.board} data-testid="game-board">
      <div
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
          onFlierDone={removeFlier}
          onEffectDone={removeEffect}
        />
      </div>
    </div>
  )
})
