import { useEffect, useRef, useState, useCallback } from 'react'
import { PixiGame } from '../game/PixiGame'
import { CardDTO, CardColor, ClientMsg } from '../types/protocol'
import { useGameStore } from '../hooks/useGameStore'
import styles from './GameView.module.css'

interface Props {
  onSend: (msg: ClientMsg) => void
}

const WILD_COLORS: CardColor[] = ['red', 'yellow', 'green', 'blue']
const UNO_WINDOW_MS = 5000
const ROUND_SUMMARY_AUTO_DISMISS_MS = 8000

export function GameView({ onSend }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pixiRef = useRef<PixiGame | null>(null)
  const [colorPicker, setColorPicker] = useState<CardDTO | null>(null)
  const [timerPct, setTimerPct] = useState(0)
  const timerRafRef = useRef<number | null>(null)
  // Prevent accidental double-taps by debouncing action button presses
  const lastActionRef = useRef<number>(0)
  // Track whether we've already triggered the reconnect animation for the current session
  const reconnectAnimatedRef = useRef(false)
  // Auto-dismiss countdown for round summary
  const [summaryCountdown, setSummaryCountdown] = useState(0)
  const summaryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Reconnect overlay visibility
  const [showReconnectOverlay, setShowReconnectOverlay] = useState(false)

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
    (card: CardDTO, _idx: number) => {
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
    const game = new PixiGame(canvasRef.current, handleCardClick)
    pixiRef.current = game
    game.init(canvasRef.current)
    return () => {
      game.destroy()
      pixiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle reconnect animation: when isReconnecting flips to true, show overlay then animate
  useEffect(() => {
    if (!isReconnecting) {
      reconnectAnimatedRef.current = false
      return
    }
    if (reconnectAnimatedRef.current) return
    reconnectAnimatedRef.current = true

    setShowReconnectOverlay(true)

    // After a short pause showing the "Rebuilding table..." overlay, start the animation
    const overlayTimer = setTimeout(() => {
      setShowReconnectOverlay(false)
      const game = pixiRef.current
      if (!game) {
        setIsReconnecting(false)
        return
      }
      game.renderReconnect(
        { myHand, discard, activeColor, players, myIndex, currentTurn, pendingDraw },
        () => {
          setIsReconnecting(false)
        }
      )
    }, 600)

    return () => clearTimeout(overlayTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReconnecting])

  // Re-render on state change (skip if reconnect animation is in progress)
  useEffect(() => {
    if (isReconnecting) return
    pixiRef.current?.render({
      myHand,
      discard,
      activeColor,
      players,
      myIndex,
      currentTurn,
      pendingDraw,
    })
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

  // Compute rounds-needed from match format for display
  const matchRoundsNeeded = matchFormatRounds(matchFormat)

  return (
    <div className={styles.container}>
      <canvas ref={canvasRef} className={styles.canvas} />

      {/* Reconnect overlay — visible briefly before animated recovery */}
      {showReconnectOverlay && (
        <div className={styles.reconnectOverlay}>
          <div className={styles.reconnectCard}>
            <div className={styles.reconnectSpinner} />
            <div className={styles.reconnectText}>Reconnected</div>
            <div className={styles.reconnectSub}>Rebuilding table…</div>
          </div>
        </div>
      )}

      {/* UNO catch timer */}
      {unoDeclared && unoTimerEnd && (
        <div className={styles.unoTimer}>
          <span className={styles.unoTimerLabel}>Catch window!</span>
          <div className={styles.unoTimerBar}>
            <div className={styles.unoTimerFill} style={{ width: `${timerPct}%` }} />
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className={styles.actionBar}>
        {isMyTurn && pendingDraw > 0 && (
          <button
            className={styles.btnDraw}
            onClick={() => guardDoubleTap(() => onSend({ type: 'draw_card' }))}
          >
            Draw {pendingDraw}
          </button>
        )}
        {isMyTurn && pendingDraw === 0 && (
          <>
            <button
              className={styles.btnDraw}
              onClick={() => guardDoubleTap(() => onSend({ type: 'draw_card' }))}
            >
              Draw
            </button>
            <button
              className={styles.btnPass}
              onClick={() => guardDoubleTap(() => onSend({ type: 'pass_turn' }))}
            >
              Pass
            </button>
          </>
        )}
        <button
          className={styles.btnUno}
          onClick={() => guardDoubleTap(() => onSend({ type: 'declare_uno' }))}
          disabled={myHand.length !== 1}
        >
          UNO!
        </button>
        <button
          className={styles.btnCatch}
          onClick={() => guardDoubleTap(() => onSend({ type: 'catch_uno' }))}
        >
          Catch!
        </button>
      </div>

      {/* Wild color picker overlay — optimized for touch */}
      {colorPicker && (
        <div className={styles.overlay}>
          <div className={styles.colorPicker}>
            <p>Choose a color</p>
            <div className={styles.colorBtnRow}>
              {WILD_COLORS.map((col) => (
                <button
                  key={col}
                  className={styles.colorBtn}
                  aria-label={col}
                  style={{ background: colorHex(col) }}
                  onClick={() => {
                    onSend({ type: 'play_card', card: colorPicker, chosen_color: col })
                    setColorPicker(null)
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Round summary overlay */}
      {showRoundSummary && (
        <div className={styles.roundSummary}>
          <div className={styles.roundSummaryCard}>
            <div className={styles.roundSummaryTitle}>
              Round {roundNumber_completed}
              {matchRoundsNeeded > 1 && ` of ${matchRoundsNeeded}`} Complete
            </div>
            <div className={styles.roundSummaryWinner}>
              🏆 {roundWinner} wins the round!
            </div>

            {/* Per-player round breakdown */}
            <div className={styles.roundScoreTable}>
              <div className={styles.roundScoreHeader}>
                <span>Player</span>
                <span>+pts</span>
                <span>Total</span>
                <span>Wins</span>
              </div>
              {roundScores
                .slice()
                .sort((a, b) => b.cumulative_score - a.cumulative_score)
                .map((entry) => (
                  <div
                    key={entry.player_index}
                    className={`${styles.roundScoreRow} ${entry.nickname === roundWinner ? styles.roundScoreRowWinner : ''}`}
                  >
                    <span className={styles.roundScoreName}>{entry.nickname}</span>
                    <span className={styles.roundScoreDelta}>
                      {entry.round_points > 0 ? `+${entry.round_points}` : '—'}
                    </span>
                    <span className={styles.roundScoreTotal}>{entry.cumulative_score}</span>
                    <span className={styles.roundScoreWins}>{entry.rounds_won}W</span>
                  </div>
                ))}
            </div>

            {/* Cumulative match scoreboard */}
            {scoreboard.length > 0 && matchRoundsNeeded > 1 && (
              <div className={styles.matchProgress}>
                <div className={styles.matchProgressTitle}>
                  Match Scoreboard — {matchFormat}
                </div>
                <div className={styles.scoreboard}>
                  {scoreboard
                    .slice()
                    .sort((a, b) => b.score - a.score)
                    .map((entry) => (
                      <div key={entry.player_index} className={styles.scoreRow}>
                        <span className={styles.scoreName}>{entry.nickname}</span>
                        <span className={styles.scoreVal}>
                          {entry.score} pts · {entry.rounds_won}W
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <button
              className={styles.btnContinue}
              onClick={dismissRoundSummary}
            >
              Continue ({summaryCountdown}s)
            </button>
          </div>
        </div>
      )}

      {unoDeclared && <div className={styles.unoBanner}>UNO!</div>}

      {/* Round indicator */}
      {matchFormat !== 'BO1' && (
        <div className={styles.roundIndicator}>
          Round {roundNumber} · {matchFormat}
        </div>
      )}
    </div>
  )
}

function colorHex(c: CardColor): string {
  const map: Record<CardColor, string> = {
    red: '#e74c3c',
    yellow: '#f1c40f',
    green: '#2ecc71',
    blue: '#3498db',
    wild: '#2c3e50',
  }
  return map[c]
}

function matchFormatRounds(fmt: string): number {
  switch (fmt) {
    case 'BO3': return 3
    case 'BO5': return 5
    case 'BO7': return 7
    default: return 1
  }
}
