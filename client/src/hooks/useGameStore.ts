import { create } from 'zustand'
import {
  CardDTO,
  CardColor,
  GameStateDTO,
  PlayerDTO,
  MatchFormat,
  ScoreboardEntryDTO,
  LatencyEntryDTO,
} from '../types/protocol'
import { clearSession, type PersistedSession, type RestoreTarget } from './sessionPersistence'

// How long other players have to punish a missed LOCO! call (server: catchWindow).
export const UNO_CATCH_WINDOW_MS = 5000

// 'restoring' is the screen a reloaded tab boots onto: we know which room and
// seat to ask for, and we have not heard back yet. It is its own screen rather
// than a flag over 'game' because the board has nothing to render at that point
// (no hand, no discard, no players), and a table drawn from an empty state
// behind an overlay is a broken table with a curtain over it.
// 'searching' and 'matchfound' are the two screens of the 1v1 queue. They are
// screens rather than flags for the same reason 'restoring' is: there is no
// board to render behind either of them, and neither has a room the player
// could act in yet.
export type AppScreen =
  | 'lobby'
  | 'searching'
  | 'matchfound'
  | 'waiting'
  | 'game'
  | 'gameover'
  | 'restoring'

export interface SwapNotice {
  kind: 'swap' | 'global_switch'
  actorIndex: number
  targetIndex: number  // -1 for global_switch
  direction: number    // game direction at the time of the play (for global_switch arrow)
  at: number           // Date.now() — used as a render key so React re-mounts the banner
}

// One seat's open catch window: they hold a single card and have not declared.
export interface CatchWindow {
  seat: number
  endsAt: number
  // Set the moment we tap Contre-LOCO! on this seat. A missed call now costs a
  // card, and the server answers a few dozen milliseconds later, so a window
  // left armed in the meantime would let one impatient double tap pay twice for
  // a single opinion. The 400ms double-tap guard is not that window.
  attempted?: boolean
}

// deriveCatch picks the catch the UI offers: the window closest to expiring
// among the opponents'. Ours never counts: you cannot catch yourself, and at
// one card the action bar is showing us the LOCO! button instead. A window we
// already called on is spent, exactly like our own LOCO! button.
function deriveCatch(windows: CatchWindow[], myIndex: number) {
  let best: CatchWindow | null = null
  for (const w of windows) {
    if (w.seat === myIndex || w.attempted) continue
    if (!best || w.endsAt < best.endsAt) best = w
  }
  return { catchTarget: best ? best.seat : null, unoTimerEnd: best ? best.endsAt : null }
}

// The most recent card play, used by the renderer to fly the card from the
// acting player's seat to the discard pile. `at` doubles as a trigger key.
export interface LastPlay {
  actorIndex: number
  card: CardDTO
  at: number
}

// A successful out-of-turn interrupt. The server announces these separately
// from the resulting card_played so the client can give the steal its own
// presentation — it is the most dramatic thing that happens in a round.
export interface InterruptFlash {
  actorIndex: number
  /** Number of identical cards slammed down (batch interrupts stack). */
  count: number
  at: number
}

// A Contre-LOCO! that landed. The server names the caught seat and nothing
// else — who pressed the button is not on the wire — so this is the table's
// news: that seat owed a declaration and just paid for it.
export interface CatchFlash {
  /** The caught seat, i.e. the one taking the penalty. */
  seat: number
  at: number
}

// What a missed declaration costs its owner (server: `undeclaredPenalty`). The
// banner and the penalty-card flight both state it, so it is written once here.
// Against fully exhausted piles the server hands over fewer cards (a draw never
// fails, it shrinks); the hand itself always comes from the server, so what is
// approximate in that corner case is the announcement, never the state.
export const CATCH_PENALTY_CARDS = 2

// Per-player points earned in the most recent round (computed as delta from prevScoreboard).
export interface RoundScoreEntry {
  player_index: number
  nickname: string
  round_points: number
  cumulative_score: number
  rounds_won: number
}

