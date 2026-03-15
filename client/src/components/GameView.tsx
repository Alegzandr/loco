import { useEffect, useRef, useState, useCallback } from 'react'
import { PixiGame } from '../game/PixiGame'
import { CardDTO, CardColor, ClientMsg } from '../types/protocol'
import { useGameStore } from '../hooks/useGameStore'
import { useI18n } from '../i18n'
import { RulesModal } from './RulesModal'
import { UnoTimer } from './UnoTimer'
import { ColorPicker } from './ColorPicker'
import { ActionBar } from './ActionBar'
import { RoundSummary } from './RoundSummary'
import styles from './GameView.module.css'

// Client-side card legality hint — prevents animating clearly-invalid plays before
// the server rejects them. Server validation is always authoritative.
function clientMayPlay(
  card: CardDTO,
  discard: CardDTO | null,
  activeColor: CardColor,
  pendingDraw: number,
): boolean {
  if (pendingDraw > 0) {
    // Under an active draw stack only counter cards are playable
    return card.kind === 'draw_two' || card.kind === 'wild_draw_four'
  }
  if (card.kind === 'wild' || card.kind === 'wild_draw_four') return true
  if (!discard) return true
  if (card.color === activeColor) return true
  // For non-number action cards matching kind is enough (e.g. Skip on Skip)
  if (card.kind !== 'number' && card.kind === discard.kind) return true
  // For number cards require matching value (mirrors server CanPlay)
  if (card.kind === 'number' && discard.kind === 'number') return card.value === discard.value
  return false
}

interface Props {
  onSend: (msg: ClientMsg) => void
}

const UNO_WINDOW_MS = 5000
const ROUND_SUMMARY_AUTO_DISMISS_MS = 8000

