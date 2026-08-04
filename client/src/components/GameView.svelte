<script lang="ts">
  import type { CardColor, ClientMsg } from '../types/protocol'
  import { UNO_CATCH_WINDOW_MS } from '../hooks/gameStore'
  import { game } from '../hooks/gameStore.svelte'
  import { drainBar, URGENT_AT } from '../hooks/drainBar.svelte'
  import {
    countdown,
    heldKey,
    autoClear,
    reconnectAnimation,
    turnCountdownSfx,
  } from '../hooks/viewEffects.svelte'
  import { cardPlay, boardShake, mapGate } from '../hooks/gamePlay.svelte'
  import { escapeKey } from '../hooks/escapeKey.svelte'
  import { i18n } from '../i18n/i18n.svelte'
  import { resolveServerError } from '../i18n/serverErrors'
  import type { WsStatus } from '../hooks/webSocketPolicy'
  import RulesButton from './RulesButton.svelte'
  import RulesModal from './RulesModal.svelte'
  import UnoTimer from './UnoTimer.svelte'
  import ColorPicker from './ColorPicker.svelte'
  import PlayerPicker from './PlayerPicker.svelte'
  import ActionBar from './ActionBar.svelte'
  import RoundSummary from './RoundSummary.svelte'
  import ScoreTable from './ScoreTable.svelte'
  import InterruptBanner from './InterruptBanner.svelte'
  import CatchBanner from './CatchBanner.svelte'
  import Preferences from './Preferences.svelte'
  import AudioSettings from './AudioSettings.svelte'
  import GameBoard, { type GameBoardHandle } from './cards/GameBoard.svelte'
  import { resolveMap } from './cards/maps'
  import MapLoadingScreen from './MapLoadingScreen.svelte'
  import OpponentAway from './OpponentAway.svelte'
  import ServerUpdating from './ServerUpdating.svelte'
  import { resolveSwapNoticeText } from './swapNoticeText'
  import { isCatchLive } from './catchAvailability'
  import { e2ePlayCard } from '../dev/e2eBridge.svelte'

  type Props = {
    onSend: (msg: ClientMsg) => void
    wsStatus: WsStatus
    /**
     * Try the socket again now, from the top of the backoff. The curtain below
     * is the one screen in the game a player cannot act their way off, so it
     * carries the one control that answers "is this stuck?" without reaching for
     * the reload button — which on this screen costs the seat a round trip it
     * did not have to spend.
     */
    onRetryConnection?: () => void
    /**
     * Give the seat up. Two ways here, and they are not the same thing.
     *
     * The abandoned-table curtain below is the older one: nobody is left and
     * nobody can come back, so there is nothing to walk out on.
     *
     * The other is the chip, drawn at every table: somebody who genuinely has
     * to leave has no other exit but the turn clock, which auto-passes for an
     * empty chair until the AFK threshold and spoils two rounds for everybody
     * else rather than one. The server never refuses it; what the table decides
     * is what the departure does, and the note under the question says so.
     */
    onLeave?: () => void
    /**
     * Showcase only: mounts straight into the walk-out question, which is
     * otherwise component-local state no scene could reach. Same trick as
     * `WaitingRoom`'s own `initialConfirmLeave`.
     */
    initialConfirmLeave?: boolean
  }

  let {
    onSend,
    wsStatus,
    onRetryConnection,
    onLeave,
    initialConfirmLeave = false,
  }: Props = $props()

  const ROUND_SUMMARY_AUTO_DISMISS_MS = 8000
  const SWAP_NOTICE_MS = 3500
  const CATCH_FAIL_NOTICE_MS = 2800
  /** A seat leaving is the slowest of the three to read: it names somebody. */
  const DEPARTURE_NOTICE_MS = 4000
  /** How long an in-game refusal stays on screen. */
  const ERROR_TOAST_MS = 2500

  const t = $derived(i18n.t)
  const g = $derived(game.current)

  // Every other seat's reconnect window has run out, so no card will ever be
  // played on this board again: the clock goes on drawing and passing for empty
  // chairs, and until the server learned to allow it, `leave_room` came back
  // refused and closing the tab was the only way out of the game. Held is not
  // gone — a seat inside its hold still reads `connected: false` — so this asks
  // `goneSeats`, which only the expiry writes, and never the roster's flag.
  const tableAbandoned = $derived(
    g.players.length > 1 &&
      g.players.every((p) => p.index === g.myIndex || g.goneSeats.includes(p.index)),
  )

  // Per-control timestamp of the last accepted tap; see guardDoubleTap.
  // Deliberately a plain Map and not a SvelteMap: nothing renders from it, it is
  // written on every accepted tap, and making it reactive would invalidate a
  // reader that does not exist on the hottest path the board has.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const lastAction = new Map<string, number>()
  let showRules = $state(false)
  // The walk-out question, held here and not in a modal: it takes the chip's
  // place under the row it was pressed from, so the board does not move.
  let confirmLeave = $state(initialConfirmLeave)

  /**
   * What leaving costs the people who are still holding cards.
   *
   * The way out itself is never conditional — a player who has to go has to go,
   * and the only alternative exit is the turn clock auto-passing for an empty
   * chair. What is conditional is the sentence under the question, because the
   * four tables this game has are four different departures: the bot minds
   * nothing, a stranger is handed the match, a table of four keeps playing, and
   * a table of two ends where it stands.
   *
   * Counted the way the server counts it (`Hub.canWalkOut`, `WalkOutFloor`): a
   * seat counts while it is a bot, or a human whose hold has not run out —
   * `goneSeats` is written only by the `player_left` that names a seat, and held
   * is not gone. If the two ever disagree the server still decides; what is at
   * stake here is the wording, not the permission.
   */
  const playableSeats = $derived(
    g.players.filter((p) => p.is_bot || !g.goneSeats.includes(p.index)).length,
  )
  const leaveNote = $derived(
    g.isSolo
      ? t.leaveMatchNoteSolo
      : g.isMatchmade
        ? t.leaveMatchNoteRanked
        : playableSeats - 1 >= 2
          ? t.leaveMatchNoteTable
          : t.leaveMatchNoteEnds,
  )

  // Escape backs out of the question, through the one hook every dismissible
  // thing in the game uses. Bound only while it is up.
  escapeKey(
    () => confirmLeave,
    () => (confirmLeave = false),
  )
  // Touch devices have no TAB key, so the same table is also pinned open by a
  // button in the top cluster. Held and pinned are separate states on purpose:
  // releasing TAB must never close a table the player deliberately pinned.
  let pinnedScores = $state(false)
  let containerEl = $state<HTMLDivElement | null>(null)
  // The board fills this in; the pickers use it to animate a play that was only
  // confirmed once a colour or a target was named.
  let flight: GameBoardHandle | null = null
  // Countdown bars are written to directly, never through state: see drainBar.
  let turnFill = $state<HTMLDivElement | null>(null)
  let catchFill = $state<HTMLDivElement | null>(null)

  // Swallows the second half of a double-tap on the same control, and only on the
  // same control. It used to be one shared 400ms lockout across every action,
  // which silently ate the most ordinary sequence in the game: draw, then pass.
  // Same for declaring LOCO! and catching in the same breath, or catching a second
  // seat after a Swap put two players on one card. In a game whose windows are
  // measured in seconds, a control that ignores a deliberate tap because a
  // *different* control was used 300ms ago reads as a dead button. The catch key
  // carries its target for that reason: two seats are two taps.
  function guardDoubleTap(key: string, fn: () => void) {
    const now = Date.now()
    const last = lastAction.get(key) ?? 0
    if (now - last < 400) return
    lastAction.set(key, now)
    fn()
  }

  // What a tap on a card means, the two prompts it can open instead, and the
  // legality the board highlights with. See hooks/gamePlay.svelte.ts.
  const play = cardPlay({
    myHand: () => g.myHand,
    discard: () => g.discard,
    activeColor: () => g.activeColor,
    currentTurn: () => g.currentTurn,
    myIndex: () => g.myIndex,
    pendingDraw: () => g.pendingDraw,
    onSend,
    lastPlayAt: () => g.lastPlay?.at,
  })

  // Playwright plays a card through the same handler a real tap goes through.
  e2ePlayCard(play.onCardClick, () => g.myHand)

  // Reconnect visual recovery: 600ms overlay → board fades back in via
  // GameBoard's internal rebuildKey effect.
  const reconnect = reconnectAnimation(
    () => g.isReconnecting,
    () => g.setIsReconnecting(false),
  )

  // UNO catch + per-turn countdown bars. Both drain through a CSS animation armed
  // once per deadline (drainBar) rather than a per-frame update: the board must
  // not re-render sixty times a second just to move a 6px bar. UNO uses the fixed
  // 5000ms catch window; the turn timer anchors to whatever time remained when the
  // deadline became active, since the server re-arms it on a draw.
  //
  // The catch bar is only mounted once a target is on the hook, so the deadline
  // handed to it has to go null with it, otherwise the effect would not re-run
  // when the element finally appears, and the bar would never arm.
  //
  // The three deadlines below are `$derived` for the same reason every hook in
  // `hooks/` reads its arguments through `live()`: `g` is one snapshot replaced
  // on every message, so an effect reading `g.turnDeadline` straight out of it
  // depends on the whole match and re-arms its timer on every card anybody
  // plays. A derivation is compared, so what changes here is the deadline.
  const catchDeadline = $derived(g.catchTarget !== null ? g.unoTimerEnd : null)
  // Whether the centre button is pressable at all — a looser question than
  // whether anybody is on the hook, and deliberately so (`catchAvailability.ts`).
  const catchLive = $derived(isCatchLive(g.players, g.myIndex, g.declaredSeats))
  const turnDeadline = $derived(g.turnDeadline)
  const catchWindowEnd = $derived(g.unoTimerEnd)
  drainBar(() => turnFill, () => turnDeadline, 'auto')
  drainBar(() => catchFill, () => catchDeadline, UNO_CATCH_WINDOW_MS)

  // The urgency pulse is a `class:` directive rather than the `classList.add` the
  // React version used, and that is not a style preference: Svelte prunes a
  // scoped selector it cannot see in the markup, so a class applied only from
  // JavaScript compiles away and the bar silently stops turning urgent. One flip
  // per turn is not "something continuous going through state" — it is a single
  // discrete change, which is exactly what state is for.
  let turnUrgent = $state(false)
  $effect(() => {
    const deadline = turnDeadline
    turnUrgent = false
    if (deadline === null) return
    const remaining = deadline - Date.now()
    if (remaining <= 0) return
    const untilUrgent = remaining - remaining * URGENT_AT
    if (untilUrgent <= 0) {
      turnUrgent = true
      return
    }
    const id = setTimeout(() => (turnUrgent = true), untilUrgent)
    return () => clearTimeout(id)
  })

  // Retire each catch window locally when it runs out. Only the expired ones go:
  // after a Swap or a GlobalSwitch several seats are on the hook with different
  // deadlines, and the next one becomes the offered catch. The server enforces the
  // same 5 s, so a late click would only earn an error toast.
  $effect(() => {
    const end = catchWindowEnd
    if (end === null) return
    const remaining = end - Date.now()
    if (remaining <= 0) {
      g.pruneCatchWindows()
      return
    }
    const id = setTimeout(g.pruneCatchWindows, remaining)
    return () => clearTimeout(id)
  })

  // Three pieces of table news that take themselves off screen. The swap notice's
  // matching trail animation lives in <GameBoard /> (keyed by swapNotice.at), and
  // the refusal is deliberately the shortest of the three.
  autoClear(() => g.catchFailed?.at, CATCH_FAIL_NOTICE_MS, () => g.clearCatchFailed())
  autoClear(() => g.departureNotice?.at, DEPARTURE_NOTICE_MS, () => g.clearDepartureNotice())
  autoClear(() => g.swapNotice?.at, SWAP_NOTICE_MS, () => g.setSwapNotice(null))
  autoClear(() => g.errorMsg, ERROR_TOAST_MS, () => g.clearError())

  // The two shakes: a rattle for an interception, a vertical thump for a
  // Contre-LOCO!. Different on purpose, see hooks/gamePlay.svelte.ts.
  boardShake(() => containerEl, () => g.interruptFlash, () => g.catchFlash)

  // Ticks over the last few seconds of our own turn.
  turnCountdownSfx(() => g.turnDeadline, () => play.isMyTurn)

  // Auto-dismiss round summary countdown — runs while the summary is visible.
  const summary = countdown(
    () => g.showRoundSummary,
    ROUND_SUMMARY_AUTO_DISMISS_MS,
    () => g.dismissRoundSummary(),
  )

  // The room this match is played in. null = the built-in felt (a map id we have
  // no art for).
  const map = $derived(resolveMap(g.mapId))

  // Whether the gate is open at all, narrowed to a boolean before the effect
  // sees it: `g.mapLoading` gets a new identity on every arrival, so reading it
  // inside the effect makes the preload re-run several times per gate for a
  // question whose answer has not changed.
  const gateOpen = $derived(g.mapLoading !== null)

  // Preload the room's art while the table is shut, and tell the server the
  // moment we are in. See hooks/gamePlay.svelte.ts.
  const preload = mapGate(() => map, () => gateOpen, onSend)

  const fxTexts = $derived({ skip: t.fxSkip, reverse: t.fxReverse, colors: t.fxColors })
  const turnTexts = $derived({
    yourTurn: t.yourTurn,
    drawOrCounter: t.drawOrCounter,
    drawPenalty: t.drawPenalty,
    playerTurnSuffix: t.playerTurnSuffix,
  })

  // Hold TAB for the standings. Disabled while a dialog owns the screen: inside
  // the rules modal or a picker, TAB still belongs to the dialog's own focus
  // order, and the summary already shows the same numbers.
  const scoresHeld = heldKey(
    'Tab',
    () => !showRules && !play.colorPicker && !play.playerPicker && !g.showRoundSummary,
  )
  const showScores = $derived(scoresHeld.current || pinnedScores)

  const handleDraw = () => guardDoubleTap('draw', () => onSend({ type: 'draw_card' }))
