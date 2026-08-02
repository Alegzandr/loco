import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { CardColor, ClientMsg } from '../types/protocol'
import { useGameStore, UNO_CATCH_WINDOW_MS } from '../hooks/useGameStore'
import { useDrainBar } from '../hooks/useDrainBar'
import { useCountdown } from '../hooks/useCountdown'
import { useReconnectAnimation } from '../hooks/useReconnectAnimation'
import { useHeldKey } from '../hooks/useHeldKey'
import { useCardPlay } from '../hooks/useCardPlay'
import { useAutoClear } from '../hooks/useAutoClear'
import { useBoardShake } from '../hooks/useBoardShake'
import { useMapGate } from '../hooks/useMapGate'
import { useTurnCountdownSfx } from '../hooks/useTurnCountdownSfx'
import { useI18n } from '../i18n'
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
import { Preferences } from './Preferences'
import { AudioSettings } from './AudioSettings'
import { GameBoard, GameBoardHandle } from './cards/GameBoard'
import { resolveMap } from './cards/maps'
import { MapLoadingScreen } from './MapLoadingScreen'
import { OpponentAway } from './OpponentAway'
import { ServerUpdating } from './ServerUpdating'
import { useE2EPlayCard } from '../dev/e2eBridge'
import { resolveSwapNoticeText } from './swapNoticeText'
import styles from './GameView.module.css'

interface Props {
  onSend: (msg: ClientMsg) => void
  wsStatus: WsStatus
}

const ROUND_SUMMARY_AUTO_DISMISS_MS = 8000
const SWAP_NOTICE_MS = 3500
const CATCH_FAIL_NOTICE_MS = 2800
/** How long an in-game refusal stays on screen. */
const ERROR_TOAST_MS = 2500

/**
 * The board is still there, something is being waited on. Used twice with the
 * same markup (the server rebuilding our seat, and the socket being down)
 * because they are the same object to the player: a curtain with a reason on it.
 */
function StatusOverlay({ text, sub }: { text: string; sub: string }) {
  return (
    <div className={styles.reconnectOverlay}>
      <div className={styles.reconnectCard}>
        <div className={styles.reconnectSpinner} />
        <div className={styles.reconnectText}>{text}</div>
        <div className={styles.reconnectSub}>{sub}</div>
      </div>
    </div>
  )
}

export function GameView({ onSend, wsStatus }: Props) {
  const { t } = useI18n()
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

  // What a tap on a card means, the two prompts it can open instead, and the
  // legality the board highlights with. See hooks/useCardPlay.ts.
  const {
    colorPicker,
    playerPicker,
    setColorPicker,
    setPlayerPicker,
    onCardClick,
    isPlayable,
    isInteractive,
    isMyTurn,
    hasPlayableCard,
    canCounter,
  } = useCardPlay({
    myHand,
    discard,
    activeColor,
    currentTurn,
    myIndex,
    pendingDraw,
    onSend,
    lastPlayAt: lastPlay?.at,
  })

  // Playwright plays a card through the same handler a real tap goes through.
  useE2EPlayCard(onCardClick, myHand)

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

  // Three pieces of table news that take themselves off screen. The swap
  // notice's matching trail animation lives in <GameBoard /> (keyed by
  // swapNotice.at), and the refusal is deliberately the shortest of the three.
  useAutoClear(catchFailed?.at, CATCH_FAIL_NOTICE_MS, clearCatchFailed)
  useAutoClear(swapNotice?.at, SWAP_NOTICE_MS, () => setSwapNotice(null))
  useAutoClear(errorMsg, ERROR_TOAST_MS, clearError)

  // The two shakes: a rattle for an interception, a vertical thump for a
  // Contre-LOCO!. Different on purpose, see hooks/useBoardShake.ts.
  useBoardShake(containerRef, interruptFlash, catchFlash)

  // Ticks over the last few seconds of our own turn.
  useTurnCountdownSfx(turnDeadline, isMyTurn)

  // Auto-dismiss round summary countdown — runs while the summary is visible.
  const summaryCountdown = useCountdown(showRoundSummary, ROUND_SUMMARY_AUTO_DISMISS_MS, dismissRoundSummary)

  // The room this match is played in. Memoised because <GameBoard /> is memo'd
  // and takes it as a prop: resolveMap returns the same object for the same id,
  // but pinning it here keeps the intent explicit alongside the other stable
  // props below. null = the built-in felt (a map id we have no art for).
  const map = useMemo(() => resolveMap(mapId), [mapId])

  // Preload the room's art while the table is shut, and tell the server the
  // moment we are in. See hooks/useMapGate.ts.
  const preload = useMapGate(map, mapLoading !== null, onSend)

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
        isPlayable={isPlayable}
        isInteractive={isInteractive}
        onCardClick={onCardClick}
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
      {showReconnectOverlay && <StatusOverlay text={t.reconnected} sub={t.rebuildingTable} />}

      {/* WS overlay — shown when the WebSocket transport is down mid-game.
          Prevents the blank-board regression where the board renders empty
          because no game_state arrives while the socket is reconnecting. */}
      {wsStatus !== 'open' && (
        <StatusOverlay text={t.wsLostConnection} sub={t.wsReconnecting} />
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
          className={`${styles.scoresBtn} hit-target`}
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
        <Preferences />
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
          cancelLabel={t.pickerCancel}
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
          cancelLabel={t.pickerCancel}
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