interface GameStore {
  screen: AppScreen
  roomCode: string
  myIndex: number
  sessionToken: string
  // Our own nickname, kept separately from `players`. A reloaded tab has no
  // player list yet and the rejoin message is built from the nickname, so
  // deriving it from the roster alone leaves a cold boot with nothing to send.
  myNickname: string
  // While screen === 'restoring', which rejoin the server is being asked for.
  // Null at every other time.
  restoreTarget: RestoreTarget | null
  myHand: CardDTO[]
  players: PlayerDTO[]
  discard: CardDTO | null
  activeColor: CardColor
  currentTurn: number
  direction: number
  pendingDraw: number
  hasDrawn: boolean
  errorMsg: string
  unoDeclared: boolean
  unoDeclaredByIndex: number   // playerIndex who declared UNO; -1 = unknown
  // True once WE have called it on the card we currently hold. A declaration is
  // spent: the server refuses a second one on the same single card, so the
  // button has to stop offering it. Cleared whenever a fresh obligation opens on
  // our seat (a Swap or a GlobalSwitch hands us a card nobody has heard called)
  // or our hand stops being a single card.
  myDeclared: boolean
  // Every seat that currently owes the table a declaration, with the end of its
  // 5 s window. A list rather than a single seat because a Swap or a
  // GlobalSwitch hands a single card to more than one player at once, and each
  // of them is catchable on their own. Mirrors the server's per-seat windows.
  catchWindows: CatchWindow[]
  // Derived from catchWindows for the UI: the most urgent catchable opponent
  // (never ourselves) and the end of that window. null = nobody to catch.
  catchTarget: number | null
  unoTimerEnd: number | null   // end of the 5s catch window (null = closed)
  // Whose Contre-LOCO! just missed and cost them a card. The penalty is public,
  // like the catch it lost to. Cleared by the GameView after a short timeout.
  catchFailed: { seat: number; at: number } | null
  // The mirror: a Contre-LOCO! that landed, for its slam banner, its sting and
  // the penalty cards flying to the caught seat. Cleared by the banner.
  catchFlash: CatchFlash | null
  turnDeadline: number | null  // unix ms when current turn expires (null = no timer)

  // The room this match is played in, straight off the wire. Server-drawn so
  // every seat sees one table; '' means the built-in felt (a lobby, or a map id
  // this client has no art for). See components/cards/maps.ts.
  mapId: string
  // Set while the table is shut waiting for everyone's assets, and null the
  // instant the server opens it. `ready` is the seats that are in, which is the loading
  // screen's whole content, and what tells a player the wait is somebody else's
  // connection rather than their own.
  mapLoading: { ready: number[] } | null

  // Match / round state
  matchFormat: MatchFormat
  maxPlayers: number
  roundNumber: number
  scoreboard: ScoreboardEntryDTO[]
  roundWinner: string
  matchWinner: string
  matchOver: boolean
  // roundHistory[k][playerIndex] = points scored in round k+1. Server-owned:
  // a reconnecting player must see the same table as everyone else, and the
  // cumulative scoreboard cannot be split back into rounds locally.
  roundHistory: number[][]
  // Per-seat round trips, refreshed by the server's periodic `latency`
  // broadcast. Purely informational: nothing reads it for a rules decision.
  latencies: LatencyEntryDTO[]
  showRoundSummary: boolean
  roundNumber_completed: number   // the round number that just finished (for display)
  roundScores: RoundScoreEntry[]  // per-player points earned this round
  pendingGameState: GameStateDTO | null // buffered next-round state (held while summary is visible)
  // buffered match-end payload (held while the final round summary is visible)
  pendingMatchEnd: { matchWinner: string; scoreboard: ScoreboardEntryDTO[] } | null

  // Transient notice shown when a Swap or GlobalSwitch resolves so players
  // understand why hands changed. Cleared by the GameView after a short timeout.
  swapNotice: SwapNotice | null

  // Last card play, purely for animation. Never used for rules decisions.
  lastPlay: LastPlay | null

  // Last successful out-of-turn interrupt, for its slam banner and sting.
  interruptFlash: InterruptFlash | null

  // Reconnect animation state
  isReconnecting: boolean

  // The server told this table it is being replaced (`server_updating`). The
  // match plays out to its end and nothing about it changes, so this is a line
  // of text and nothing else: no countdown, no disabled control, no urgency.
  // Cleared on reconnect, because the process that comes back may not be the
  // one that said it.
  serverUpdating: boolean

  // --- 1v1 matchmaking ---
  // When this search began, so the searching screen can time its own wait. It
  // times it locally on purpose: the server never says how many people are in
  // the queue, and an honest "this can take a while" beats a number that reads
  // like an instruction to give up.
  searchStartedAt: number | null
  // The opponent we drew, held for the versus reveal. `startsAt` is when the
  // server deals, so the reveal counts down to something real.
  matchFound: { opponentNickname: string; mySeat: number; startsAt: number } | null
  // This match came out of the queue: no host controls, a short abandon window,
  // and a game-over screen that offers another opponent rather than a rematch.
  isMatchmade: boolean
  // The seat that abandoned, when the match ended because somebody stopped
  // being there. null = the match ended on the cards.
  forfeitBy: number | null
  // An opponent who dropped and the instant their match is given away, so the
  // board can say how long this lasts instead of freezing with no explanation.
  opponentAway: { seat: number; deadline: number } | null
  // Seats that have asked for another match on the game-over screen. A rematch
  // is an agreement in every room, so every ask is public: the button has to be
  // able to say "they are waiting on you" as well as "you are waiting on them".
  rematchOffers: number[]
  // How many asks deal the next match: everybody still at the table. 0 until
  // the first one arrives, which is also when the count first means anything.
  rematchNeeded: number

