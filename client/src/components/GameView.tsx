import { useEffect, useRef, useState, useCallback } from 'react'
import { PixiGame } from '../game/PixiGame'
import { CardDTO, CardColor, ClientMsg } from '../types/protocol'
import { useGameStore, SwapNotice } from '../hooks/useGameStore'
import { useProgressTimer } from '../hooks/useProgressTimer'
import { useI18n } from '../i18n'
import { Translations } from '../i18n/en'
import { WsStatus } from '../hooks/useWebSocket'
import { RulesModal } from './RulesModal'
import { UnoTimer } from './UnoTimer'
import { ColorPicker } from './ColorPicker'
import { PlayerPicker } from './PlayerPicker'
import { ActionBar } from './ActionBar'
import { RoundSummary } from './RoundSummary'
import { clientMayInterrupt } from './interruptHelpers'
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
    // Only the exact same kind as the top discard card can counter (mirrors server CounterDraw).
    // e.g. +2 can only be countered by +2; +4 can only be countered by +4.
    if (!discard) return false
    return card.kind === discard.kind && (card.kind === 'draw_two' || card.kind === 'wild_draw_four')
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
  wsStatus: WsStatus
}

const UNO_WINDOW_MS = 5000
const ROUND_SUMMARY_AUTO_DISMISS_MS = 8000
const SWAP_NOTICE_MS = 3500

// resolveSwapNoticeText picks the right i18n template (with you-as-actor / you-as-target
// variants for swap, or cw/ccw for global_switch) and substitutes %actor / %target.
function resolveSwapNoticeText(
  notice: SwapNotice,
  myIndex: number,
  players: { index: number; nickname: string }[],
  t: Translations,
): string {
  const actor = players.find((p) => p.index === notice.actorIndex)?.nickname ?? `P${notice.actorIndex}`
  const target = notice.targetIndex >= 0
    ? (players.find((p) => p.index === notice.targetIndex)?.nickname ?? `P${notice.targetIndex}`)
    : ''
  if (notice.kind === 'swap') {
    const tpl = notice.actorIndex === myIndex
      ? t.swapNoticeYouActor
      : notice.targetIndex === myIndex
        ? t.swapNoticeYouTarget
        : t.swapNotice
    return tpl.replace('%actor', actor).replace('%target', target)
  }
  // direction === 1 means clockwise (next-seat); -1 means counter-clockwise.
  const tpl = notice.direction >= 0 ? t.globalSwitchNoticeCw : t.globalSwitchNoticeCcw
  return tpl.replace('%actor', actor)
}

