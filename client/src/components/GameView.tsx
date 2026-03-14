import React, { useEffect, useRef, useState, useCallback } from 'react'
import { PixiGame } from '../game/PixiGame'
import { CardDTO, CardColor, ClientMsg } from '../types/protocol'
import { useGameStore } from '../hooks/useGameStore'
import styles from './GameView.module.css'

interface Props {
  onSend: (msg: ClientMsg) => void
}

const WILD_COLORS: CardColor[] = ['red', 'yellow', 'green', 'blue']

export function GameView({ onSend }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pixiRef = useRef<PixiGame | null>(null)
  const [colorPicker, setColorPicker] = useState<CardDTO | null>(null)

  const {
    myHand,
    players,
    discard,
    activeColor,
    currentTurn,
    myIndex,
    pendingDraw,
    unoDeclared,
  } = useGameStore()

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

  const isMyTurn = currentTurn === myIndex

  return (
    <div className={styles.container}>
      <canvas ref={canvasRef} className={styles.canvas} />

      {/* Action bar */}
      <div className={styles.actionBar}>
        {isMyTurn && pendingDraw > 0 && (
          <button className={styles.btnDraw} onClick={() => onSend({ type: 'draw_card' })}>
            Draw {pendingDraw}
          </button>
        )}
        {isMyTurn && pendingDraw === 0 && (
          <>
            <button className={styles.btnDraw} onClick={() => onSend({ type: 'draw_card' })}>
              Draw
            </button>
            <button className={styles.btnPass} onClick={() => onSend({ type: 'pass_turn' })}>
              Pass
            </button>
          </>
        )}
        <button
          className={styles.btnUno}
          onClick={() => onSend({ type: 'declare_uno' })}
          disabled={myHand.length !== 1}
        >
          UNO!
        </button>
        <button className={styles.btnCatch} onClick={() => onSend({ type: 'catch_uno' })}>
          Catch!
        </button>
      </div>

      {/* Wild color picker overlay */}
      {colorPicker && (
        <div className={styles.overlay}>
          <div className={styles.colorPicker}>
            <p>Choose a color</p>
            {WILD_COLORS.map((col) => (
              <button
                key={col}
                className={styles.colorBtn}
                style={{ background: colorHex(col) }}
                onClick={() => {
                  onSend({ type: 'play_card', card: colorPicker, chosen_color: col })
                  setColorPicker(null)
                }}
              />
            ))}
          </div>
        </div>
      )}

      {unoDeclared && <div className={styles.unoBanner}>UNO!</div>}
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
