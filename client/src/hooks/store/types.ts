import {
  CardDTO,
  CardColor,
  GameStateDTO,
  PlayerDTO,
  MatchFormat,
  ScoreboardEntryDTO,
  LatencyEntryDTO,
  LiveStreamDTO,
  MatchRecordDTO,
  Emote,
} from '../../types/protocol'
import type { PersistedSession, RestoreTarget } from '../sessionPersistence'

// How long other players have to punish a missed LOCO! call (server: catchWindow).
export const UNO_CATCH_WINDOW_MS = 5000

// What a missed declaration costs its owner (server: `undeclaredPenalty`). The
// banner and the penalty-card flight both state it, so it is written once here.
// Against fully exhausted piles the server hands over fewer cards (a draw never
// fails, it shrinks); the hand itself always comes from the server, so what is
// approximate in that corner case is the announcement, never the state.
export const CATCH_PENALTY_CARDS = 2

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
  at: number           // Date.now() — the key that makes a second notice a second banner
}

/**
 * A seat that left the match for good: walked out on purpose, or held until the
 * reconnect window ran out. The two are the same news to everybody else — that
 * chair is empty for the rest of the match — so they get the same line.
 */
export interface SeatDeparture {
  nickname: string
  at: number // Date.now() — the key that makes a second departure a second banner
}

/**
 * One seat the server says is on the hook, straight off `card_played`. The
 * client turns these into `CatchWindow`s and adds nothing to them but its own
 * memory of which button it has already pressed.
 */
export interface CatchSeatDTO {
  player_index: number
  ends_at: number
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

/**
 * One seat saying one of the three things, and **at most one entry per seat**.
 *
 * A seat speaking again replaces what it said rather than adding to it: the
 * screen holds one line per player, so the card's height is decided by the
 * table's size and never by how much it talks. A feed that grew pushed the
 * scoreboard, the two offers and the way out down the card under everybody's
 * thumb. Nothing about any of it is kept — it goes home with the match.
 */
export interface EmoteFlash {
  seat: number
  emote: Emote
  /** Arrival. The render key the pop animation is re-armed on. */
  at: number
}

// Per-player points earned in the most recent round (computed as delta from prevScoreboard).
export interface RoundScoreEntry {
  player_index: number
  nickname: string
  round_points: number
  cumulative_score: number
  rounds_won: number
}

/**
 * One state object, because that is what it is: the client's mirror of one
 * match. The transitions are grouped into the five interfaces below, and
 * several of them write across the groups on purpose: an authoritative
 * snapshot settles the board, the declarations and the scoreboard at once.
 */
export interface GameState {
  // --- Who we are and where ---
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
  errorMsg: string
  // Reconnect animation state
  isReconnecting: boolean
  // The server told this table it is being replaced (`server_updating`). The
  // match plays out to its end and nothing about it changes, so this is a line
  // of text and nothing else: no countdown, no disabled control, no urgency.
  // Cleared on reconnect, because the process that comes back may not be the
  // one that said it.
  serverUpdating: boolean
  // How many sockets the server is holding, straight off `players_online`. A
  // sign of life on the home screen and nothing else: it names nobody, it is
  // not the matchmaking queue, and nothing here ever decides anything on it.
  // 0 until the server has said, which is also the value that draws nothing.
  playersOnline: number
  // The channels streaming this game right now, biggest first, straight off
  // `live_streams`. Drawn on the home screen and nowhere else, exactly like the
  // count above: it decides nothing, and the order is the server's — which is
  // Twitch's — so nothing here ever re-sorts it. Empty until the server says,
  // which is also what a server with no gateway key always says.
  liveStreams: LiveStreamDTO[]

  // --- The board ---
  myHand: CardDTO[]
  players: PlayerDTO[]
  discard: CardDTO | null
  activeColor: CardColor
  currentTurn: number
  direction: number
  pendingDraw: number
  hasDrawn: boolean
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
  // Transient notice shown when a Swap or GlobalSwitch resolves so players
  // understand why hands changed. Cleared by the GameView after a short timeout.
  swapNotice: SwapNotice | null
  // Last card play, purely for animation. Never used for rules decisions.
  lastPlay: LastPlay | null
  // Last successful out-of-turn interrupt, for its slam banner and sting.
  interruptFlash: InterruptFlash | null
  // Per-seat round trips, refreshed by the server's periodic `latency`
  // broadcast. Purely informational: nothing reads it for a rules decision.
  latencies: LatencyEntryDTO[]