export function GameView({ onSend, wsStatus }: Props) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pixiRef = useRef<PixiGame | null>(null)
  // Tracks when PixiJS async init completes so the render effect can fire even
  // if no game-state deps changed between component mount and init completion.
  const [pixiReady, setPixiReady] = useState(false)
  const [colorPicker, setColorPicker] = useState<{ card: CardDTO; idx: number } | null>(null)
  const [playerPicker, setPlayerPicker] = useState<{ card: CardDTO; idx: number } | null>(null)
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
    unoDeclaredByIndex,
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
    swapNotice,
    dismissRoundSummary,
    setIsReconnecting,
    setSwapNotice,
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
      // Out-of-turn path: realtime "lead-taking" interrupt. If the tapped card
      // is an exact match of the top discard, send interrupt_play_card (the
      // server enforces the time window and ordering). Otherwise ignore the tap.
      if (currentTurn !== myIndex) {
        if (!clientMayInterrupt(card, discard, pendingDraw)) return
        // Auto-batch: if the player holds multiple identical copies, send them all
        // in a single interrupt — the rule allows playing any number of identical
        // matching cards together.
        const copies = myHand.filter(
          (c) => c.color === card.color && c.kind === card.kind && c.value === card.value,
        )
        const game = pixiRef.current
        if (game) {
          const { width, height } = game.app.screen
          game.animateCardPlay(card, cardIdx, width, height)
        }
        onSend({
          type: 'interrupt_play_card',
          card,
          play_cards: copies.length > 1 ? copies : undefined,
        })
        return
      }
      if (card.kind === 'wild' || card.kind === 'wild_draw_four') {
        setColorPicker({ card, idx: cardIdx })
        return
      }
      if (card.kind === 'swap') {
        setPlayerPicker({ card, idx: cardIdx })
        return
      }
      // global_switch: play immediately (no picker needed)
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
    [currentTurn, myIndex, discard, activeColor, pendingDraw, myHand, onSend]
  )

  // Stable ref so PixiGame always invokes the latest handleCardClick
  // even though the PixiGame instance is created once in the init effect below.
  const onCardClickRef = useRef(handleCardClick)
  onCardClickRef.current = handleCardClick

  // Expose playCard on the E2E helper object (dev mode only).
  // This lets Playwright trigger a card play via handleCardClick without needing
  // to find and click the exact pixel on the PixiJS canvas.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (!window.__LOCO_E2E__) window.__LOCO_E2E__ = {}
    window.__LOCO_E2E__.playCard = (card: CardDTO) => {
      const idx = myHand.findIndex(
        (c) => c.color === card.color && c.kind === card.kind && c.value === card.value,
      )
      handleCardClick(card, Math.max(0, idx))
    }
  }, [handleCardClick, myHand])

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
          turnTexts: { yourTurn: t.yourTurn, drawOrCounter: t.drawOrCounter, playerTurnSuffix: t.playerTurnSuffix } },
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
      turnTexts: { yourTurn: t.yourTurn, drawOrCounter: t.drawOrCounter, playerTurnSuffix: t.playerTurnSuffix },
    })
  }, [myHand, discard, activeColor, players, myIndex, currentTurn, pendingDraw, isReconnecting, t, pixiReady])

  // UNO catch + per-turn countdown bars: drive a percent from the deadline.
  // UNO uses the fixed 5000ms catch window; turn timer anchors to whatever
  // time remained when the deadline became active.
  const timerPct = useProgressTimer(unoTimerEnd, UNO_WINDOW_MS)
  const turnTimerPct = useProgressTimer(turnDeadline, 'auto')

  // Auto-clear swap/global_switch notice after a short window, and trigger
  // the matching PixiJS animation so the hand movement reads visually.
  useEffect(() => {
    if (!swapNotice) return
    const game = pixiRef.current
    if (game) {
      if (swapNotice.kind === 'swap' && swapNotice.targetIndex >= 0) {
        game.animateSwap(swapNotice.actorIndex, swapNotice.targetIndex, players, myIndex)
      } else if (swapNotice.kind === 'global_switch') {
        game.animateGlobalSwitch(swapNotice.direction, players, myIndex)
      }
    }
    const id = setTimeout(() => setSwapNotice(null), SWAP_NOTICE_MS)
    return () => clearTimeout(id)
    // Triggered once per notice (keyed by .at); deps intentionally minimal so the
    // animation does not replay when only `players` changes mid-notice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapNotice?.at])

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

      {/* Reconnect overlay — server-triggered (player_reconnected) */}
      {showReconnectOverlay && (
        <div className={styles.reconnectOverlay}>
          <div className={styles.reconnectCard}>
            <div className={styles.reconnectSpinner} />
            <div className={styles.reconnectText}>{t.reconnected}</div>
            <div className={styles.reconnectSub}>{t.rebuildingTable}</div>
          </div>
        </div>
      )}

      {/* WS overlay — shown when the WebSocket transport is down mid-game.
          Prevents the blank-canvas regression where the board renders empty
          because no game_state arrives while the socket is reconnecting. */}
      {wsStatus !== 'open' && (
        <div className={styles.reconnectOverlay}>
          <div className={styles.reconnectCard}>
            <div className={styles.reconnectSpinner} />
            <div className={styles.reconnectText}>{t.wsLostConnection}</div>
            <div className={styles.reconnectSub}>{t.wsReconnecting}</div>
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

      {/* Swap player picker */}
      {playerPicker && (
        <PlayerPicker
          label={t.choosePlayer}
          players={players.filter((p) => p.index !== myIndex)}
          onChoose={(targetIdx: number) => {
            const game = pixiRef.current
            if (game) {
              const { width, height } = game.app.screen
              game.animateCardPlay(playerPicker.card, playerPicker.idx, width, height)
            }
            onSend({ type: 'play_card', card: playerPicker.card, chosen_player: targetIdx })
            setPlayerPicker(null)
          }}
          onCancel={() => setPlayerPicker(null)}
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

      {swapNotice && (
        <div key={swapNotice.at} className={styles.swapNotice}>
          {resolveSwapNoticeText(swapNotice, myIndex, players, t)}
        </div>
      )}

      {unoDeclared && (
        <div className={styles.unoBanner}>
          {unoDeclaredByIndex >= 0 && players.find(p => p.index === unoDeclaredByIndex)?.nickname
            ? `${players.find(p => p.index === unoDeclaredByIndex)!.nickname}: ${t.unoBanner}`
            : t.unoBanner}
        </div>
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