  setScreen: (s: AppScreen) => void
  setRoomCode: (code: string) => void
  setMyIndex: (idx: number) => void
  setSessionToken: (token: string) => void
  setMyNickname: (nickname: string) => void
  beginRestore: (session: PersistedSession) => void
  abortRestore: (reason: string) => void
  applyGameState: (state: GameStateDTO) => void
  applyCardPlayed: (playerIndex: number, card: CardDTO, turn: number, pendingDraw: number, activeColor: CardColor | undefined, players?: PlayerDTO[], chosenPlayer?: number, direction?: number) => void
  setSwapNotice: (notice: SwapNotice | null) => void
  applyInterrupt: (actorIndex: number, count: number) => void
  clearInterrupt: () => void
  applyCardDrawn: (cards: CardDTO[] | null, playerIndex: number, turn: number, hasDrawn?: boolean, drawnCount?: number, pendingDraw?: number) => void
  setPlayers: (players: PlayerDTO[]) => void
  setError: (msg: string) => void
  setUnoDeclared: (val: boolean) => void
  setUnoDeclaredByIndex: (idx: number) => void
  applyUnoDeclared: (declarer: number) => void
  setUnoTimerEnd: (ts: number | null) => void
  clearCatchWindow: () => void
  closeCatchWindow: (seat: number) => void
  applyUnoCaught: (seat: number) => void
  clearCatchFlash: () => void
  pruneCatchWindows: () => void
  noteCatchAttempt: (seat: number) => void
  applyCatchFailed: (seat: number) => void
  clearCatchFailed: () => void
  setTurnDeadline: (ts: number | null) => void
  applyMatchLoading: (ready: number[]) => void
  applyMatchReady: (turn: number, turnDeadline: number | null) => void
  setLobbyConfig: (format: MatchFormat, maxPlayers: number) => void
  applyRoundEnd: (roundWinner: string, roundNumber: number, scoreboard: ScoreboardEntryDTO[], roundHistory?: number[][]) => void
  applyLatencies: (latencies: LatencyEntryDTO[]) => void
  applyMatchEnd: (matchWinner: string, scoreboard: ScoreboardEntryDTO[], forfeitBy?: number) => void
  beginSearch: () => void
  endSearch: () => void
  applyMatchFound: (found: {
    roomCode: string
    mySeat: number
    sessionToken: string
    players: PlayerDTO[]
    matchFormat: MatchFormat
    maxPlayers: number
    startsInMs: number
  }) => void
  applyOpponentAway: (seat: number, deadline: number) => void
  applyRematchOffers: (offers: number[], needed: number) => void
  clearRematchOffers: () => void
  clearOpponentAway: (seat: number) => void
  resetToHome: () => void
  applyRematch: (myIndex: number, players: PlayerDTO[], format: MatchFormat, maxPlayers: number) => void
  setPendingGameState: (state: GameStateDTO) => void
  setPendingMatchEnd: (matchWinner: string, scoreboard: ScoreboardEntryDTO[]) => void
  applyPendingGameState: () => void
  dismissRoundSummary: () => void
  setIsReconnecting: (val: boolean) => void
  setServerUpdating: (val: boolean) => void
  clearError: () => void
}

/**
 * Drop the copies of `card` the server just discarded from our hand.
 *
 * One `card_played` can stand for several discards: a batch play or a batch
 * interrupt slams *every* identical copy the player holds. Removing exactly one
 * left the rest as phantom cards — they rendered, they could be tapped, and the
 * server refused each tap with "card not in hand" until the round ended.
 *
 * `targetSize` is the server's own `hand_size` for our seat and it is the
 * authority: copies come off until the local hand matches it. With no authority
 * to compare against we fall back to a single copy, which is the ordinary play.
 * A server hand that is *larger* than ours removes nothing — that is a desync a
 * `game_state` has to settle, and guessing here would only widen it.
 *
 * Copies come off the end so the survivors keep their `handCardKeys` identity
 * and slide into the gap instead of remounting.
 */
export function removePlayedCards(
  hand: CardDTO[],
  card: CardDTO,
  targetSize?: number,
): CardDTO[] {
  const wanted =
    typeof targetSize === 'number' ? Math.max(0, hand.length - targetSize) : 1
  if (wanted === 0) return hand
  const next = [...hand]
  let removed = 0
  for (let i = next.length - 1; i >= 0 && removed < wanted; i--) {
    const c = next[i]
    if (c.color === card.color && c.kind === card.kind && c.value === card.value) {
      next.splice(i, 1)
      removed++
    }
  }
  return removed > 0 ? next : hand
}