</script>

<div class="container" bind:this={containerEl}>
  <!-- drawLabel is deliberately not the Draw button's string: two controls sharing
       an accessible name is ambiguous for screen readers and for anything else
       that addresses controls by name. -->
  <GameBoard
    myHand={g.myHand}
    discard={g.discard}
    activeColor={g.activeColor}
    players={g.players}
    myIndex={g.myIndex}
    currentTurn={g.currentTurn}
    direction={g.direction}
    directionLabel={g.direction >= 0 ? t.directionCw : t.directionCcw}
    pendingDraw={g.pendingDraw}
    canCounter={play.canCounter}
    isPlayable={play.isPlayable}
    isInteractive={play.isInteractive}
    onCardClick={play.onCardClick}
    setFlightHandle={(h) => (flight = h)}
    {turnTexts}
    {fxTexts}
    swapNotice={g.swapNotice}
    catchFlash={g.catchFlash}
    lastPlay={g.lastPlay}
    isReconnecting={g.isReconnecting || reconnect.current}
    {map}
    canDraw={play.isMyTurn && (g.pendingDraw > 0 || !g.hasDrawn)}
    onDraw={handleDraw}
    drawLabel={g.pendingDraw > 0 ? `${t.drawPile} +${g.pendingDraw}` : t.drawPile}
  />

  <!-- Per-turn countdown bar, shown whenever a deadline is active. Both the
       emptying and the colour are driven by drainBar, which never re-renders. -->
  {#if g.turnDeadline !== null}
    <div class="turnTimerBar" class:turnTimerUrgent={turnUrgent}>
      <div bind:this={turnFill} class="turnTimerFill loco-heat"></div>
    </div>
  {/if}

  <!-- An opponent who dropped out of a matchmade match, and the clock their seat
       is on. Nothing sends a deadline in an ordinary room, so nothing renders here
       in one. -->
  {#if g.opponentAway}
    <OpponentAway
      nickname={g.players.find((pl) => pl.index === g.opponentAway!.seat)?.nickname ?? ''}
      deadline={g.opponentAway.deadline}
    />
  {/if}

  <!-- A deploy is under way. The match is unaffected, which is the whole message. -->
  {#if g.serverUpdating}
    <ServerUpdating offset={g.opponentAway !== null} />
  {/if}

  <!-- The board is still there, something is being waited on. The same markup
       twice (the server rebuilding our seat, and the socket being down) because
       they are the same object to the player: a curtain with a reason on it. -->
  {#if reconnect.current}
    <div class="reconnectOverlay">
      <div class="reconnectCard">
        <div class="reconnectSpinner"></div>
        <div class="reconnectText">{t.reconnected}</div>
        <div class="reconnectSub">{t.rebuildingTable}</div>
      </div>
    </div>
  {/if}

  <!-- Shown when the WebSocket transport is down mid-game. Prevents the
       blank-board regression where the board renders empty because no game_state
       arrives while the socket is reconnecting. -->
  {#if wsStatus !== 'open'}
    <div class="reconnectOverlay">
      <div class="reconnectCard">
        <div class="reconnectSpinner"></div>
        <div class="reconnectText">{t.wsLostConnection}</div>
        <div class="reconnectSub">{t.wsReconnecting}</div>
        {#if onRetryConnection}
          <button class="wsRetry" type="button" onclick={onRetryConnection}>
            {t.wsRetryNow}
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Nobody is left at this table and nobody can come back to it. The board
       stays underneath, because it is still the match that was being played, and
       the one control is the way out the action bar deliberately does not carry.
       Behind the two curtains above: while the socket is down, what happened here
       is not yet the player's problem. -->
  {#if tableAbandoned && onLeave && wsStatus === 'open' && !reconnect.current}
    <div class="reconnectOverlay">
      <div class="reconnectCard">
        <div class="reconnectText">{t.tableEmptyTitle}</div>
        <div class="reconnectSub">{t.tableEmptyHint}</div>
        <button class="wsRetry" type="button" onclick={onLeave}>{t.leaveRoom}</button>
      </div>
    </div>
  {/if}

  <!-- Catch window — runs while somebody is sitting on one uncalled card. -->
  {#if g.catchTarget !== null && g.unoTimerEnd !== null}
    <UnoTimer fillRef={{ get current() { return catchFill }, set current(v) { catchFill = v } }} label={t.catchWindow} />
  {/if}

  <ActionBar
    isMyTurn={play.isMyTurn}
    pendingDraw={g.pendingDraw}
    handSize={g.myHand.length}
    hasDrawn={g.hasDrawn}
    hasPlayableCard={play.hasPlayableCard}
    catchArmed={g.catchTarget !== null}
    catchLive={catchLive}
    hasDeclared={g.myDeclared}
    onDraw={handleDraw}
    onPass={() => guardDoubleTap('pass', () => onSend({ type: 'pass_turn' }))}
    onUno={() => guardDoubleTap('uno', () => onSend({ type: 'declare_uno' }))}
    onCatch={() =>
      // Name the seat: several players can owe a declaration at once after a Swap
      // or a GlobalSwitch, and the button offers the most urgent one.
      guardDoubleTap(`catch:${g.catchTarget}`, () => {
        // Read once, into a local. `g` is a live snapshot, and the call below
        // retires this window — so reading `g.catchTarget` a second time would
        // name the *next* seat on the hook and catch the wrong player.
        const target = g.catchTarget
        // No target is a real message, not a dropped one: the button is live
        // whenever somebody is close to finishing, so this is the player betting
        // that a seat owes the call. The server charges the miss — once per card
        // played, so leaning on the button costs one card, not one per press.
        if (target === null) {
          // …but only one per board. The server charges a fruitless call once
          // per card played, so a second blind press cannot cost anything —
          // and the press right after a catch that landed would otherwise be
          // read as a fresh wager and charged in the same breath as the win.
          if (g.catchSpent) return
          g.noteBlindCatchAttempt()
          onSend({ type: 'catch_uno' })
          return
        }
        // Spend the button before the round trip: a call that arrives after the
        // target's LOCO! costs a card, and a second tap while the first is in
        // flight would buy the same opinion twice.
        g.noteCatchAttempt(target)
        onSend({ type: 'catch_uno', target_index: target })
      })}
    {t}
  />

  <div class="topRight">
    <!-- Scores: a touch affordance only. A pointer device holds TAB, so on desktop
         this button is a permanent control for something the player already has a
         faster way to reach. Icon-only because a square is what fits a phone's
         top-right cluster beside the other three. -->
    <button
      class="scoresBtn hit-target"
      aria-pressed={pinnedScores}
      aria-label={t.scoreTableBtn}
      title={t.scoreTableBtn}
      onclick={() => (pinnedScores = !pinnedScores)}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M3 9.5h18M3 15h18M10 9.5V20" />
        </g>
      </svg>
    </button>
    <Preferences />
    <AudioSettings />
    <RulesButton label={t.rulesBtn} onclick={() => (showRules = true)} />
    <!-- The way out of a match that is still being played. It is drawn at every
         table, because a player who has to leave is going either way and the
         other exit is an empty chair the clock plays for. Deliberately *not* on
         the action bar: that bar is a fixed three-column grid so a reaction can
         be aimed at it, and it must never grow a fourth control. This is chrome
         — the same row the gear, the speaker and the "?" sit on, which never
         moves and which nobody is aiming at mid-window. -->
    {#if onLeave}
      <button
        class="leaveBtn hit-target"
        aria-label={t.leaveMatchBtn}
        title={t.leaveMatchBtn}
        onclick={() => (confirmLeave = true)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 4H6a2 2 0 00-2 2v12a2 2 0 002 2h8" />
            <path d="M17 8l4 4-4 4M21 12H10" />
          </g>
        </svg>
      </button>
    {/if}
  </div>

  <!-- The question takes the chip's place, under the row it was pressed from
       and out of the flow, so nothing on the board moves for it. The safe answer
       comes first and is the coloured one, exactly as in the waiting room:
       leaving is the only press on this screen a player cannot undo. -->
  {#if confirmLeave && onLeave}
    <div class="leaveAsk">
      <p class="leaveAskText">{t.leaveMatchAsk}</p>
      <!-- What it costs the others, which is the half of this decision the
           player cannot see from their own screen. -->
      <p class="leaveAskNote">{leaveNote}</p>
      <div class="leaveAskRow">
        <button class="leaveStay" onclick={() => (confirmLeave = false)}>{t.leaveMatchStay}</button>
        <button
          class="leaveGo"
          onclick={() => {
            confirmLeave = false
            onLeave?.()
          }}
        >
          {t.leaveMatchYes}
        </button>
      </div>
    </div>
  {/if}

  <!-- Standings: held open with TAB, or pinned by the button above. -->
  {#if showScores}
    <ScoreTable
      players={g.players}
      scoreboard={g.scoreboard}
      roundHistory={g.roundHistory}
      latencies={g.latencies}
      myIndex={g.myIndex}
      {t}
      onDismiss={pinnedScores ? () => (pinnedScores = false) : undefined}
    />
  {/if}

  <!-- In-game refusal. Sits over the empty upper felt, never over the hand: it
       used to be pinned at the action bar's reserve height, which put it straight
       across the cards it was complaining about. -->
  {#if g.errorMsg}
    <div class="errorToast" role="alert">{resolveServerError(g.errorMsg, t.errors)}</div>
  {/if}

  <!-- Wild colour picker — serves both a normal play and an out-of-turn slam. -->
  {#if play.colorPicker}
    {@const pick = play.colorPicker}
    <ColorPicker
      label={t.chooseColor}
      cancelLabel={t.pickerCancel}
      onChoose={(col: CardColor) => {
        onSend({
          type: pick.interrupt ? 'interrupt_play_card' : pick.counter ? 'counter_draw' : 'play_card',
          card: pick.card,
          chosen_color: col,
          play_cards: pick.copies,
          declare_loco: pick.declareLoco,
        })
        // Send first, animate second: the table is waiting on the message, not on
        // our card leaving our own fan.
        flight?.flyFromHand(pick.card, pick.idx)
        play.colorPicker = null
      }}
      onCancel={() => (play.colorPicker = null)}
    />
  {/if}

  <!-- Swap player picker -->
  {#if play.playerPicker}
    {@const pick = play.playerPicker}
    <PlayerPicker
      label={t.choosePlayer}
      cancelLabel={t.pickerCancel}
      cardsLabel={(n) => (n === 1 ? t.swapTargetCardOne : t.swapTargetCards.replace('%n', String(n)))}
      players={g.players.filter((pl) => pl.index !== g.myIndex)}
      onChoose={(targetIdx: number) => {
        onSend({
          type: pick.interrupt ? 'interrupt_play_card' : 'play_card',
          card: pick.card,
          chosen_player: targetIdx,
        })
        flight?.flyFromHand(pick.card, pick.idx)
        play.playerPicker = null
      }}
      onCancel={() => (play.playerPicker = null)}
    />
  {/if}

  <!-- Round summary overlay -->
  {#if g.showRoundSummary}
    <RoundSummary
      roundNumber={g.roundNumber_completed}
      roundWinner={g.roundWinner}
      roundScores={g.roundScores}
      scoreboard={g.scoreboard}
      matchFormat={g.matchFormat}
      summaryCountdown={summary.current}
      onDismiss={() => g.dismissRoundSummary()}
      {t}
    />
  {/if}

  {#if g.swapNotice}
    {#key g.swapNotice.at}
      <div class="swapNotice">{resolveSwapNoticeText(g.swapNotice, g.myIndex, g.players, t)}</div>
    {/key}
  {/if}

  <!-- A seat that is out for the rest of the match, walked out or held until the
       window closed. The table needs telling: the turn skips that chair from now
       on and its cards went back into the deck, and the roster alone cannot say
       it — held and gone are both `connected: false`. -->
  {#if g.departureNotice}
    {#key g.departureNotice.at}
      <div class="departureNotice">
        {t.departureNotice.replace('%player', g.departureNotice.nickname)}
      </div>
    {/key}
  {/if}

  <!-- A Contre-LOCO! that arrived after the LOCO! it was aimed at. The card it
       cost is public, so the notice is too — otherwise the caller's hand grows for
       no reason anybody at the table can see. -->
  {#if g.catchFailed}
    {#key g.catchFailed.at}
      <div class="catchFailNotice">
        {g.catchFailed.seat === g.myIndex
          ? t.catchFailedYou
          : t.catchFailedOther.replace(
              '%player',
              g.players.find((pl) => pl.index === g.catchFailed!.seat)?.nickname ??
                `P${g.catchFailed.seat}`,
            )}
      </div>
    {/key}
  {/if}

  <InterruptBanner
    flash={g.interruptFlash}
    myIndex={g.myIndex}
    players={g.players}
    {t}
    onDone={() => g.clearInterrupt()}
  />

  <!-- A Contre-LOCO! that landed. The penalty cards fly to the caught seat on the
       board underneath; this says whose seat it is and what it cost. -->
  <CatchBanner
    flash={g.catchFlash}
    myIndex={g.myIndex}
    players={g.players}
    {t}
    onDone={() => g.clearCatchFlash()}
  />

  {#if g.unoDeclared}
    <div class="unoBanner">
      {g.unoDeclaredByIndex >= 0 &&
      g.players.find((pl) => pl.index === g.unoDeclaredByIndex)?.nickname
        ? `${g.players.find((pl) => pl.index === g.unoDeclaredByIndex)!.nickname}: ${t.unoBanner}`
        : t.unoBanner}
    </div>
  {/if}

  {#if g.matchFormat !== 'BO1'}
    <div class="roundIndicator">{t.round} {g.roundNumber} · {g.matchFormat}</div>
  {/if}

  {#if showRules}
    <RulesModal onClose={() => (showRules = false)} />
  {/if}

  <!-- The map reveal. Deliberately an overlay over a mounted board rather than a
       screen instead of it: the board spends this time laying itself out and
       warming the images, so what the player sees when this lifts is a table that
       is already finished. -->
  {#if g.mapLoading && map}
    <MapLoadingScreen
      {map}
      ready={g.mapLoading.ready}
      players={g.players}
      myIndex={g.myIndex}
      progress={preload.current.progress}
      {t}
    />
  {/if}
</div>

<style>
  .container {
    position: relative;
    width: 100%;
    height: 100%;
    background: var(--color-canvas);
    font-family: var(--font-body);
    color: var(--color-ink);
  }

  /* Reconnect / transport-down overlay */
  .reconnectOverlay {
    position: absolute;
    inset: 0;
    background: var(--color-scrim);
    backdrop-filter: blur(5px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
    animation: fadeIn 0.25s ease-out forwards;
  }

  .reconnectCard {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-base);
    padding: var(--space-xl) var(--space-xxl);
    background: var(--color-surface-card);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    animation: slideUp 0.3s var(--ease-bounce) forwards;
  }

  .reconnectSpinner {
    width: 46px;
    height: 46px;
    border: 5px solid var(--color-hairline);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .reconnectText {
    font: 600 22px/1.2 var(--font-display);
    color: var(--color-ink);
  }

  .reconnectSub {
    font: 500 14px/1.4 var(--font-body);
    color: var(--color-muted);
  }

  /* The one control on the curtain. Quiet on purpose: the client is already
     retrying on its own and this only shortens the wait, so it must not read as
     the thing that has to be pressed for the game to come back. */
  .wsRetry {
    margin-top: 4px;
    padding: 9px 20px;
    min-height: 44px;
    border: var(--stroke-thin) solid var(--color-stroke);
    border-radius: var(--radius-full);
    background: var(--color-surface-card);
    color: var(--color-ink);
    font: 700 14px/1.2 var(--font-display);
    cursor: pointer;
    touch-action: manipulation;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out);
  }

  .wsRetry:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 0 var(--color-stroke-soft);
  }

  .wsRetry:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--color-stroke-soft);
  }

  /* ── UNO banner ───────────────────────────────────────────────────────────
     The loudest moment in the game. A tilted sticker with a thick outline that
     punches in and settles — built to be legible in a clipped highlight. */
  .unoBanner {
    position: absolute;
    /* Sits above the pile rather than over it — the play that triggered the shout
       must stay visible while the banner is up. */
    top: 24%;
    left: 50%;
    font: 700 clamp(30px, 5.6vw, 56px) / 1 var(--font-display);
    letter-spacing: -1px;
    color: var(--color-on-dark);
    background: var(--gradient-primary);
    padding: 14px 40px;
    border: 5px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow:
      0 8px 0 var(--color-stroke-soft),
      0 0 60px rgba(255, 61, 104, 0.6);
    text-shadow: 0 4px 0 rgba(120, 10, 40, 0.5);
    white-space: nowrap;
    pointer-events: none;
    animation: unoPunch 0.45s var(--ease-bounce) forwards;
    z-index: 10;
  }

  @keyframes unoPunch {
    0% {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.3) rotate(-14deg);
    }
    55% {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1.12) rotate(-3deg);
    }
    100% {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1) rotate(-4deg);
    }
  }

  /* Swap / GlobalSwitch notice */
  .swapNotice {
    position: absolute;
    top: 20%;
    left: 50%;
    background: var(--gradient-tertiary);
    color: var(--color-on-dark);
    font: 600 17px/1.25 var(--font-display);
    text-shadow: 0 1px 0 rgba(30, 10, 90, 0.45);
    padding: 11px 24px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    box-shadow:
      var(--shadow-hard),
      0 0 28px rgba(108, 92, 255, 0.55);
    pointer-events: none;
    white-space: nowrap;
    z-index: 14;
    animation: swapNoticeIn 0.32s var(--ease-bounce) forwards;
  }

  /* A missed Contre-LOCO!. Same pill as the swap notice so it reads as table news
     rather than as an error, but in the penalty's own red and sitting lower, so
     the two can be on screen at once without covering each other. */
  .catchFailNotice {
    position: absolute;
    top: 29%;
    left: 50%;
    background: var(--gradient-error);
    color: var(--color-on-dark);
    font: 600 17px/1.25 var(--font-display);
    text-shadow: 0 1px 0 rgba(90, 10, 10, 0.45);
    padding: 11px 24px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    box-shadow:
      var(--shadow-hard),
      0 0 28px rgba(229, 72, 77, 0.5);
    pointer-events: none;
    white-space: nowrap;
    z-index: 14;
    animation: swapNoticeIn 0.32s var(--ease-bounce) forwards;
  }

  /* A departure is table news, not an error and not a callout: the same pill in
     the board's neutral ink, sitting above the other two so a seat leaving on
     the same beat as a missed Contre-LOCO! does not cover it. */
  .departureNotice {
    position: absolute;
    top: 13%;
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-surface-strong);
    color: var(--color-ink);
    font: 600 16px/1.25 var(--font-display);
    padding: 10px 22px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    box-shadow: var(--shadow-hard);
    pointer-events: none;
    white-space: nowrap;
    z-index: 14;
    animation: swapNoticeIn 0.32s var(--ease-bounce) forwards;
  }

  @media (max-width: 480px) {
    .departureNotice {
      font-size: 13px;
      padding: 8px 15px;
      top: 10%;
      max-width: 92%;
      white-space: normal;
      text-align: center;
    }

    .catchFailNotice {
      font-size: 14px;
      padding: 9px 16px;
      top: 26%;
      max-width: 92%;
      white-space: normal;
      text-align: center;
    }

    .swapNotice {
      font-size: 14px;
      padding: 9px 16px;
      top: 17%;
      max-width: 92%;
      white-space: normal;
      text-align: center;
    }

    /* A crowded phone table wraps its seats onto extra rows, so the toast starts
       a little lower to stay clear of them. */
    .errorToast {
      top: 34%;
    }
  }

  @keyframes swapNoticeIn {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-10px) scale(0.85);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }
  }

  /* Per-turn countdown bar */
  .turnTimerBar {
    position: absolute;
    /* Under the notch, not behind it: this bar is the only place the remaining
       time is written down, and a strip hidden by the status bar says nothing. */
    top: var(--safe-top);
    left: var(--safe-left);
    right: var(--safe-right);
    height: 6px;
    background: rgba(36, 21, 70, 0.18);
    z-index: 5;
    pointer-events: none;
  }

  /* Full width and drained by scaleX (see .loco-draining in tokens.css). Width was
     the obvious property and the wrong one: it lays out the page on every frame,
     where a transform is composited. The fill's colour comes from the drain
     animation too, so nothing here sets a background. */
  .turnTimerFill {
    height: 100%;
    border-bottom-right-radius: 3px;
    border-top-right-radius: 3px;
    background: var(--color-primary);
    box-shadow: 0 0 12px currentColor;
  }

  /* Urgency pulse sits on the track, not on the fill: the fill's transform and
     animation already belong to the drain, and one node never has two owners. */
  .turnTimerUrgent {
    animation: timerPulse 0.6s ease-in-out infinite alternate;
  }

  /* Refused action.
     Placed over the empty upper felt. It used to sit at `bottom: 82px` — exactly
     the action bar's reserve — which laid it straight across the hand, so the
     player was told "that card does not match" by a banner covering the cards they
     were choosing between. It also ran `white-space: nowrap`, which sent a
     translated sentence off both edges of a phone.
     Flat fill and a shallower ledge than any button on the board: this is a label,
     not something to press. */
  .errorToast {
    position: absolute;
    top: 30%;
    left: 50%;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    max-width: min(300px, 84vw);
    background: var(--color-error);
    color: var(--color-on-dark);
    font: 600 15px/1.3 var(--font-body);
    text-align: left;
    text-wrap: balance;
    padding: 10px 18px;
    border-radius: var(--radius-md);
    border: var(--stroke-thin) solid var(--color-stroke);
    box-shadow:
      0 3px 0 var(--color-stroke-soft),
      0 8px 20px rgba(28, 14, 56, 0.3);
    pointer-events: none;
    z-index: 30;
    animation: toastSlideUp 0.24s var(--ease-bounce) forwards;
  }

  .errorToast::before {
    content: '!';
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-full);
    background: #fff;
    color: var(--color-error);
    font: 700 15px/1 var(--font-display);
  }

  /* Top-right cluster: scores, preferences, audio, rules.
     Sits above the score table (z-index 45) rather than under it: the button that
     pins the table open is the same button that closes it, and a panel that
     swallows its own toggle is a trap on a touch device, where there is no TAB key
     to fall back on. Dialogs that own the screen (pickers 100, rules 1000) still
     cover the cluster. */
  .topRight {
    position: absolute;
    top: calc(12px + var(--safe-top));
    right: calc(12px + var(--safe-right));
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 46;
  }

  /* The way out, in the chip row. Same body as the scores chip beside it: this
     is chrome, and a control that looked different here would read as part of
     the game. */
  .leaveBtn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-card);
    color: var(--color-muted);
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    cursor: pointer;
    touch-action: manipulation;
    transition: color 0.15s;
  }

  .leaveBtn:hover {
    color: var(--color-ink);
  }

  /* Out of the flow, under the row it belongs to: the board is a fixed
     coordinate space and nothing here may push it around. */
  .leaveAsk {
    position: absolute;
    z-index: 46;
    top: calc(var(--space-base) + var(--topbar-h) + var(--space-sm) + var(--safe-top));
    right: calc(var(--space-base) + var(--safe-right));
    width: min(280px, calc(100vw - 2 * var(--space-base)));
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-md);
    background: var(--color-surface-card);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
  }

  .leaveAskText {
    margin: 0;
    font: 600 14px/1.4 var(--font-body);
    color: var(--color-ink);
  }

  /* Quiet is a hue and never an opacity: this is the consequence, under the
     question, and it must read at a glance without competing with it. */
  .leaveAskNote {
    margin: 0;
    font: 500 13px/1.45 var(--font-body);
    color: var(--color-muted);
  }

  .leaveAskRow {
    display: flex;
    gap: var(--space-sm);
  }

  /* The safe answer first and coloured, the way the waiting room's is. */
  .leaveStay,
  .leaveGo {
    flex: 1;
    min-height: 44px;
    padding: 8px 12px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    font: 700 14px/1.2 var(--font-display);
    cursor: pointer;
    touch-action: manipulation;
  }

  .leaveStay {
    background: var(--gradient-tertiary);
    color: var(--color-on-dark);
  }

  .leaveGo {
    background: var(--color-surface-strong);
    color: var(--color-muted);
  }

  .leaveGo:hover {
    color: var(--color-ink);
  }

  /* The rules opener is <RulesButton />, which carries its own chip styling. */

  /* Scores toggle — square icon button, and deliberately absent on desktop.
     Holding TAB is the faster way in and every pointer device has the key, so a
     permanent control there only spends room in the cluster. It appears where the
     key does not exist: a narrow viewport or any coarse pointer (a tablet has no
     TAB either, and it is wider than 480px). */
  .scoresBtn {
    display: none;
    /* This one only ever exists on a coarse pointer, which is exactly the case
       `.hit-target` is for. */
    position: relative;
    width: 40px;
    height: 40px;
    padding: 0;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--color-surface-card);
    color: var(--color-ink);
    cursor: pointer;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out);
    z-index: 15;
  }

  @media (max-width: 480px), (pointer: coarse) {
    .scoresBtn {
      display: flex;
    }
  }

  .scoresBtn:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 0 var(--color-stroke-soft);
  }
  .scoresBtn:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--color-stroke-soft);
  }

  /* Pinned open: the button says so, since the panel it opens can be dismissed by
     tapping the backdrop and nothing else would have changed. */
  .scoresBtn[aria-pressed='true'] {
    background: var(--color-primary);
    color: var(--color-on-primary);
  }

  /* Round indicator — top-left */
  .roundIndicator {
    position: absolute;
    top: calc(14px + var(--safe-top));
    left: calc(16px + var(--safe-left));
    padding: 6px 14px;
    background: var(--color-surface-card);
    border: var(--stroke-thin) solid var(--color-stroke);
    border-radius: var(--radius-full);
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    color: var(--color-ink);
    font: 700 13px/1.2 var(--font-display);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    pointer-events: none;
    z-index: 15;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes timerPulse {
    from {
      opacity: 1;
    }
    to {
      opacity: 0.45;
    }
  }

  @keyframes toastSlideUp {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(10px) scale(0.9);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }
  }

  @keyframes slideUp {
    from {
      transform: translateY(20px) scale(0.95);
      opacity: 0;
    }
    to {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
