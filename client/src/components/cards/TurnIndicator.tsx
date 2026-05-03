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

  // Match the Pixi position: 36px above the top of the hand slots.
  const top = height - CARD_H - BOTTOM_RESERVE - 36

  return <div className={cls} style={{ top }}>{msg}</div>
}