  // --- Declarations and catches ---
  unoDeclared: boolean
  unoDeclaredByIndex: number   // playerIndex who declared UNO; -1 = unknown
  // Every seat whose current single card has already been called, ours
  // included. A declaration is spent: it covers the one card it was called on,
  // so a seat leaves this list the moment its hand stops being that single card
  // or a fresh obligation opens on it (a Swap or a GlobalSwitch hands it a card
  // nobody has heard called).
  //
  // It is what the table *heard*, never an inference: a seat we have heard
  // nothing about is absent, which is the reading that keeps Contre-LOCO!
  // pressable rather than the one that greys it out.
  declaredSeats: number[]
  // True once WE have called it on the card we currently hold, so our own LOCO!
  // button stops offering a call the server would refuse. **Derived** from
  // `declaredSeats` and `myIndex` by the store itself
  // (`store/deriveCatchMiddleware.ts`), never written by an action.
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
  // Whether the centre button is pressable at all — a much looser question than
  // `catchTarget`, which is the promise that somebody is actually on the hook.
  // **Derived and latched** by the store itself (`store/deriveCatchMiddleware.ts`
  // through `components/catchAvailability.ts`), never written by an action
  // except to put it back down: it rises the moment any other seat comes within
  // reach of the finish, and only a card played or a fresh authoritative
  // snapshot lowers it again. A seat escaping — declaring, drawing, taking a
  // stack of four — leaves it exactly where it is, because a button that
  // retracts under the thumb aiming at it is the interface reading the table on
  // the player's behalf.
  catchLive: boolean
  // Whose Contre-LOCO! just missed and cost them a card. The penalty is public,
  // like the catch it lost to. Cleared by the GameView after a short timeout.
  catchFailed: { seat: number; at: number } | null
  // Whether we have already spent a Contre-LOCO! on the board as it stands. The
  // server charges a fruitless call at most once per card played, and this is
  // the client's half of that rule: a second *blind* press — one that names no
  // seat, because none is on the hook — is not sent at all while this is true.
  //
  // It is not only about spam. Tapping twice on a catch that lands would send
  // the second press with no target, and the server would read that as a fresh
  // wager against a board where the window has just shut: a card, charged in the
  // same breath as the catch we just won. Cleared by `applyCardPlayed`, which is
  // exactly what moves the server's own epoch on.
  catchSpent: boolean
  // The mirror: a Contre-LOCO! that landed, for its slam banner, its sting and
  // the penalty cards flying to the caught seat. Cleared by the banner.
  catchFlash: CatchFlash | null