// makeSwapNotice returns a fresh notice for a Swap or GlobalSwitch play, or null
// for any other card kind (caller keeps the previous notice in that case).
function makeSwapNotice(
  card: CardDTO,
  actorIndex: number,
  chosenPlayer: number | null | undefined,
  direction: number,
): SwapNotice | null {
  if (card.kind === 'swap') {
    return {
      kind: 'swap',
      actorIndex,
      targetIndex: typeof chosenPlayer === 'number' ? chosenPlayer : -1,
      direction,
      at: Date.now(),
    }
  }
  if (card.kind === 'global_switch') {
    return {
      kind: 'global_switch',
      actorIndex,
      targetIndex: -1,
      direction,
      at: Date.now(),
    }
  }
  return null
}

function gameStateSliceFromDTO(state: GameStateDTO) {
  return {
    myIndex: state.your_index,
    myHand: state.hand,
    players: state.players,
    discard: state.discard,
    activeColor: state.active_color,
    currentTurn: state.turn,
    direction: state.direction,
    pendingDraw: state.pending_draw ?? 0,
    hasDrawn: state.has_drawn ?? false,
    roundNumber: state.round_number ?? 1,
    mapId: state.map_id ?? '',
    matchFormat: state.match_format ?? 'BO1',
    maxPlayers: state.max_players ?? 10,
    scoreboard: state.scoreboard ?? [],
    roundHistory: state.round_history ?? [],
    turnDeadline: state.turn_deadline ?? null,
  }
}

