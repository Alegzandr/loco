import React from 'react'
import styles from './GameOver.module.css'

interface Props {
  winner: string
  myNickname: string
}

export function GameOver({ winner, myNickname }: Props) {
  const isWinner = winner === myNickname

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.emoji}>{isWinner ? '🏆' : '😔'}</div>
        <h2 className={styles.heading}>{isWinner ? 'You Win!' : 'Game Over'}</h2>
        {!isWinner && <p className={styles.sub}>{winner} wins!</p>}
        <button className={styles.btn} onClick={() => window.location.reload()}>
          Play Again
        </button>
      </div>
    </div>
  )
}
