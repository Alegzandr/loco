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

interface Props {
  onSend: (msg: ClientMsg) => void
}

const UNO_WINDOW_MS = 5000
const ROUND_SUMMARY_AUTO_DISMISS_MS = 8000

export function GameView({ onSend }: Props) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pixiRef = useRef<PixiGame | null>(null)
  const [colorPicker, setColorPicker] = useState<CardDTO | null>(null)
  const [timerPct, setTimerPct] = useState(0)
  const timerRafRef = useRef<number | null>(null)
  const lastActionRef = useRef<number>(0)
  const reconnectAnimatedRef = useRef(false)
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
    unoDeclared,
    unoTimerEnd,
    showRoundSummary,
    roundWinner,
    roundScores,
    roundNumber_completed,
    scoreboard,
    roundNumber,
    matchFormat,
    isReconnecting,
    dismissRoundSummary,
    setIsReconnecting,
  } = useGameStore()

  const guardDoubleTap = useCallback((fn: () => void) => {
    const now = Date.now()
    if (now - lastActionRef.current < 400) return
    lastActionRef.current = now
    fn()
  }, [])

  const handleCardClick = useCallback(
    (card: CardDTO) => {
      if (currentTurn !== myIndex) return
      if (card.kind === 'wild' || card.kind === 'wild_draw_four') {
        setColorPicker(card)
        return
      }
      onSend({ type: 'play_card', card, chosen_color: card.color })
    },
    [currentTurn, myIndex, onSend]
  )

  // Initialize PixiJS
  useEffect(() => {
    if (!canvasRef.current) return
    const game = new PixiGame(handleCardClick)
    let cancelled = false
    game.init(canvasRef.current).then(() => {
      if (!cancelled) pixiRef.current = game
    })
    return () => {
      cancelled = true
      game.destroy()
      pixiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        { myHand, discard, activeColor, players, myIndex, currentTurn, pendingDraw },
        () => { setIsReconnecting(false) }
      )
    }, 600)

    return () => clearTimeout(overlayTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReconnecting])

  // Re-render on state change
  useEffect(() => {
    if (isReconnecting) return
    pixiRef.current?.render({ myHand, discard, activeColor, players, myIndex, currentTurn, pendingDraw })
  }, [myHand, discard, activeColor, players, myIndex, currentTurn, pendingDraw, isReconnecting])

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

  return (
    <div className={styles.container}>
      <canvas ref={canvasRef} className={styles.canvas} />

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
        pendingDraw={pendingDraw}
        handSize={myHand.length}
        onDraw={() => guardDoubleTap(() => onSend({ type: 'draw_card' }))}
        onPass={() => guardDoubleTap(() => onSend({ type: 'pass_turn' }))}
        onUno={() => guardDoubleTap(() => onSend({ type: 'declare_uno' }))}
        onCatch={() => guardDoubleTap(() => onSend({ type: 'catch_uno' }))}
        onRules={() => setShowRules(true)}
        t={t}
      />

      {/* Wild color picker */}
      {colorPicker && (
        <ColorPicker
          label={t.chooseColor}
          onChoose={(col: CardColor) => {
            onSend({ type: 'play_card', card: colorPicker, chosen_color: col })
            setColorPicker(null)
          }}
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

      {unoDeclared && <div className={styles.unoBanner}>UNO!</div>}

      {matchFormat !== 'BO1' && (
        <div className={styles.roundIndicator}>
          {t.round} {roundNumber} · {matchFormat}
        </div>
      )}

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  )
}