export const useGameStore = create<GameStore>((set, get) => ({
  screen: 'lobby',
  roomCode: '',
  myIndex: -1,
  sessionToken: '',
  myNickname: '',
  restoreTarget: null,
  myHand: [],
  players: [],
  discard: null,
  activeColor: 'red',
  currentTurn: 0,
  direction: 1,
  pendingDraw: 0,
  hasDrawn: false,
  errorMsg: '',
  unoDeclared: false,
  unoDeclaredByIndex: -1,
  myDeclared: false,
  catchWindows: [],
  catchTarget: null,
  unoTimerEnd: null,
  catchFailed: null,
  catchFlash: null,
  turnDeadline: null,
  mapId: '',
  mapLoading: null,
  matchFormat: 'BO1',
  maxPlayers: 10,
  roundNumber: 1,
  scoreboard: [],
  roundWinner: '',
  matchWinner: '',
  matchOver: false,
  roundHistory: [],
  latencies: [],
  showRoundSummary: false,
  roundNumber_completed: 0,
  roundScores: [],
  pendingGameState: null,
  pendingMatchEnd: null,
  swapNotice: null,
  lastPlay: null,
  interruptFlash: null,
  isReconnecting: false,
  serverUpdating: false,
  searchStartedAt: null,
  matchFound: null,
  isMatchmade: false,
  forfeitBy: null,
  opponentAway: null,
  rematchOffers: [],
  rematchNeeded: 0,

  // Leaving 'restoring' is what "the reclaim landed" means, and every landing
  // path goes through here (player_reconnected, room_joined, match_loading), so
  // this is the one place the target has to be retired.
  setScreen: (screen) =>
    set((s) => ({ screen, restoreTarget: screen === 'restoring' ? s.restoreTarget : null })),
  setRoomCode: (roomCode) => set({ roomCode }),
  setMyIndex: (myIndex) => set({ myIndex }),
  setSessionToken: (sessionToken) => set({ sessionToken }),
  setMyNickname: (myNickname) => set({ myNickname }),

  // Boot straight into the reclaim, from a record written before the tab went
  // away. Nothing here is authoritative: the seat, the hand and the score all
  // arrive with the server's answer.
  beginRestore: (session) =>
    set({
      screen: 'restoring',
      restoreTarget: session.target,
      roomCode: session.roomCode,
      myNickname: session.nickname,
      sessionToken: session.sessionToken,
      errorMsg: '',
    }),

  // The reclaim could not land: refused, or never answered. Drop the record so
  // the next load does not replay the same refusal, and hand the player back a
  // lobby that says why rather than a spinner that does not end.
  abortRestore: (reason) =>
    set((s) => {
      if (s.screen !== 'restoring') return s
      clearSession()
      return {
        screen: 'lobby' as AppScreen,
        restoreTarget: null,
        roomCode: '',
        sessionToken: '',
        myIndex: -1,
        errorMsg: reason,
      }
    }),

  applyGameState: (state) =>
    set((s) => {
      // Open catch windows are FILTERED against the snapshot, not wiped. A Swap
      // or a GlobalSwitch is followed by a personalised game_state, so clearing
      // here meant the one situation this rule exists for, a player handed
      // their last card, was never catchable by anyone. A window survives only
      // while it is unexpired and its seat still holds exactly one card, so a
      // fresh deal (nobody on one card) still clears everything.
      const now = Date.now()
      const catchWindows = s.catchWindows.filter(
        (w) =>
          w.endsAt > now &&
          state.players.find((p) => p.index === w.seat)?.hand_size === 1,
      )
      return {
        ...gameStateSliceFromDTO(state),
        roundWinner: '',
        showRoundSummary: false,
        pendingGameState: null,
        pendingMatchEnd: null,
        // The banner is cosmetic and announces the previous one-card moment; a
        // fresh authoritative snapshot must not leave it hanging.
        unoDeclared: false,
        unoDeclaredByIndex: -1,
        // A declaration only covers the single card it was called on. Any other
        // hand — a fresh deal, a penalty, a card drawn — owes nothing yet.
        myDeclared: s.myDeclared && state.hand.length === 1,
        catchWindows,
        ...deriveCatch(catchWindows, state.your_index),
      }
    }),

  applyCardPlayed: (playerIndex, card, turn, pendingDraw, activeColor, players, chosenPlayer, direction) =>
    set((s) => {
      // Prefer server-provided player list (includes Finished/Placement); fall back to local update
      const updatedPlayers = players
        ? players
        : s.players.map((p) =>
            p.index === playerIndex ? { ...p, hand_size: p.hand_size - 1 } : p
          )
      // Use server-authoritative active color; fall back to card color or current.
      // 'wild' is never a playable colour — it matches nothing, so the colour in
      // play carries over (this is exactly what a GlobalSwitch does).
      const resolvedColor: CardColor =
        activeColor && activeColor !== 'wild'
          ? activeColor
          : card.color === 'wild'
            ? s.activeColor
            : card.color
      // Remove the played card from local hand if it was our play
      let updatedHand = s.myHand
      if (playerIndex === s.myIndex) {
        updatedHand = removePlayedCards(
          s.myHand,
          card,
          updatedPlayers.find((p) => p.index === s.myIndex)?.hand_size
        )
      }
      // Surface a transient notice when a hand-swapping card resolves so non-actors
      // understand why their (or others') card counts just changed.
      const resolvedDirection = typeof direction === 'number' && direction !== 0 ? direction : s.direction
      const swapNotice = makeSwapNotice(card, playerIndex, chosenPlayer, resolvedDirection) ?? s.swapNotice
      // Catch windows, mirroring the server. An ordinary play only puts the
      // actor on the hook; a Swap or a GlobalSwitch rearranges hands, so EVERY
      // seat left holding a single card owes the table a declaration: the hand
      // it holds is not one anybody has heard announced.
      const rearranged = card.kind === 'swap' || card.kind === 'global_switch'
      const onTheHook = rearranged
        ? updatedPlayers.filter((p) => p.hand_size === 1).map((p) => p.index)
        : updatedPlayers.find((p) => p.index === playerIndex)?.hand_size === 1
          ? [playerIndex]
          : []
      const now = Date.now()
      const catchWindows: CatchWindow[] = [
        ...s.catchWindows.filter((w) => w.endsAt > now && !onTheHook.includes(w.seat)),
        ...onTheHook.map((seat) => ({ seat, endsAt: now + UNO_CATCH_WINDOW_MS })),
      ]
      // Any fresh window retires the declaration banner: it announced the
      // previous one-card situation, and the table has moved on.
      const voidsBanner = onTheHook.length > 0
      return {
        myHand: updatedHand,
        discard: card,
        activeColor: resolvedColor,
        currentTurn: turn,
        direction: resolvedDirection,
        pendingDraw,
        hasDrawn: false,
        players: updatedPlayers,
        unoDeclared: voidsBanner ? false : s.unoDeclared,
        unoDeclaredByIndex: voidsBanner ? -1 : s.unoDeclaredByIndex,
        // A window reopening on our own seat is a new obligation, exactly like
        // the server's openCatchWindow: what we called earlier was another card.
        myDeclared: onTheHook.includes(s.myIndex)
          ? false
          : s.myDeclared && updatedHand.length === 1,
        catchWindows,
        ...deriveCatch(catchWindows, s.myIndex),
        swapNotice,
        lastPlay: { actorIndex: playerIndex, card, at: Date.now() },
      }
    }),

  setSwapNotice: (swapNotice) => set({ swapNotice }),

  applyInterrupt: (actorIndex, count) =>
    set({ interruptFlash: { actorIndex, count, at: Date.now() } }),

  clearInterrupt: () => set({ interruptFlash: null }),

  applyCardDrawn: (cards, playerIndex, turn, hasDrawn, drawnCount, pendingDraw) =>
    set((s) => {
      // `has_drawn` / `pending_draw` are taken from the message, never guessed.
      // Not every card_drawn is a turn action: the UNO-catch penalty grows a hand
      // while somebody else's draw-once state is what it was, and the same
      // message reaches the whole table. Defaulting the missing flag to "drawn"
      // is what stuck a player with a disabled Draw button and a Pass the server
      // answered "you must draw a card before passing" until the turn timer ran
      // out. Absent means unchanged; the server fills both in on every card_drawn.
      // A hand that grew is off one card, and the server answers every catch on
      // that seat with "target does not have exactly 1 card". Keeping the window
      // open leaves Contre-LOCO! armed on a tap that can only come back refused.
      const catchWindows = s.catchWindows.filter((w) => w.seat !== playerIndex)
      const turnState = {
        currentTurn: turn,
        hasDrawn: hasDrawn ?? s.hasDrawn,
        pendingDraw: pendingDraw ?? s.pendingDraw,
        catchWindows,
        ...deriveCatch(catchWindows, s.myIndex),
      }
      if (cards && cards.length > 0) {
        return { ...turnState, myHand: [...s.myHand, ...cards] }
      }
      // Observer: update hand size by the count the server sent. Absent means
      // nothing, never "probably one": a draw against exhausted piles hands over
      // zero cards, and guessing there adds a card to a hand that did not grow —
      // the same class of desync as inferring has_drawn above.
      const count = drawnCount ?? 0
      const players = s.players.map((p) =>
        p.index === playerIndex ? { ...p, hand_size: p.hand_size + count } : p
      )
      return { ...turnState, players }
    }),

  // Re-resolves myIndex from our own nickname on every roster update. The server
  // re-indexes seats when someone leaves a lobby or a finished room, so a client
  // that holds a stale index would lose host controls (or claim someone else's).
  // Nicknames are unique per room, so the match is unambiguous.
  setPlayers: (players) =>
    set((s) => {
      const myNickname = s.players.find((p) => p.index === s.myIndex)?.nickname
      if (!myNickname) return { players }
      const mine = players.find((p) => p.nickname === myNickname)
      return mine ? { players, myIndex: mine.index } : { players }
    }),
  setError: (errorMsg) => set({ errorMsg }),
  setUnoDeclared: (unoDeclared) => set({ unoDeclared }),
  setUnoDeclaredByIndex: (unoDeclaredByIndex) => set({ unoDeclaredByIndex }),

  // One seat called it. The banner is for the table; `myDeclared` is the part
  // that spends our own button, and it is set from the server's confirmation
  // rather than from the click, so a refused call leaves the button live.
  applyUnoDeclared: (declarer) =>
    set((s) => {
      const catchWindows = s.catchWindows.filter((w) => w.seat !== declarer)
      return {
        unoDeclared: true,
        unoDeclaredByIndex: declarer,
        myDeclared: declarer === s.myIndex ? true : s.myDeclared,
        catchWindows,
        ...deriveCatch(catchWindows, s.myIndex),
      }
    }),
  setUnoTimerEnd: (unoTimerEnd) => set({ unoTimerEnd }),
  clearCatchWindow: () => set({ catchWindows: [], catchTarget: null, unoTimerEnd: null }),

  // One seat is settled (it declared, or it was caught and took the penalty).
  // The others stay on the hook: after a GlobalSwitch there can be several, and
  // closing them all would hand the slow ones a free pass.
  closeCatchWindow: (seat) =>
    set((s) => {
      const catchWindows = s.catchWindows.filter((w) => w.seat !== seat)
      return { catchWindows, ...deriveCatch(catchWindows, s.myIndex) }
    }),

  // A Contre-LOCO! landed on `seat`. Two things at once, and they belong
  // together: the seat is settled (it took the penalty, so nobody else may
  // catch it) and the table is told, which until now it never was — the caught
  // player's hand simply grew by two with nothing on screen to say why, and the
  // catcher got no answer at all beyond a button that went quiet. It is the
  // game's hardest reaction and it was also its most silent.
  applyUnoCaught: (seat) =>
    set((s) => {
      const catchWindows = s.catchWindows.filter((w) => w.seat !== seat)
      return {
        catchWindows,
        ...deriveCatch(catchWindows, s.myIndex),
        catchFlash: { seat, at: Date.now() },
      }
    }),

  clearCatchFlash: () => set({ catchFlash: null }),

  // Drops windows whose 5 s ran out. The server enforces the same deadline, so
  // a late click would only earn an error toast.
  pruneCatchWindows: () =>
    set((s) => {
      const now = Date.now()
      const catchWindows = s.catchWindows.filter((w) => w.endsAt > now)
      if (catchWindows.length === s.catchWindows.length) return s
      return { catchWindows, ...deriveCatch(catchWindows, s.myIndex) }
    }),

  // Spends the button on this seat the moment we press it, before the server has
  // answered. A missed Contre-LOCO! costs a card now, so the cost of leaving it
  // armed for one more round trip is a second penalty for the same call.
  noteCatchAttempt: (seat) =>
    set((s) => {
      const catchWindows = s.catchWindows.map((w) =>
        w.seat === seat ? { ...w, attempted: true } : w
      )
      return { catchWindows, ...deriveCatch(catchWindows, s.myIndex) }
    }),

  // Somebody's call arrived too late and they drew for it. The +1 card itself
  // comes through the ordinary card_drawn path; this is only the notice.
  applyCatchFailed: (seat) => set({ catchFailed: { seat, at: Date.now() } }),

  clearCatchFailed: () => set({ catchFailed: null }),
  setTurnDeadline: (turnDeadline) => set({ turnDeadline }),

  // The table is shut. Also clears the turn deadline: game_started arrives with
  // no clock (the server does not arm one until match_ready), and a stale
  // deadline left over from the previous round would drain a bar over a loading
  // screen for a turn nobody can take yet.
  applyMatchLoading: (ready) => set({ mapLoading: { ready }, turnDeadline: null }),

  // The table is open. This, not game_started, is where a match actually
  // begins. The deadline comes from the same message so the bar and the server's
  // clock start together.
  applyMatchReady: (turn, turnDeadline) =>
    set({ mapLoading: null, currentTurn: turn, turnDeadline }),

  setLobbyConfig: (matchFormat, maxPlayers) => set({ matchFormat, maxPlayers }),

  applyLatencies: (latencies) => set({ latencies }),

  applyRoundEnd: (roundWinner, roundNumber, newScoreboard, roundHistory) =>
    set((s) => {
      // Compute per-player round points as the delta vs current scoreboard
      const roundScores: RoundScoreEntry[] = newScoreboard.map((entry) => {
        const prev = s.scoreboard.find((p) => p.player_index === entry.player_index)
        return {
          player_index: entry.player_index,
          nickname: entry.nickname,
          round_points: prev ? entry.score - prev.score : entry.score,
          cumulative_score: entry.score,
          rounds_won: entry.rounds_won,
        }
      })
      return {
        roundWinner,
        roundNumber_completed: roundNumber,
        scoreboard: newScoreboard,
        // The next game_state (which also carries the history) is buffered
        // behind the round summary, so take it here or the score table would
        // be one round stale for as long as the summary is up.
        roundHistory: roundHistory ?? s.roundHistory,
        roundScores,
        showRoundSummary: true,
        turnDeadline: null,
        unoDeclared: false,
        myDeclared: false,
        catchWindows: [],
        unoTimerEnd: null,
        catchTarget: null,
        catchFailed: null,
        catchFlash: null,
      }
    }),

  applyMatchEnd: (matchWinner, scoreboard, forfeitBy) =>
    set({
      matchWinner,
      matchOver: true,
      scoreboard,
      screen: 'gameover',
      // A forfeit is the one match end that can land while a round summary is
      // still up: the opponent quits, and nothing is waiting on a dismissal any
      // more. The ordinary path never gets here with a summary showing.
      showRoundSummary: false,
      forfeitBy: typeof forfeitBy === 'number' ? forfeitBy : null,
      // The countdown is over one way or the other: either they came back or
      // the match was given away, and both end the notice.
      opponentAway: null,
    }),

  // --- 1v1 matchmaking ---

  // The search screen owns its own clock. Nothing about the queue arrives from
  // the server beyond "you are in it", which is the point: a client that could
  // render the queue's size would eventually render "1".
  beginSearch: () =>
    set({ screen: 'searching', searchStartedAt: Date.now(), matchFound: null, errorMsg: '' }),

  // Leaving the queue, whether the player cancelled or the server dropped them
  // out of a pairing that fell apart. Guarded on the screen so an acknowledgement
  // that arrives after a match was found cannot yank a seated player home.
  endSearch: () =>
    set((s) =>
      s.screen === 'searching' ? { screen: 'lobby' as AppScreen, searchStartedAt: null } : s,
    ),

  // An opponent, a seat and a token, all at once: a matchmade room skips the
  // waiting room entirely, so this does the work room_joined does plus the
  // reveal.
  applyMatchFound: (found) =>
    set({
      screen: 'matchfound',
      searchStartedAt: null,
      isMatchmade: true,
      roomCode: found.roomCode,
      myIndex: found.mySeat,
      sessionToken: found.sessionToken,
      players: found.players,
      myNickname: found.players.find((p) => p.index === found.mySeat)?.nickname ?? '',
      matchFormat: found.matchFormat,
      maxPlayers: found.maxPlayers,
      forfeitBy: null,
      opponentAway: null,
      rematchOffers: [],
      rematchNeeded: 0,
      errorMsg: '',
      matchFound: {
        opponentNickname: found.players.find((p) => p.index !== found.mySeat)?.nickname ?? '',
        mySeat: found.mySeat,
        startsAt: Date.now() + found.startsInMs,
      },
    }),

  // Only a deadline makes this worth showing: an ordinary room holds the seat
  // for a minute and says so through the roster, where a matchmade one is about
  // to end the match and owes the player at the table a number.
  applyOpponentAway: (seat, deadline) =>
    set(deadline > 0 ? { opponentAway: { seat, deadline } } : {}),

  clearOpponentAway: (seat) =>
    set((s) => (s.opponentAway?.seat === seat ? { opponentAway: null } : s)),

  // The server sends the whole offer state, not the increment, and this stores
  // it as sent. A seat leaving retires its ask and re-bases the ones above it,
  // so a client accumulating seat numbers would keep a departed player's ask
  // forever and show a count that never completes.
  applyRematchOffers: (offers, needed) => set({ rematchOffers: offers, rematchNeeded: needed }),

  // A matchmade table has no offer state left once the opponent is gone: there
  // is nobody to agree with, and a button still reading "accept" would refuse.
  clearRematchOffers: () => set({ rematchOffers: [], rematchNeeded: 0 }),

  // Back to the front door with nothing carried over. The seat is gone
  // server-side by the time this runs, so the token and the room code are not
  // stale state, they are wrong state.
  resetToHome: () =>
    set({
      screen: 'lobby',
      roomCode: '',
      sessionToken: '',
      myIndex: -1,
      players: [],
      myHand: [],
      discard: null,
      isMatchmade: false,
      matchFound: null,
      searchStartedAt: null,
      forfeitBy: null,
      opponentAway: null,
      rematchOffers: [],
      rematchNeeded: 0,
      matchWinner: '',
      matchOver: false,
      scoreboard: [],
      roundHistory: [],
      roundScores: [],
      latencies: [],
      showRoundSummary: false,
      pendingGameState: null,
      pendingMatchEnd: null,
      mapId: '',
      mapLoading: null,
      turnDeadline: null,
      catchWindows: [],
      catchTarget: null,
      unoTimerEnd: null,
      unoDeclared: false,
      unoDeclaredByIndex: -1,
      myDeclared: false,
      catchFailed: null,
      catchFlash: null,
      swapNotice: null,
      lastPlay: null,
      interruptFlash: null,
      isReconnecting: false,
      errorMsg: '',
    }),

  // The host reopened the finished room: drop all match state and go back to the
  // waiting room. myIndex comes from the server because pruning absent players
  // can re-seat everyone. sessionToken is deliberately kept — the room is the
  // same, so it still authenticates a reconnect during the next match.
  applyRematch: (myIndex, players, matchFormat, maxPlayers) =>
    set({
      screen: 'waiting',
      myIndex,
      players,
      matchFormat,
      maxPlayers,
      myHand: [],
      discard: null,
      activeColor: 'red',
      currentTurn: 0,
      direction: 1,
      pendingDraw: 0,
      hasDrawn: false,
      roundNumber: 1,
      // The next match draws its own room, and its assets are ones this client
      // may not hold yet, so the gate re-arms and the map is unknown until then.
      mapId: '',
      mapLoading: null,
      scoreboard: [],
      roundHistory: [],
      latencies: [],
      roundWinner: '',
      roundScores: [],
      roundNumber_completed: 0,
      matchWinner: '',
      matchOver: false,
      showRoundSummary: false,
      pendingGameState: null,
      pendingMatchEnd: null,
      unoDeclared: false,
      unoDeclaredByIndex: -1,
      myDeclared: false,
      catchWindows: [],
      unoTimerEnd: null,
      catchTarget: null,
      catchFailed: null,
      catchFlash: null,
      turnDeadline: null,
      swapNotice: null,
      lastPlay: null,
      interruptFlash: null,
      isReconnecting: false,
      errorMsg: '',
    }),

  setPendingGameState: (pendingGameState) => set({ pendingGameState }),

  setPendingMatchEnd: (matchWinner, scoreboard) =>
    set({ pendingMatchEnd: { matchWinner, scoreboard } }),

  applyPendingGameState: () => {
    if (!get().pendingGameState) return
    get().dismissRoundSummary()
  },

  dismissRoundSummary: () => {
    const s = get()
    // Priority 1: final round — transition to game over screen.
    if (s.pendingMatchEnd) {
      set({
        matchWinner: s.pendingMatchEnd.matchWinner,
        matchOver: true,
        scoreboard: s.pendingMatchEnd.scoreboard,
        screen: 'gameover',
        showRoundSummary: false,
        pendingMatchEnd: null,
      })
      return
    }
    // Priority 2: mid-match — apply the buffered next-round state.
    if (s.pendingGameState) {
      set({
        ...gameStateSliceFromDTO(s.pendingGameState),
        roundWinner: '',
        showRoundSummary: false,
        pendingGameState: null,
        unoDeclared: false,
        unoDeclaredByIndex: -1,
        myDeclared: false,
        catchWindows: [],
        unoTimerEnd: null,
        catchTarget: null,
        catchFailed: null,
        catchFlash: null,
      })
      return
    }
    // Default: just hide the summary (e.g. BO1 game-over path).
    set({ showRoundSummary: false })
  },

  setIsReconnecting: (isReconnecting) => set({ isReconnecting }),

  setServerUpdating: (serverUpdating) => set({ serverUpdating }),

  clearError: () => set({ errorMsg: '' }),
}))
