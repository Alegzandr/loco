import { motion, AnimatePresence } from 'framer-motion'
import { CARD_H, BOTTOM_RESERVE } from './cardTheme'
import styles from './TurnIndicator.module.css'

export interface TurnTexts {
  yourTurn: string
  drawOrCounter: string  // contains %n placeholder
  playerTurnSuffix: string
}

interface Props {
  isMyTurn: boolean
  pendingDraw: number
  currentTurn: number
  players: { index: number; nickname: string }[]
  height: number
  texts: TurnTexts
}

export function TurnIndicator({ isMyTurn, pendingDraw, currentTurn, players, height, texts }: Props) {
  let msg: string
  if (isMyTurn) {
    msg = pendingDraw > 0
      ? texts.drawOrCounter.replace('%n', String(pendingDraw))
      : texts.yourTurn
  } else {
    const nick = players.find((p) => p.index === currentTurn)?.nickname ?? '?'
    msg = `${nick}${texts.playerTurnSuffix}`
  }
  const isPenalty = isMyTurn && pendingDraw > 0
  const cls = [
    styles.indicator,
    isMyTurn ? styles.mine : styles.theirs,
    isPenalty ? styles.penalty : '',
  ].filter(Boolean).join(' ')

  // Sits clear above the hand: the fan's playable cards lift by 9px and the
  // pill is ~38px tall, so anything tighter than this overlaps the cards.
  const top = height - CARD_H - BOTTOM_RESERVE - 58

  return (
    <div className={styles.anchor} style={{ top }}>
      {/* Keyed on the message so a turn change crossfades instead of swapping text
          mid-glance. The wrapper holds the centering transform. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={msg}
          className={cls}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          {msg}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
