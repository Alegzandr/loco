import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { CardDTO, CardColor, ClientMsg } from '../types/protocol'
import { useGameStore, SwapNotice, UNO_CATCH_WINDOW_MS } from '../hooks/useGameStore'
import { useDrainBar } from '../hooks/useDrainBar'
import { useCountdown } from '../hooks/useCountdown'
import { useReconnectAnimation } from '../hooks/useReconnectAnimation'
import { useHeldKey } from '../hooks/useHeldKey'
import { useI18n } from '../i18n'
import { Translations } from '../i18n/en'
import { resolveServerError } from '../i18n/serverErrors'
import { WsStatus } from '../hooks/useWebSocket'
import { RulesModal } from './RulesModal'
import { UnoTimer } from './UnoTimer'
import { ColorPicker } from './ColorPicker'
import { PlayerPicker } from './PlayerPicker'
import { ActionBar } from './ActionBar'
import { RoundSummary } from './RoundSummary'
import { ScoreTable } from './ScoreTable'
import { InterruptBanner } from './InterruptBanner'
import { ThemeToggle } from './ThemeToggle'
import { AudioSettings } from './AudioSettings'
import { playSfx } from '../audio/sfx'
import { clientMayInterrupt, clientMayPlay, isCounterCard } from './interruptHelpers'
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
  // play_card, `counter` to counter_draw (a +4 answering a pending stack still
  // names a colour); `copies` carries a batch slam through the colour prompt.
  const [colorPicker, setColorPicker] = useState<
    { card: CardDTO; idx: number; interrupt?: boolean; counter?: boolean; copies?: CardDTO[] } | null
  >(null)
  const [playerPicker, setPlayerPicker] = useState<
    { card: CardDTO; idx: number; interrupt?: boolean } | null
  >(null)
  const lastActionRef = useRef<number>(0)
  const [showRules, setShowRules] = useState(false)
  // Touch devices have no TAB key, so the same table is also pinned open by a
  // button in the top cluster. Held and pinned are separate states on purpose:
  // releasing TAB must never close a table the player deliberately pinned.
  const [pinnedScores, setPinnedScores] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  // Countdown bars are written to directly, never through state: see useDrainBar.
  const turnFillRef = useRef<HTMLDivElement>(null)
  const turnTrackRef = useRef<HTMLDivElement>(null)
  const catchFillRef = useRef<HTMLDivElement>(null)

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
    roundHistory,
    latencies,
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
    pruneCatchWindows,
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
        // Wilds can take the lead too, and they still need their colour named
        // global_switch included: it rotates the hands *and* sets the colour.
        if (card.kind === 'wild' || card.kind === 'wild_draw_four' || card.kind === 'global_switch') {
          setColorPicker({
            card,
            idx: cardIdx,
            interrupt: true,
            copies: card.kind === 'global_switch' ? undefined : batch,
          })
          return
        }
        if (card.kind === 'swap') {
          setPlayerPicker({ card, idx: cardIdx, interrupt: true })
          return
        }
        onSend({ type: 'interrupt_play_card', card, play_cards: batch })
        return
      }
      // Answering a pending +2/+4 stack is its own message. Any matching draw
      // card counters, whatever its colour — the server compares kinds only.
      // Sending play_card here is always refused ("must counter or draw pending
      // penalty cards first"), which used to make stacking unreachable by tap.
      if (pendingDraw > 0) {
        if (!isCounterCard(card, discard, pendingDraw)) return
        if (card.kind === 'wild_draw_four') {
          setColorPicker({ card, idx: cardIdx, counter: true })
          return
        }
        onSend({ type: 'counter_draw', card, chosen_color: card.color })
        return
      }
      if (card.kind === 'wild' || card.kind === 'wild_draw_four' || card.kind === 'global_switch') {
        setColorPicker({ card, idx: cardIdx })
        return
      }
      if (card.kind === 'swap') {
        setPlayerPicker({ card, idx: cardIdx })
        return
      }
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

  // A picker is a promise about a board that no longer exists once a card lands.
  // Someone interjecting on top of the discard you were about to answer (the
  // classic case is a second GlobalSwitch stealing the lead) invalidates both
  // the colour and the swap target you were choosing, and the server would
  // refuse the play anyway. Close them: the interjecter now owns the choice.
  useEffect(() => {
    if (!lastPlay) return
    setColorPicker(null)
    setPlayerPicker(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPlay?.at])

  // Reconnect visual recovery: 600ms overlay → board fades back in via GameBoard's
  // internal rebuildKey effect.
  const showReconnectOverlay = useReconnectAnimation(
    isReconnecting,
    () => setIsReconnecting(false),
  )

  // UNO catch + per-turn countdown bars. Both drain through a CSS animation
  // armed once per deadline (useDrainBar) rather than a per-frame state
  // update: the board must not re-render sixty times a second just to move a
  // 6px bar. UNO uses the fixed 5000ms catch window; the turn timer anchors to
  // whatever time remained when the deadline became active, since the server
  // re-arms it on a draw.
  // The catch bar is only mounted once a target is on the hook, so the deadline
  // handed to the hook has to go null with it, otherwise the effect would not
  // re-run when the element finally appears, and the bar would never arm.
  const catchDeadline = catchTarget !== null ? unoTimerEnd : null
  useDrainBar(turnFillRef, turnDeadline, 'auto', turnTrackRef, styles.turnTimerUrgent)
  useDrainBar(catchFillRef, catchDeadline, UNO_CATCH_WINDOW_MS)

  // Retire each catch window locally when it runs out. Only the expired ones
  // go: after a Swap or a GlobalSwitch several seats are on the hook with
  // different deadlines, and the next one becomes the offered catch. The server
  // enforces the same 5 s, so a late click would only earn an error toast.
  useEffect(() => {
    if (unoTimerEnd === null) return
    const remaining = unoTimerEnd - Date.now()
    if (remaining <= 0) {
      pruneCatchWindows()
      return
    }
    const id = setTimeout(pruneCatchWindows, remaining)
    return () => clearTimeout(id)
  }, [unoTimerEnd, pruneCatchWindows])

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

  // Hold TAB for the standings. Disabled while a dialog owns the screen: inside
  // the rules modal or a picker, TAB still belongs to the dialog's own focus
  // order, and the summary already shows the same numbers.
  const scoresHeld = useHeldKey(
    'Tab',
    !showRules && !colorPicker && !playerPicker && !showRoundSummary,
  )
  const showScores = scoresHeld || pinnedScores

  const isMyTurn = currentTurn === myIndex
  // True when the player has at least one card they can legally play right now.
  // Used to de-emphasize the Draw button so it doesn't look like the required action.
  const hasPlayableCard = isMyTurn && myHand.some(c => clientMayPlay(c, discard, activeColor, pendingDraw))
  // While a penalty is pending the only legal cards are the ones that stack it,
  // so "can I play something" and "can I counter" are the same question.
  const canCounter = pendingDraw > 0 && hasPlayableCard

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

  // <GameBoard /> is memoised, and it is the expensive half of the screen: seat
  // layout, hand slots and every card are re-derived on each of its renders.
  // These two used to be an object literal and an arrow in the JSX, which
  // handed it a new identity on every parent render, so a latency broadcast, an
  // error toast or a catch window would have rebuilt the whole board.
  const turnTexts = useMemo(
    () => ({
      yourTurn: t.yourTurn,
      drawOrCounter: t.drawOrCounter,
      drawPenalty: t.drawPenalty,
      playerTurnSuffix: t.playerTurnSuffix,
    }),
    [t],
  )
  const handleDraw = useCallback(
    () => guardDoubleTap(() => onSend({ type: 'draw_card' })),
    [guardDoubleTap, onSend],
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
        canCounter={canCounter}
        isPlayable={cardIsPlayable}
        isInteractive={cardIsInteractive}
        onCardClick={handleCardClick}
        turnTexts={turnTexts}
        fxTexts={fxTexts}
        swapNotice={swapNotice}
        lastPlay={lastPlay}
        isReconnecting={isReconnecting || showReconnectOverlay}
        canDraw={isMyTurn && (pendingDraw > 0 || !hasDrawn)}
        onDraw={handleDraw}
        drawLabel={pendingDraw > 0 ? `${t.drawPile} +${pendingDraw}` : t.drawPile}
      />

      {/* Per-turn countdown bar, shown whenever a deadline is active.
          Both the emptying and the colour are driven by useDrainBar, which
          never re-renders: see the hook for why that matters here. */}
      {turnDeadline !== null && (
        <div ref={turnTrackRef} className={styles.turnTimerBar}>
          <div ref={turnFillRef} className={`${styles.turnTimerFill} loco-heat`} />
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
        <UnoTimer fillRef={catchFillRef} label={t.catchWindow} />
      )}

      {/* Action bar */}
      <ActionBar
        isMyTurn={isMyTurn}
        pendingDraw={pendingDraw}
        handSize={myHand.length}
        hasDrawn={hasDrawn}
        hasPlayableCard={hasPlayableCard}
        canCatch={catchTarget !== null}
        onDraw={handleDraw}
        onPass={() => guardDoubleTap(() => onSend({ type: 'pass_turn' }))}
        onUno={() => guardDoubleTap(() => onSend({ type: 'declare_uno' }))}
        // Name the seat: several players can owe a declaration at once after a
        // Swap or a GlobalSwitch, and the button offers the most urgent one.
        onCatch={() =>
          guardDoubleTap(() => {
            if (catchTarget === null) return
            onSend({ type: 'catch_uno', target_index: catchTarget })
          })
        }
        t={t}
      />

      {/* Fixed Rules button + theme toggle — top-right corner, never shifts with action bar */}
      <div className={styles.topRight}>
        <button
          className={styles.rulesBtn}
          aria-pressed={pinnedScores}
          onClick={() => setPinnedScores((v) => !v)}
        >
          {t.scoreTableBtn}
        </button>
        <ThemeToggle />
        <AudioSettings />
        <button className={styles.rulesBtn} onClick={() => setShowRules(true)}>
          {t.rulesBtn}
        </button>
      </div>

      {/* Standings: held open with TAB, or pinned by the button above. */}
      {showScores && (
        <ScoreTable
          players={players}
          scoreboard={scoreboard}
          roundHistory={roundHistory}
          latencies={latencies}
          myIndex={myIndex}
          t={t}
          onDismiss={pinnedScores ? () => setPinnedScores(false) : undefined}
        />
      )}

      {/* In-game refusal. Sits over the empty upper felt, never over the hand:
          it used to be pinned at the action bar's reserve height, which put it
          straight across the cards it was complaining about. */}
      {errorMsg && (
        <div className={styles.errorToast} role="alert">
          {resolveServerError(errorMsg, t.errors)}
        </div>
      )}

      {/* Wild color picker — serves both a normal play and an out-of-turn slam. */}
      {colorPicker && (
        <ColorPicker
          label={t.chooseColor}
          onChoose={(col: CardColor) => {
            onSend({
              type: colorPicker.interrupt
                ? 'interrupt_play_card'
                : colorPicker.counter
                  ? 'counter_draw'
                  : 'play_card',
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