export function GameView({ onSend }: Props) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pixiRef = useRef<PixiGame | null>(null)
  // Tracks when PixiJS async init completes so the render effect can fire even
  // if no game-state deps changed between component mount and init completion.
  const [pixiReady, setPixiReady] = useState(false)
  const [colorPicker, setColorPicker] = useState<{ card: CardDTO; idx: number } | null>(null)
  const [timerPct, setTimerPct] = useState(0)
  const timerRafRef = useRef<number | null>(null)
  const [turnTimerPct, setTurnTimerPct] = useState(0)
  const turnTimerRafRef = useRef<number | null>(null)
  const lastActionRef = useRef<number>(0)
  const reconnectAnimatedRef = useRef(false)
  const prevHandSizeRef = useRef<number>(0)
  const [summaryCountdown, setSummaryCountdown] = useState(0)
  const summaryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [showReconnectOverlay, setShowReconnectOverlay] = useState(false)
  const [showRules, setShowRules] = useState(false)

  const {
    myHand,
    players,
    discard,
    activeColor,
    currentTurn,
    myIndex,
    pendingDraw,
    hasDrawn,
    unoDeclared,
    unoTimerEnd,
    turnDeadline,
    showRoundSummary,
    roundWinner,
    roundScores,
    roundNumber_completed,
    scoreboard,
    roundNumber,
    matchFormat,
    isReconnecting,
    errorMsg,
    dismissRoundSummary,
    setIsReconnecting,
    clearError,
  } = useGameStore()

  const guardDoubleTap = useCallback((fn: () => void) => {
    const now = Date.now()
    if (now - lastActionRef.current < 400) return
    lastActionRef.current = now
    fn()
  }, [])

  const handleCardClick = useCallback(
    (card: CardDTO, cardIdx: number) => {
      if (currentTurn !== myIndex) return
      if (card.kind === 'wild' || card.kind === 'wild_draw_four') {
        setColorPicker({ card, idx: cardIdx })
        return
      }
      // Block the play animation for clearly-invalid cards so there's no "fake" play.
      // Server is always authoritative; this is a UX hint only.
      if (!clientMayPlay(card, discard, activeColor, pendingDraw)) return
      // Trigger travel animation before state update
      const game = pixiRef.current
      if (game) {
        const { width, height } = game.app.screen
        game.animateCardPlay(card, cardIdx, width, height)
      }
      onSend({ type: 'play_card', card, chosen_color: card.color })
    },
    [currentTurn, myIndex, discard, activeColor, pendingDraw, onSend]
  )

  // Stable ref so PixiGame always invokes the latest handleCardClick
  // even though the PixiGame instance is created once in the init effect below.
  const onCardClickRef = useRef(handleCardClick)
  onCardClickRef.current = handleCardClick

  // Initialize PixiJS
  useEffect(() => {
    if (!canvasRef.current) return
    const stableOnCardClick = (card: CardDTO, cardIdx: number) =>
      onCardClickRef.current(card, cardIdx)
    const game = new PixiGame(stableOnCardClick)
    let cancelled = false
    game.init(canvasRef.current).then(() => {
      if (!cancelled) {
        pixiRef.current = game
        // Trigger the render effect so the initial game state is drawn even
        // if no store deps changed between component mount and init completion.
        setPixiReady(true)
      }
    })
    return () => {
      cancelled = true
      game.destroy()
      pixiRef.current = null
    }
  }, [])

  // Handle reconnect animation
  useEffect(() => {
    if (!isReconnecting) {
      reconnectAnimatedRef.current = false
      return
    }
    if (reconnectAnimatedRef.current) return
    reconnectAnimatedRef.current = true

    setShowReconnectOverlay(true)

    const overlayTimer = setTimeout(() => {
      setShowReconnectOverlay(false)
      const game = pixiRef.current
      if (!game) {
        setIsReconnecting(false)
        return
      }
      game.renderReconnect(
        { myHand, discard, activeColor, players, myIndex, currentTurn, pendingDraw,
          turnTexts: { yourTurn: t.yourTurn, drawOrCounter: t.drawOrCounter, playerTurnSuffix: t.playerTurnSuffix,
            ord1: t.ord1, ord2: t.ord2, ord3: t.ord3, ordN: t.ordN } },
        () => { setIsReconnecting(false) }
      )
    }, 600)

    return () => clearTimeout(overlayTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReconnecting])

  // Re-render on state change; trigger draw animation when hand grows
  useEffect(() => {
    if (isReconnecting) return
    const game = pixiRef.current
    if (!game) return

    // Detect when we drew a card (hand size increased by 1)
    const prev = prevHandSizeRef.current
    const curr = myHand.length
    if (curr > prev && curr === prev + 1) {
      game.animateCardDrawn(myHand[myHand.length - 1])
    }
    prevHandSizeRef.current = curr

    game.render({
      myHand, discard, activeColor, players, myIndex, currentTurn, pendingDraw,
      turnTexts: { yourTurn: t.yourTurn, drawOrCounter: t.drawOrCounter, playerTurnSuffix: t.playerTurnSuffix,
        ord1: t.ord1, ord2: t.ord2, ord3: t.ord3, ordN: t.ordN },
    })
  }, [myHand, discard, activeColor, players, myIndex, currentTurn, pendingDraw, isReconnecting, t, pixiReady])

  // Animate UNO catch timer bar
  useEffect(() => {
    if (timerRafRef.current !== null) {
      cancelAnimationFrame(timerRafRef.current)
      timerRafRef.current = null
    }
    if (!unoTimerEnd) {
      setTimerPct(0)
      return
    }
    const tick = () => {
      const remaining = unoTimerEnd - Date.now()
      const pct = Math.max(0, Math.min(100, (remaining / UNO_WINDOW_MS) * 100))
      setTimerPct(pct)
      if (pct > 0) {
        timerRafRef.current = requestAnimationFrame(tick)
      }
    }
    timerRafRef.current = requestAnimationFrame(tick)
    return () => {
      if (timerRafRef.current !== null) cancelAnimationFrame(timerRafRef.current)
    }
  }, [unoTimerEnd])

  // Animate per-turn countdown bar
  useEffect(() => {
    if (turnTimerRafRef.current !== null) {
      cancelAnimationFrame(turnTimerRafRef.current)
      turnTimerRafRef.current = null
    }
    if (!turnDeadline) {
      setTurnTimerPct(0)
      return
    }
    const totalMs = turnDeadline - Date.now()
    if (totalMs <= 0) {
      setTurnTimerPct(0)
      return
    }
    const tick = () => {
      const remaining = turnDeadline - Date.now()
      const pct = Math.max(0, Math.min(100, (remaining / totalMs) * 100))
      setTurnTimerPct(pct)
      if (pct > 0) {
        turnTimerRafRef.current = requestAnimationFrame(tick)
      }
    }
    turnTimerRafRef.current = requestAnimationFrame(tick)
    return () => {
      if (turnTimerRafRef.current !== null) cancelAnimationFrame(turnTimerRafRef.current)
    }
  }, [turnDeadline])

  // Auto-clear in-game error messages after 2.5 seconds
  useEffect(() => {
    if (!errorMsg) return
    const t = setTimeout(clearError, 2500)
    return () => clearTimeout(t)
  }, [errorMsg, clearError])

  // Auto-dismiss round summary countdown
  useEffect(() => {
    if (!showRoundSummary) {
      if (summaryTimerRef.current) {
        clearInterval(summaryTimerRef.current)
        summaryTimerRef.current = null
      }
      setSummaryCountdown(0)
      return
    }

    setSummaryCountdown(Math.ceil(ROUND_SUMMARY_AUTO_DISMISS_MS / 1000))
    const start = Date.now()
    summaryTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - start
      const remaining = ROUND_SUMMARY_AUTO_DISMISS_MS - elapsed
      if (remaining <= 0) {
        if (summaryTimerRef.current) clearInterval(summaryTimerRef.current)
        summaryTimerRef.current = null
        dismissRoundSummary()
      } else {
        setSummaryCountdown(Math.ceil(remaining / 1000))
      }
    }, 250)

    return () => {
      if (summaryTimerRef.current) clearInterval(summaryTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRoundSummary])

  const isMyTurn = currentTurn === myIndex
  const isFinished = !!players.find((p) => p.index === myIndex)?.finished
  // True when the player has at least one card they can legally play right now.
  // Used to de-emphasize the Draw button so it doesn't look like the required action.
  const hasPlayableCard = isMyTurn && myHand.some(c => clientMayPlay(c, discard, activeColor, pendingDraw))

  return (
    <div className={styles.container}>
      <canvas ref={canvasRef} className={styles.canvas} />

      {/* Per-turn countdown bar — shown whenever a deadline is active */}
      {turnDeadline !== null && (
        <div className={styles.turnTimerBar}>
          <div
            className={`${styles.turnTimerFill}${turnTimerPct < 20 ? ' ' + styles.turnTimerFillUrgent : ''}`}
            style={{
              width: `${turnTimerPct}%`,
              background: turnTimerPct < 25 ? '#ff4757' : turnTimerPct < 50 ? '#ffa502' : '#4d96ff',
            }}
          />
        </div>
      )}

      {/* Reconnect overlay */}
      {showReconnectOverlay && (
        <div className={styles.reconnectOverlay}>
          <div className={styles.reconnectCard}>
            <div className={styles.reconnectSpinner} />
            <div className={styles.reconnectText}>{t.reconnected}</div>
            <div className={styles.reconnectSub}>{t.rebuildingTable}</div>
          </div>
        </div>
      )}

      {/* UNO catch timer */}
      {unoDeclared && unoTimerEnd && (
        <UnoTimer timerPct={timerPct} label={t.catchWindow} />
      )}

      {/* Action bar */}
      <ActionBar
        isMyTurn={isMyTurn}
        isFinished={isFinished}
        pendingDraw={pendingDraw}
        handSize={myHand.length}
        hasDrawn={hasDrawn}
        hasPlayableCard={hasPlayableCard}
        unoTimerEnd={unoTimerEnd}
        onDraw={() => guardDoubleTap(() => onSend({ type: 'draw_card' }))}
        onPass={() => guardDoubleTap(() => onSend({ type: 'pass_turn' }))}
        onUno={() => guardDoubleTap(() => onSend({ type: 'declare_uno' }))}
        onCatch={() => guardDoubleTap(() => onSend({ type: 'catch_uno' }))}
        t={t}
      />

      {/* Fixed Rules button — top-right corner, never shifts with action bar */}
      <button className={styles.rulesBtn} onClick={() => setShowRules(true)}>
        {t.rulesBtn}
      </button>

      {/* In-game error toast */}
      {errorMsg && <div className={styles.errorToast}>{errorMsg}</div>}

      {/* Wild color picker */}
      {colorPicker && (
        <ColorPicker
          label={t.chooseColor}
          onChoose={(col: CardColor) => {
            const game = pixiRef.current
            if (game) {
              const { width, height } = game.app.screen
              game.animateCardPlay(colorPicker.card, colorPicker.idx, width, height)
            }
            onSend({ type: 'play_card', card: colorPicker.card, chosen_color: col })
            setColorPicker(null)
          }}
          onCancel={() => setColorPicker(null)}
        />
      )}

      {/* Round summary overlay */}
      {showRoundSummary && (
        <RoundSummary
          roundNumber={roundNumber_completed}
          roundWinner={roundWinner}
          roundScores={roundScores}
          scoreboard={scoreboard}
          matchFormat={matchFormat}
          summaryCountdown={summaryCountdown}
          onDismiss={dismissRoundSummary}
          t={t}
        />
      )}

      {unoDeclared && <div className={styles.unoBanner}>{t.unoBanner}</div>}

      {/* Spectating banner when local player has finished but round is still going */}
      {isFinished && !showRoundSummary && (
        <div className={styles.spectatingBanner}>{t.spectating}</div>
      )}

      {matchFormat !== 'BO1' && (
        <div className={styles.roundIndicator}>
          {t.round} {roundNumber} · {matchFormat}
        </div>
      )}

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  )
}
