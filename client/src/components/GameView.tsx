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

export function GameView({ onSend }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pixiRef = useRef<PixiGame | null>(null)
  const [colorPicker, setColorPicker] = useState<CardDTO | null>(null)
  const [timerPct, setTimerPct] = useState(0)
  const timerRafRef = useRef<number | null>(null)
  // Prevent accidental double-taps by debouncing action button presses
  const lastActionRef = useRef<number>(0)

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
    scoreboard,
    roundNumber,
    matchFormat,
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

  // Re-render on state change
  useEffect(() => {
    pixiRef.current?.render({
      myHand,
      discard,
      activeColor,
      players,
      myIndex,
      currentTurn,
      pendingDraw,
    })
  }, [myHand, discard, activeColor, players, myIndex, currentTurn, pendingDraw])

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

  const isMyTurn = currentTurn === myIndex

  return (
    <div className={styles.container}>
      <canvas ref={canvasRef} className={styles.canvas} />

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
              Round {roundNumber - 1} Complete
            </div>
            <div className={styles.roundSummaryWinner}>
              🏆 {roundWinner} wins the round!
            </div>
            <div className={styles.scoreboard}>
              {scoreboard.map((entry) => (
                <div key={entry.player_index} className={styles.scoreRow}>
                  <span className={styles.scoreName}>{entry.nickname}</span>
                  <span className={styles.scoreVal}>
                    {entry.score} pts &middot; {entry.rounds_won}W
                  </span>
                </div>
              ))}
            </div>
            <div style={{ color: '#666', fontSize: '0.8rem' }}>
              Next round starting…
            </div>
          </div>
        </div>
      )}

      {unoDeclared && <div className={styles.unoBanner}>UNO!</div>}

      {/* Round indicator */}
      {matchFormat !== 'BO1' && (
        <div style={{
          position: 'absolute',
          top: 8,
          right: 12,
          color: '#aaa',
          fontSize: '0.8rem',
          fontWeight: 700,
          pointerEvents: 'none',
        }}>
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
