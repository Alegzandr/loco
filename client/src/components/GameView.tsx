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
import { RulesButton } from './RulesButton'
import { RulesModal } from './RulesModal'
import { UnoTimer } from './UnoTimer'
import { ColorPicker } from './ColorPicker'
import { PlayerPicker } from './PlayerPicker'
import { ActionBar } from './ActionBar'
import { RoundSummary } from './RoundSummary'
import { ScoreTable } from './ScoreTable'
import { InterruptBanner } from './InterruptBanner'
import { CatchBanner } from './CatchBanner'
import { ThemeToggle } from './ThemeToggle'
import { AudioSettings } from './AudioSettings'
import { playSfx } from '../audio/sfx'
import { clientMayInterrupt, clientMayPlay, isCounterCard } from './interruptHelpers'
import { GameBoard, GameBoardHandle } from './cards/GameBoard'
import { resolveMap } from './cards/maps'
import { MapLoadingScreen } from './MapLoadingScreen'
import { OpponentAway } from './OpponentAway'
import { ServerUpdating } from './ServerUpdating'
import { useMapPreload } from '../hooks/useMapPreload'
import styles from './GameView.module.css'

interface Props {
  onSend: (msg: ClientMsg) => void
  wsStatus: WsStatus
}

const ROUND_SUMMARY_AUTO_DISMISS_MS = 8000
const SWAP_NOTICE_MS = 3500
const CATCH_FAIL_NOTICE_MS = 2800
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
  // Per-control timestamp of the last accepted tap; see guardDoubleTap.
  const lastActionRef = useRef<Map<string, number>>(new Map())
  const [showRules, setShowRules] = useState(false)
  // Touch devices have no TAB key, so the same table is also pinned open by a
  // button in the top cluster. Held and pinned are separate states on purpose:
  // releasing TAB must never close a table the player deliberately pinned.
  const [pinnedScores, setPinnedScores] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  // The board fills this in; the pickers use it to animate a play that was only
  // confirmed once a colour or a target was named.
  const flightRef = useRef<GameBoardHandle | null>(null)
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
    direction,
    myIndex,
    pendingDraw,
    hasDrawn,
    unoDeclared,
    unoDeclaredByIndex,
    myDeclared,
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
    mapId,
    mapLoading,
    isReconnecting,
    opponentAway,
    serverUpdating,
    errorMsg,
    swapNotice,
    catchFailed,
    catchFlash,
    lastPlay,
    interruptFlash,
    dismissRoundSummary,
    setIsReconnecting,
    setSwapNotice,
    pruneCatchWindows,
    noteCatchAttempt,
    clearCatchFailed,
    clearCatchFlash,
    clearInterrupt,
    clearError,
  } = useGameStore()

  // Swallows the second half of a double-tap on the same control, and only on
  // the same control. It used to be one shared 400ms lockout across every
  // action, which silently ate the most ordinary sequence in the game: draw,
  // then pass. Same for declaring LOCO! and catching in the same breath, or
  // catching a second seat after a Swap put two players on one card. In a game
  // whose windows are measured in seconds, a control that ignores a deliberate
  // tap because a *different* control was used 300ms ago reads as a dead button.
  // The catch key carries its target for that reason: two seats are two taps.
  const guardDoubleTap = useCallback((key: string, fn: () => void) => {
    const now = Date.now()
    const last = lastActionRef.current.get(key) ?? 0
    if (now - last < 400) return
    lastActionRef.current.set(key, now)
    fn()
  }, [])

  // Returns true when the tap actually sent a play, which is what <GameBoard />
  // keys the hand→discard flight off. A refused card and a card that only opens
  // a prompt both return false.
  const handleCardClick = useCallback(
    (card: CardDTO, cardIdx: number): boolean => {
      // Out-of-turn path: realtime "lead-taking" interrupt. If the tapped card
      // is an exact match of the top discard, send interrupt_play_card (the
      // server enforces the time window and ordering). Otherwise ignore the tap.
      if (currentTurn !== myIndex) {
        if (!clientMayInterrupt(card, discard, pendingDraw)) return false
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
          return false
        }
        if (card.kind === 'swap') {
          setPlayerPicker({ card, idx: cardIdx, interrupt: true })
          return false
        }
        onSend({ type: 'interrupt_play_card', card, play_cards: batch })
        return true
      }
      // Answering a pending +2/+4 stack is its own message. Any matching draw
      // card counters, whatever its colour — the server compares kinds only.
      // Sending play_card here is always refused ("must counter or draw pending
      // penalty cards first"), which used to make stacking unreachable by tap.
      if (pendingDraw > 0) {
        if (!isCounterCard(card, discard, pendingDraw)) return false
        if (card.kind === 'wild_draw_four') {
          setColorPicker({ card, idx: cardIdx, counter: true })
          return false
        }
        onSend({ type: 'counter_draw', card, chosen_color: card.color })
        return true
      }
      // Block clearly-invalid plays so there's no "fake" play UI flash.
      // Server is always authoritative; this is a UX hint only.
      //
      // This has to come *before* the prompts, not after. The three wilds always
      // match, so gating them made no difference — but Swap is a coloured card
      // and obeys the ordinary matching rules, so an off-colour Swap opened its
      // target prompt, took a choice, and was refused by the server with an
      // "illegal card play" warning. Asking a question and then rejecting the
      // answer is a worse refusal than the silent one every other unplayable
      // card gives, which is what the player was reporting.
      if (!clientMayPlay(card, discard, activeColor, pendingDraw)) return false
      if (card.kind === 'wild' || card.kind === 'wild_draw_four' || card.kind === 'global_switch') {
        setColorPicker({ card, idx: cardIdx })
        return false
      }
      if (card.kind === 'swap') {
        setPlayerPicker({ card, idx: cardIdx })
        return false
      }
      onSend({ type: 'play_card', card, chosen_color: card.color })
      return true
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

  // ...and a card landing is not the only way the board moves. The turn timing
  // out, a forced draw, a fresh game_state after a Swap: none of them set
  // lastPlay, so the prompt above stayed up over a table that had gone, and the
  // choice went out against a state the server had already replaced. It came
  // back "illegal card play" *after* the player had answered a question nobody
  // should have asked, which is the one refusal this game gives that feels like
  // a broken promise rather than an illegal card.
  //
  // The condition is deliberately the same one that opened the prompt, read
  // again: a prompt is only owed while the card behind it is still playable.
  const pendingPick = colorPicker ?? playerPicker
  useEffect(() => {
    if (!pendingPick) return
    const { card, interrupt } = pendingPick
    const stillHeld = myHand.some(
      (c) => c.color === card.color && c.kind === card.kind && c.value === card.value,
    )
    const stillLegal =
      stillHeld &&
      (interrupt
        ? clientMayInterrupt(card, discard, pendingDraw)
        : currentTurn === myIndex && clientMayPlay(card, discard, activeColor, pendingDraw))
    if (stillLegal) return
    setColorPicker(null)
    setPlayerPicker(null)
  }, [pendingPick, myHand, discard, activeColor, pendingDraw, currentTurn, myIndex])

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

  // Auto-clear the missed-Contre-LOCO! notice. Same shape as the swap notice:
  // a transient piece of table news, not a state anybody has to dismiss.
  useEffect(() => {
    if (!catchFailed) return
    const id = setTimeout(clearCatchFailed, CATCH_FAIL_NOTICE_MS)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catchFailed?.at])

  // Auto-clear the swap / global_switch notice after a short window.
  // The matching trail animation lives in <GameBoard /> (keyed by swapNotice.at).
  useEffect(() => {
    if (!swapNotice) return
    const id = setTimeout(() => setSwapNotice(null), SWAP_NOTICE_MS)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapNotice?.at])

  // Screen shake, driven through the Web Animations API rather than a CSS class
  // so a second one replays immediately — a class toggle would need the element
  // to remount, which would tear down the whole board.
  const shakeScreen = useCallback((frames: Keyframe[], durationMs: number, delayMs = 0) => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const el = containerRef.current
    // Guarded like kickBoard: the Web Animations API is absent under jsdom, and
    // a missing shake must never take the banner down with it.
    if (!el || typeof el.animate !== 'function') return
    el.animate(frames, { duration: durationMs, delay: delayMs, easing: 'ease-out' })
  }, [])

  // Interception: a rattle, the board knocked sideways by a card slammed onto it.
  useEffect(() => {
    if (!interruptFlash) return
    shakeScreen(
      [
        { transform: 'translate(0, 0)' },
        { transform: 'translate(-11px, 6px)' },
        { transform: 'translate(9px, -5px)' },
        { transform: 'translate(-6px, 3px)' },
        { transform: 'translate(3px, -2px)' },
        { transform: 'translate(0, 0)' },
      ],
      420,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interruptFlash?.at])

  // Contre-LOCO!: a single vertical thump, matching the stamp coming down. The
  // two loudest moments in the game must not shake the screen the same way, or
  // a clipped highlight cannot tell them apart with the sound off.
  useEffect(() => {
    if (!catchFlash) return
    shakeScreen(
      [
        { transform: 'translate(0, 0)' },
        { transform: 'translate(0, 14px)', offset: 0.35 },
        { transform: 'translate(0, -6px)', offset: 0.62 },
        { transform: 'translate(0, 0)' },
      ],
      340,
      // Held back to the frame the stamp actually lands on: a board that jumps
      // while the verdict is still falling reads as two unrelated events.
      180,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catchFlash?.at])

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

  // The room this match is played in. Memoised because <GameBoard /> is memo'd
  // and takes it as a prop: resolveMap returns the same object for the same id,
  // but pinning it here keeps the intent explicit alongside the other stable
  // props below. null = the built-in felt (a map id we have no art for).
  const map = useMemo(() => resolveMap(mapId), [mapId])

  // Preload while the table is shut. `useMapPreload` reports when the images are
  // *decoded*, not merely downloaded: the whole point of the wait is that the
  // first turn does not spend a frame on a WebP.
  const preload = useMapPreload(map, mapLoading !== null)

  // Tell the server the moment we are in, once per gate.
  //
  // The guard is a ref rather than a dependency because `mapLoading` gets a new
  // identity on every progress broadcast (each time *another* player arrives),
  // and keying the effect on the object itself would re-send map_ready once per
  // opponent. A map we have no art for is ready immediately: there is nothing
  // to fetch, and a client that never answers is the one outcome the gate
  // cannot survive.
  const gateOpen = mapLoading !== null
  const nothingToLoad = map === null
  const sentReady = useRef(false)
  useEffect(() => {
    if (!gateOpen) {
      sentReady.current = false
      return
    }
    if (sentReady.current) return
    if (!preload.done && !nothingToLoad) return
    sentReady.current = true
    onSend({ type: 'map_ready' })
  }, [gateOpen, preload.done, nothingToLoad, onSend])

  // Memoised: <GameBoard /> lists fxTexts in an effect's dependency array, and a
  // fresh object literal each render would replay the callout on every update.
  const fxTexts = useMemo(
    () => ({ skip: t.fxSkip, reverse: t.fxReverse, colors: t.fxColors }),
    [t],
  )

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
    () => guardDoubleTap('draw', () => onSend({ type: 'draw_card' })),
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
        direction={direction}
        directionLabel={direction >= 0 ? t.directionCw : t.directionCcw}
        pendingDraw={pendingDraw}
        canCounter={canCounter}
        isPlayable={cardIsPlayable}
        isInteractive={cardIsInteractive}
        onCardClick={handleCardClick}
        flightRef={flightRef}
        turnTexts={turnTexts}
        fxTexts={fxTexts}
        swapNotice={swapNotice}
        catchFlash={catchFlash}
        lastPlay={lastPlay}
        isReconnecting={isReconnecting || showReconnectOverlay}
        map={map}
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

      {/* An opponent who dropped out of a matchmade match, and the clock their
          seat is on. Nothing sends a deadline in an ordinary room, so nothing
          renders here in one. */}
      {opponentAway && (
        <OpponentAway
          nickname={players.find((p) => p.index === opponentAway.seat)?.nickname ?? ''}
          deadline={opponentAway.deadline}
        />
      )}

      {/* A deploy is under way. The match is unaffected, which is the whole
          message: see ServerUpdating for why it is the quietest thing here. */}
      {serverUpdating && <ServerUpdating offset={opponentAway !== null} />}

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
        hasDeclared={myDeclared}
        onDraw={handleDraw}
        onPass={() => guardDoubleTap('pass', () => onSend({ type: 'pass_turn' }))}
        onUno={() => guardDoubleTap('uno', () => onSend({ type: 'declare_uno' }))}
        // Name the seat: several players can owe a declaration at once after a
        // Swap or a GlobalSwitch, and the button offers the most urgent one.
        onCatch={() =>
          guardDoubleTap(`catch:${catchTarget}`, () => {
            if (catchTarget === null) return
            // Spend the button before the round trip: a call that arrives after
            // the target's LOCO! costs a card, and a second tap while the first
            // is in flight would buy the same opinion twice.
            noteCatchAttempt(catchTarget)
            onSend({ type: 'catch_uno', target_index: catchTarget })
          })
        }
        t={t}
      />

      {/* Fixed Rules button + theme toggle — top-right corner, never shifts with action bar */}
      <div className={styles.topRight}>
        {/* Scores: a touch affordance only. A pointer device holds TAB, so on
            desktop this button is a permanent control for something the player
            already has a faster way to reach. Icon-only because a square is
            what fits a phone's top-right cluster beside the other three. */}
        <button
          className={styles.scoresBtn}
          aria-pressed={pinnedScores}
          aria-label={t.scoreTableBtn}
          title={t.scoreTableBtn}
          onClick={() => setPinnedScores((v) => !v)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <g
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <path d="M3 9.5h18M3 15h18M10 9.5V20" />
            </g>
          </svg>
        </button>
        <ThemeToggle />
        <AudioSettings />
        <RulesButton label={t.rulesBtn} onClick={() => setShowRules(true)} />
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
            // Send first, animate second: the table is waiting on the message,
            // not on our card leaving our own fan.
            flightRef.current?.flyFromHand(colorPicker.card, colorPicker.idx)
            setColorPicker(null)
          }}
          onCancel={() => setColorPicker(null)}
        />
      )}

      {/* Swap player picker */}
      {playerPicker && (
        <PlayerPicker
          label={t.choosePlayer}
          cardsLabel={(n) =>
            n === 1 ? t.swapTargetCardOne : t.swapTargetCards.replace('%n', String(n))
          }
          players={players.filter((p) => p.index !== myIndex)}
          onChoose={(targetIdx: number) => {
            onSend({
              type: playerPicker.interrupt ? 'interrupt_play_card' : 'play_card',
              card: playerPicker.card,
              chosen_player: targetIdx,
            })
            flightRef.current?.flyFromHand(playerPicker.card, playerPicker.idx)
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

      {/* A Contre-LOCO! that arrived after the LOCO! it was aimed at. The card
          it cost is public, so the notice is too — otherwise the caller's hand
          grows for no reason anybody at the table can see. */}
      {catchFailed && (
        <div key={catchFailed.at} className={styles.catchFailNotice}>
          {catchFailed.seat === myIndex
            ? t.catchFailedYou
            : t.catchFailedOther.replace(
                '%player',
                players.find((p) => p.index === catchFailed.seat)?.nickname ?? `P${catchFailed.seat}`,
              )}
        </div>
      )}

      <InterruptBanner
        flash={interruptFlash}
        myIndex={myIndex}
        players={players}
        t={t}
        onDone={clearInterrupt}
      />

      {/* A Contre-LOCO! that landed. The penalty cards fly to the caught seat on
          the board underneath; this says whose seat it is and what it cost. */}
      <CatchBanner
        flash={catchFlash}
        myIndex={myIndex}
        players={players}
        t={t}
        onDone={clearCatchFlash}
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

      {/* The map reveal. Deliberately an overlay over a mounted board rather
          than a screen instead of it: the board spends this time laying itself
          out and warming the images, so what the player sees when this lifts is
          a table that is already finished. */}
      {mapLoading && map && (
        <MapLoadingScreen
          map={map}
          ready={mapLoading.ready}
          players={players}
          myIndex={myIndex}
          progress={preload.progress}
          t={t}
        />
      )}
    </div>
  )
}
