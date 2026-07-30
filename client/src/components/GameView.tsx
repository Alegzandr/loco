import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { CardDTO, CardColor, ClientMsg } from '../types/protocol'
import { useGameStore, SwapNotice, UNO_CATCH_WINDOW_MS } from '../hooks/useGameStore'
import { useProgressTimer } from '../hooks/useProgressTimer'
import { useCountdown } from '../hooks/useCountdown'
import { useReconnectAnimation } from '../hooks/useReconnectAnimation'
import { useI18n } from '../i18n'
import { Translations } from '../i18n/en'
import { WsStatus } from '../hooks/useWebSocket'
import { RulesModal } from './RulesModal'
import { UnoTimer } from './UnoTimer'
import { ColorPicker } from './ColorPicker'
import { PlayerPicker } from './PlayerPicker'
import { ActionBar } from './ActionBar'
import { RoundSummary } from './RoundSummary'
import { InterruptBanner } from './InterruptBanner'
import { ThemeToggle } from './ThemeToggle'
import { AudioSettings } from './AudioSettings'
import { playSfx } from '../audio/sfx'
import { clientMayInterrupt, clientMayPlay } from './interruptHelpers'
import { GameBoard } from './cards/GameBoard'
import styles from './GameView.module.css'

interface Props {
  onSend: (msg: ClientMsg) => void
  wsStatus: WsStatus
}