  // --- Match / round state ---
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
  // Every match this table has finished, oldest first, the one just ended
  // included. The evening rather than the match: a rematch wipes the scoreboard,
  // so this is the only thing that can say who won six matches on one code.
  // Server-owned like roundHistory and for the same reason. Read by the
  // game-over screen and nowhere else.
  matchHistory: MatchRecordDTO[]
  showRoundSummary: boolean
  roundNumber_completed: number   // the round number that just finished (for display)
  roundScores: RoundScoreEntry[]  // per-player points earned this round
  // buffered match-end payload (held while the final round summary is visible).
  // The only thing behind that card that is buffered: nothing follows a match
  // end, so nothing can move past it. The next round's board is deliberately
  // NOT — see dismissRoundSummary.
  pendingMatchEnd: {
    matchWinner: string
    scoreboard: ScoreboardEntryDTO[]
    matchHistory: MatchRecordDTO[]
  } | null
  // Seats that have asked for another match on the game-over screen. A rematch
  // is an agreement in every room, so every ask is public: the button has to be
  // able to say "they are waiting on you" as well as "you are waiting on them".
  rematchOffers: number[]
  // How many asks deal the next match: everybody still at the table. 0 until
  // the first one arrives, which is also when the count first means anything.
  rematchNeeded: number
  // What the table is saying on the game-over screen: one entry per seat, the
  // last thing that seat said. Nothing persists it, here or on the server, and
  // it goes with the match.
  emotes: EmoteFlash[]

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
  // A 1v1 against the server: one human, one bot, dealt on the press. Set from
  // the identity its `game_started` carries, which no other path sends. The
  // game-over screen reads it to offer another press rather than a rematch
  // nobody is there to agree to.
  isSolo: boolean
  // The host said this table's code must not be readable on anybody's screen,
  // because it is on theirs and theirs is being captured. The one preference in
  // this game that arrives over the wire, and it is a property of the table
  // rather than of this client: the local `streamerModePref` is ORed with it, so
  // turning the panel switch off never uncovers a code the host is hiding.
  tableStreamer: boolean
  // The seat that abandoned, when the match ended because somebody stopped
  // being there. null = the match ended on the cards.
  forfeitBy: number | null
  // Whether that seat was ours, answered once, when the message arrived. A
  // forfeit is the one match end that moves the seats it just named: the player
  // who left is removed from the roster and everybody above them re-bases, so
  // `forfeitBy` starts naming the player who *stayed* a few milliseconds after
  // the screen opens — and the game-over screen told them they had walked out of
  // a match they had just won. Seats are indices, and an index is only true for
  // as long as the roster it indexes.
  forfeitedByMe: boolean
  // An opponent who dropped and the instant their match is given away, so the
  // board can say how long this lasts instead of freezing with no explanation.
  opponentAway: { seat: number; deadline: number } | null
  // Seats whose reconnect window ran out mid-match. Held and gone read the same
  // in the roster — both are `connected: false` — and only one of them can come
  // back, so the difference has to be remembered rather than derived. It is what
  // decides whether this player still has anybody to play against, and the
  // server answers the same question the same way (hub: table.abandonedBy).
  goneSeats: number[]
  // The seat that just left, for the players who are still holding cards. A
  // departure mid-match moves the turn, shrinks the table and puts a hand back
  // into the deck, and until this notice the only sign of it was a bubble going
  // quiet: the roster's `connected` flag reads the same for somebody who left
  // for good and somebody whose wifi blinked. Cleared by the GameView after a
  // short timeout, exactly like the swap notice.
  departureNotice: SeatDeparture | null
}

/** Identity, screen and the two ways out of a table. */
export interface SessionActions {
  setScreen: (s: AppScreen) => void
  setRoomCode: (code: string) => void
  setMyIndex: (idx: number) => void
  setSessionToken: (token: string) => void
  setMyNickname: (nickname: string) => void
  beginRestore: (session: PersistedSession) => void
  abortRestore: (reason: string) => void
  setError: (msg: string) => void
  clearError: () => void
  setIsReconnecting: (val: boolean) => void
  setServerUpdating: (val: boolean) => void
  setPlayersOnline: (count: number) => void
  setLiveStreams: (streams: LiveStreamDTO[]) => void
  resetToHome: () => void
}

/** The board: what the server says is on it, and what just moved. */
export interface TableActions {
  applyGameState: (state: GameStateDTO) => void
  applyCardPlayed: (playerIndex: number, card: CardDTO, turn: number, pendingDraw: number, activeColor: CardColor | undefined, players?: PlayerDTO[], chosenPlayer?: number, direction?: number, catchSeats?: CatchSeatDTO[]) => void
  applyCardDrawn: (cards: CardDTO[] | null, playerIndex: number, turn: number, hasDrawn?: boolean, drawnCount?: number, pendingDraw?: number) => void
  setPlayers: (players: PlayerDTO[]) => void
  applyHostChange: (myIndex: number, players: PlayerDTO[]) => void
  noteSeatGone: (seat: number, nickname?: string) => void
  clearDepartureNotice: () => void
  setTableStreamer: (on: boolean) => void
  setTurnDeadline: (ts: number | null) => void
  setSwapNotice: (notice: SwapNotice | null) => void
  applyInterrupt: (actorIndex: number, count: number) => void
  clearInterrupt: () => void
  applyMatchLoading: (ready: number[]) => void
  applyMatchReady: (turn: number, turnDeadline: number | null) => void
  applyLatencies: (latencies: LatencyEntryDTO[]) => void
}

/** LOCO! and Contre-LOCO!: who owes a declaration and who may punish it. */
export interface LocoActions {
  setUnoDeclared: (val: boolean) => void
  setUnoDeclaredByIndex: (idx: number) => void
  applyUnoDeclared: (declarer: number) => void
  applyUnoCaught: (seat: number) => void
  clearCatchFlash: () => void
  pruneCatchWindows: () => void
  noteCatchAttempt: (seat: number) => void
  noteBlindCatchAttempt: () => void
  applyCatchFailed: (seat: number) => void
  clearCatchFailed: () => void
}

/** Rounds, the summary they queue behind, the end of a match and the next one. */
export interface MatchActions {
  setLobbyConfig: (format: MatchFormat, maxPlayers: number) => void
  applyRoundEnd: (roundWinner: string, roundNumber: number, scoreboard: ScoreboardEntryDTO[], roundHistory?: number[][]) => void
  applyMatchEnd: (
    matchWinner: string,
    scoreboard: ScoreboardEntryDTO[],
    matchHistory: MatchRecordDTO[],
    forfeitBy?: number,
  ) => void
  /**
   * The evening, re-based. Every row is indexed by seat, so a departure that
   * shrinks the roster shifts all of them: the server re-bases its copy and
   * sends it back on the message that moved the seats, and this is where that
   * copy lands. Never derived here — the seat that went is not in either roster
   * any more, so the client cannot say which column it was.
   */
  setMatchHistory: (matchHistory: MatchRecordDTO[]) => void
  setPendingMatchEnd: (
    matchWinner: string,
    scoreboard: ScoreboardEntryDTO[],
    matchHistory: MatchRecordDTO[],
  ) => void
  dismissRoundSummary: () => void
  /** One of the three things arrived. Replaces what that seat was saying. */
  applyEmote: (seat: number, emote: Emote) => void
  applyRematchOffers: (offers: number[], needed: number) => void
  clearRematchOffers: () => void
  applyRematch: (myIndex: number, players: PlayerDTO[], format: MatchFormat, maxPlayers: number) => void
}

/** The 1v1 queue: the wait, the reveal, and an opponent who stopped being there. */
export interface QueueActions {
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
  /** A solo game was dealt: the identity its `game_started` carried. */
  applySoloStarted: (roomCode: string, mySeat: number, sessionToken: string) => void
  applyOpponentAway: (seat: number, deadline: number) => void
  clearOpponentAway: (seat: number) => void
}

export type GameStore = GameState &
  SessionActions &
  TableActions &
  LocoActions &
  MatchActions &
  QueueActions