const ROUND_SUMMARY_AUTO_DISMISS_MS = 8000
const SWAP_NOTICE_MS = 3500
/** Seconds of remaining turn time at which the countdown ticks start. */
const TURN_COUNTDOWN_FROM = 5

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
  // `interrupt` routes the confirmed choice to interrupt_play_card instead of
  // play_card; `copies` carries a batch slam through the colour prompt.
  const [colorPicker, setColorPicker] = useState<
    { card: CardDTO; idx: number; interrupt?: boolean; copies?: CardDTO[] } | null
  >(null)
  const [playerPicker, setPlayerPicker] = useState<
    { card: CardDTO; idx: number; interrupt?: boolean } | null
  >(null)
  const lastActionRef = useRef<number>(0)
  const [showRules, setShowRules] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

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
    catchTarget,
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
    lastPlay,
    interruptFlash,
    dismissRoundSummary,
    setIsReconnecting,
    setSwapNotice,
    clearCatchWindow,
    clearInterrupt,
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
        // matching cards together. Swap and global_switch never batch.
        const copies = myHand.filter(
          (c) => c.color === card.color && c.kind === card.kind && c.value === card.value,
        )
        const batch = copies.length > 1 ? copies : undefined
        // Wilds can take the lead too, and they still need their colour named.
        // global_switch carries no colour choice, so it goes straight out.
        if (card.kind === 'wild' || card.kind === 'wild_draw_four') {
          setColorPicker({ card, idx: cardIdx, interrupt: true, copies: batch })
          return
        }
        if (card.kind === 'swap') {
          setPlayerPicker({ card, idx: cardIdx, interrupt: true })
          return
        }
        onSend({
          type: 'interrupt_play_card',
          card,
          play_cards: card.kind === 'global_switch' ? undefined : batch,
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
      // global_switch: play immediately (no picker needed).
      // Block clearly-invalid plays so there's no "fake" play UI flash.
      // Server is always authoritative; this is a UX hint only.
      if (!clientMayPlay(card, discard, activeColor, pendingDraw)) return
      onSend({ type: 'play_card', card, chosen_color: card.color })
    },
    [currentTurn, myIndex, discard, activeColor, pendingDraw, myHand, onSend]
  )

  // Expose playCard on the E2E helper (dev mode only).
  // Playwright drives the React renderer through the same handler real taps use.
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

  // Reconnect visual recovery: 600ms overlay → board fades back in via GameBoard's
  // internal rebuildKey effect.
  const showReconnectOverlay = useReconnectAnimation(
    isReconnecting,
    () => setIsReconnecting(false),
  )

  // UNO catch + per-turn countdown bars: drive a percent from the deadline.
  // UNO uses the fixed 5000ms catch window; turn timer anchors to whatever
  // time remained when the deadline became active.
  const timerPct = useProgressTimer(unoTimerEnd, UNO_CATCH_WINDOW_MS)
  const turnTimerPct = useProgressTimer(turnDeadline, 'auto')

  // Close the catch window locally when it runs out. The server enforces the
  // same 5 s deadline, so a late click would only earn an error toast.
  useEffect(() => {
    if (unoTimerEnd === null) return
    const remaining = unoTimerEnd - Date.now()
    if (remaining <= 0) {
      clearCatchWindow()
      return
    }
    const id = setTimeout(clearCatchWindow, remaining)
    return () => clearTimeout(id)
  }, [unoTimerEnd, clearCatchWindow])

  // Auto-clear the swap / global_switch notice after a short window.
  // The matching trail animation lives in <GameBoard /> (keyed by swapNotice.at).
  useEffect(() => {
    if (!swapNotice) return
    const id = setTimeout(() => setSwapNotice(null), SWAP_NOTICE_MS)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapNotice?.at])

  // Interception shake. Driven through the Web Animations API rather than a CSS
  // class so a second interception replays it immediately — a class toggle would
  // need the element to remount, which would tear down the whole board.
  useEffect(() => {
    if (!interruptFlash) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    containerRef.current?.animate(
      [
        { transform: 'translate(0, 0)' },
        { transform: 'translate(-11px, 6px)' },
        { transform: 'translate(9px, -5px)' },
        { transform: 'translate(-6px, 3px)' },
        { transform: 'translate(3px, -2px)' },
        { transform: 'translate(0, 0)' },
      ],
      { duration: 420, easing: 'ease-out' },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interruptFlash?.at])

  // Countdown ticks over the last few seconds of our own turn. Time pressure is
  // the one piece of state a spectator cannot read off the board, and the bar at
  // the top of the screen is not where anyone is looking.
  useEffect(() => {
    if (turnDeadline === null || currentTurn !== myIndex) return
    let lastTick = -1
    const id = setInterval(() => {
      const left = Math.ceil((turnDeadline - Date.now()) / 1000)
      if (left <= 0 || left > TURN_COUNTDOWN_FROM || left === lastTick) return
      lastTick = left
      playSfx('countdown')
    }, 200)
    return () => clearInterval(id)
  }, [turnDeadline, currentTurn, myIndex])

  // Auto-clear in-game error messages after 2.5 seconds
  useEffect(() => {
    if (!errorMsg) return
    const t = setTimeout(clearError, 2500)
    return () => clearTimeout(t)
  }, [errorMsg, clearError])

  // Auto-dismiss round summary countdown — runs while the summary is visible.
  const summaryCountdown = useCountdown(showRoundSummary, ROUND_SUMMARY_AUTO_DISMISS_MS, dismissRoundSummary)

  // Memoised: <GameBoard /> lists fxTexts in an effect's dependency array, and a
  // fresh object literal each render would replay the callout on every update.
  const fxTexts = useMemo(() => ({ skip: t.fxSkip, reverse: t.fxReverse }), [t])

  const isMyTurn = currentTurn === myIndex
  // True when the player has at least one card they can legally play right now.
  // Used to de-emphasize the Draw button so it doesn't look like the required action.
  const hasPlayableCard = isMyTurn && myHand.some(c => clientMayPlay(c, discard, activeColor, pendingDraw))

  // Predicates passed to <GameBoard />: highlight what can be played right now.
  // Off-turn that means exact-match slams, on-turn the normal legality rules —
  // both delegated so the highlight can never drift from what a tap will do.
  const cardIsPlayable = useCallback(
    (card: CardDTO): boolean =>
      isMyTurn
        ? clientMayPlay(card, discard, activeColor, pendingDraw)
        : clientMayInterrupt(card, discard, pendingDraw),
    [isMyTurn, discard, activeColor, pendingDraw],
  )
  const cardIsInteractive = useCallback(
    (card: CardDTO): boolean =>
      isMyTurn || clientMayInterrupt(card, discard, pendingDraw),
    [isMyTurn, discard, pendingDraw],
  )

  return (
    <div className={styles.container} ref={containerRef}>
      {/* drawLabel is deliberately not the Draw button's string: two controls
          sharing an accessible name is ambiguous for screen readers and for
          anything else that addresses controls by name. */}
      <GameBoard
        myHand={myHand}
        discard={discard}
        activeColor={activeColor}
        players={players}
        myIndex={myIndex}
        currentTurn={currentTurn}
        pendingDraw={pendingDraw}
        isPlayable={cardIsPlayable}
        isInteractive={cardIsInteractive}
        onCardClick={handleCardClick}
        turnTexts={{ yourTurn: t.yourTurn, drawOrCounter: t.drawOrCounter, playerTurnSuffix: t.playerTurnSuffix }}
        fxTexts={fxTexts}
        swapNotice={swapNotice}
        lastPlay={lastPlay}
        isReconnecting={isReconnecting || showReconnectOverlay}
        canDraw={isMyTurn && (pendingDraw > 0 || !hasDrawn)}
        onDraw={() => guardDoubleTap(() => onSend({ type: 'draw_card' }))}
        drawLabel={pendingDraw > 0 ? `${t.drawPile} +${pendingDraw}` : t.drawPile}
      />

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
          Prevents the blank-board regression where the board renders empty
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

      {/* Catch window — runs while somebody is sitting on one uncalled card. */}
      {catchTarget !== null && unoTimerEnd !== null && (
        <UnoTimer timerPct={timerPct} label={t.catchWindow} />
      )}

      {/* Action bar */}
      <ActionBar
        isMyTurn={isMyTurn}
        pendingDraw={pendingDraw}
        handSize={myHand.length}
        hasDrawn={hasDrawn}
        hasPlayableCard={hasPlayableCard}
        canCatch={catchTarget !== null}
        onDraw={() => guardDoubleTap(() => onSend({ type: 'draw_card' }))}
        onPass={() => guardDoubleTap(() => onSend({ type: 'pass_turn' }))}
        onUno={() => guardDoubleTap(() => onSend({ type: 'declare_uno' }))}
        onCatch={() => guardDoubleTap(() => onSend({ type: 'catch_uno' }))}
        t={t}
      />

      {/* Fixed Rules button + theme toggle — top-right corner, never shifts with action bar */}
      <div className={styles.topRight}>
        <ThemeToggle />
        <AudioSettings />
        <button className={styles.rulesBtn} onClick={() => setShowRules(true)}>
          {t.rulesBtn}
        </button>
      </div>

      {/* In-game error toast */}
      {errorMsg && <div className={styles.errorToast}>{errorMsg}</div>}

      {/* Wild color picker — serves both a normal play and an out-of-turn slam. */}
      {colorPicker && (
        <ColorPicker
          label={t.chooseColor}
          onChoose={(col: CardColor) => {
            onSend({
              type: colorPicker.interrupt ? 'interrupt_play_card' : 'play_card',
              card: colorPicker.card,
              chosen_color: col,
              play_cards: colorPicker.copies,
            })
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
            onSend({
              type: playerPicker.interrupt ? 'interrupt_play_card' : 'play_card',
              card: playerPicker.card,
              chosen_player: targetIdx,
            })
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

      <InterruptBanner
        flash={interruptFlash}
        myIndex={myIndex}
        players={players}
        t={t}
        onDone={clearInterrupt}
      />

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
