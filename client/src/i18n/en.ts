import type { CardKind } from '../types/protocol'

export interface RulesSection {
  heading: string
  items: readonly string[]
}

/**
 * Player-facing copy for a refused action.
 *
 * The server's own error strings are developer prose, in English, and used to
 * reach the screen verbatim. `resolveServerError` (i18n/serverErrors.ts) maps
 * them onto these; anything it does not recognise resolves to `generic`, so a
 * raw wire string is never rendered.
 *
 * Voice: say what the player should do next, in as few words as fit on one
 * pill. A refusal in a reaction game is read in under a second or not at all.
 */
export interface ErrorCopy {
  generic: string

  // Joining
  nicknameTaken: string
  /** Every nickname refusal, whatever rule fired. One string on purpose:
   *  see server/game/nickname.go. */
  nicknameRejected: string
  roomNotFound: string
  roomFull: string
  gameInProgress: string
  sessionInvalid: string
  notInRoom: string
  alreadyInRoom: string

  // Turn legality
  notYourTurn: string
  mustAnswerPenalty: string
  alreadyDrew: string
  mustDrawFirst: string
  needColor: string
  cardNotInHand: string
  illegalCard: string

  // Draw stack
  counterMismatch: string
  noPendingDraw: string

  // Interrupts & batches
  interruptClosed: string
  interruptDrawChain: string
  interruptMismatch: string
  batchNotAllowed: string
  batchMismatch: string

  // LOCO declaration & catch
  declareTooEarly: string
  alreadyDeclared: string
  catchExpired: string
  catchTargetSafe: string

  // Swap
  swapSelf: string
  swapTargetInvalid: string

  // Lobby & host
  hostOnly: string
  // Not a refusal: what the removed player is told. It reaches the same slot
  // every refusal does, because a seat vanishing needs a reason more than a
  // wrong tap does.
  kicked: string
  notEnoughPlayers: string
  lobbyOnly: string
  maxPlayersInvalid: string
  rematchTooEarly: string
  // Matchmaking refusals.
  alreadySearching: string
  matchmadeUnavailable: string
  cannotLeaveMatch: string
  // A rematch asked for after the other side has already gone.
  opponentGone: string
  // Sent by the server the instant before it gives a match away, so it is read
  // on the game-over screen rather than as a toast over a live board.
  afkForfeit: string
  afkKicked: string

  // Transport
  rateLimited: string
  serverBusy: string
  // A deploy is under way: new tables are refused for a minute or two while
  // the matches already running finish. Never "no table with that code": the
  // code the player typed was real.
  serverUpdating: string
  // Client-side: a seat reclaim that timed out or was cancelled. The only
  // entry here with no server string behind it.
  reconnectFailed: string
  // The server is at its table or connection ceiling. Not a fault the player
  // can act on beyond waiting, so the copy says how long rather than why.
  serverFull: string
  // Too many wrong table codes from one network in a minute. A player who
  // mistypes once never sees this; a script sweeping for open tables does.
  tooManyAttempts: string
  // A handler panicked and the event loop caught it. The player did nothing
  // wrong and there is nothing for them to fix, so it says so plainly.
  serverError: string
  // A gameplay message arrived at a table that has not dealt (or has finished).
  // Ordinary when a reconnect and a round end cross on the wire.
  gameNotInProgress: string
}

export interface Translations {
  // ─── Lobby ───────────────────────────────────────────────────
  tagline: string
  createRoom: string
  joinRoom: string
  createGame: string
  joinGame: string
  yourNickname: string
  roomCodeLabel: string
  back: string
  rulesBtn: string

  // ─── Preferences ──────────────────────────────────────────────
  // The gear in the top bar. Language used to sit there bare; streamer mode is
  // the second preference, and two of them belong in a panel.
  prefsBtn: string
  prefsTitle: string
  /** The ✕ on the phone's sheet, where the gear that opened it is not on screen. */
  prefsClose: string
  prefsLanguage: string
  prefsTheme: string
  prefsThemeLight: string
  prefsThemeDark: string
  prefsStreamer: string
  prefsColorAssist: string
  prefsColorAssistHint: string
  prefsMotion: string
  prefsMotionHint: string
  prefsStreamerHint: string
  prefsCodeHidden: string

  // ─── 1v1 matchmaking ──────────────────────────────────────────
  // The mode never names itself "unranked": there is one queue today, and the
  // day a ranked ladder exists it will introduce itself. Nothing here says how
  // many people are searching, because nothing on the wire does.
  findMatch: string             // home screen: the headline entry point
  findMatchHint: string         // its second line, inside the button
  findMatchGo: string           // submit on the nickname form
  searchTitle: string
  // Three stages of the same wait, chosen from elapsed time alone. None of them
  // may imply the queue is empty: "nobody is searching" reads as "close the
  // tab", and every player who leaves on that sentence is the opponent the next
  // one was about to get.
  searchFresh: string
  searchPatient: string
  searchLong: string
  searchElapsed: string
  searchCancel: string
  searchCreateTable: string     // offered only once the wait is long
  matchFoundKicker: string
  // Shown in the browser tab, alternating with the page title, and only while
  // the player is on another tab. See hooks/useTabAlert.ts.
  matchFoundTab: string
  matchFoundYou: string
  matchFoundStartingIn: string  // contains %n (seconds)
  matchFoundDealing: string
  // An opponent who dropped mid-match, on the board's banner. No pronoun: a
  // nickname says nothing about who is behind it.
  opponentAway: string
  opponentAwayHint: string
  // A deploy is under way and this table is one of the ones the server is
  // waiting on. It promises the one thing that matters, that the match is not
  // going to be taken away, and asks for nothing.
  serverUpdatingBanner: string
  // A match that ended because somebody stopped being there. Never phrased as a
  // victory: nobody played for it.
  forfeitWon: string
  forfeitWonSub: string
  forfeitYouLeft: string
  forfeitYouLeftSub: string
  findAnotherOpponent: string
  // A rematch is an agreement, not a decision, so the button has three states:
  // ask, wait, accept. `rematchWaitingOpponent` is the 1v1 wording; past two
  // seats the wait is on the table rather than on one named opponent, and the
  // count of who has answered rides `rematchProgress`.
  rematchWaitingOpponent: string
  rematchWaitingTable: string
  rematchAccept: string
  // "{done}/{total}", appended to the button past two seats.
  rematchProgress: (done: number, total: number) => string

  // ─── Waiting Room ─────────────────────────────────────────────
  waitingRoom: string
  roomCode: string
  shareCode: string
  // Pressing the code copies a link to this table, not the six characters: the
  // person receiving it has nothing to retype and nowhere to be sent first.
  copyCode: string
  copyLink: string
  // Leaving is one-way, so the button asks first. The question names the table,
  // and the safe answer is a word, not a dismissal.
  leaveConfirm: string
  leaveConfirmYes: string
  leaveConfirmStay: string
  // ─── Audio ────────────────────────────────────────────────────────
  audioTitle: string
  audioMaster: string
  audioSfx: string
  audioMusic: string
  audioTrack: string
  audioNextTrack: string
  audioMute: string
  audioUnmute: string

  // ─── Interrupt ────────────────────────────────────────────────────
  interruptTitle: string
  interruptBy: string
  interruptByYou: string
  interruptCombo: string
  fxSkip: string
  fxReverse: string
  /** Colour names, announced over the pile when a wild names a new colour. */
  fxColors: Record<'red' | 'yellow' | 'green' | 'blue', string>
  directionCw: string
  directionCcw: string
  drawPile: string
  hostBadge: string
  // The host's control over one row of the roster. Label of an icon button, so
  // it is read out with the nickname beside it.
  kickPlayer: string
  matchFormat: string
  maxPlayersLabel: string
  addBot: string
  startGame: string
  waitingForPlayers: string
  waitingForHost: string

  // ─── Format labels ────────────────────────────────────────────
  bestOf1: string
  bestOf3: string
  bestOf5: string
  bestOf7: string

  // ─── Game View ────────────────────────────────────────────────
  draw: string
  pass: string
  unoBtn: string
  unoBanner: string
  catchBtn: string
  chooseColor: string
  choosePlayer: string
  pickerCancel: string          // the ✕ on both pickers: puts the card back in the hand
  // Hand size of a swap target. Two entries because one card is the size that
  // matters most here and "1 cards" is wrong in both languages.
  swapTargetCards: string             // contains %n
  swapTargetCardOne: string
  catchWindow: string
  // A Contre-LOCO! that arrived after the target's own call: it costs the
  // caller one card, so the table is told whose it was.
  catchFailedYou: string
  catchFailedOther: string            // contains %player
  // A Contre-LOCO! that landed. The wire names the caught seat only, never the
  // caller, so the banner is about the seat that pays.
  catchBannerTitle: string
  catchBannerYou: string              // we are the one who got caught
  catchBannerOther: string            // contains %player
  catchBannerPenalty: string          // contains %n
  // Banners surfaced after Swap / GlobalSwitch resolves so players see why hands changed.
  swapNotice: string                // contains %actor and %target placeholders
  swapNoticeYouTarget: string       // shown when %target would be the local player
  swapNoticeYouActor: string        // shown when %actor would be the local player
  globalSwitchNoticeCw: string      // contains %actor — clockwise rotation
  globalSwitchNoticeCcw: string     // contains %actor — counter-clockwise rotation
  reconnected: string
  rebuildingTable: string
  // Session restore: shown while a reloaded tab reclaims its seat.
  reconnectingGame: string          // coming back to a match in progress
  reconnectingRoom: string          // coming back to a waiting room
  reconnectingHint: string          // in-match: the seat is held, and for how long
  reconnectingHintRoom: string      // pre-match: there is no clock on this one
  reconnectCancel: string           // give up and go back to the lobby
  wsLostConnection: string
  wsReconnecting: string
  // Synchronised map loading, shown between "hands dealt" and "clock running".
  mapLoadingTitle: string           // small label above the map's name
  mapLoadingWaiting: string         // status while other players are still loading
  mapLoadingReady: string           // status once we are in and only others remain
  mapLoadingCount: string           // contains %ready and %total
  /** One entry per map id in components/cards/maps.ts: display name + one line. */
  maps: Record<'neon' | 'rune' | 'velvet' | 'orbit', { name: string; tagline: string }>
  round: string
  of: string
  complete: string
  winsRound: string
  player: string
  placementLabel: string
  ptsLabel: string
  totalLabel: string
  winsLabel: string
  matchScoreboard: string
  continueBtn: string
  spectating: string

  // ─── In-game score table (hold TAB) ───────────────────────────
  scoreTableTitle: string
  scoreTableHint: string       // "Hold TAB"
  scoreTableBtn: string        // accessible name + tooltip of the touch-only icon button
  scoreTableClose: string      // the ✕, shown only while the table is pinned
  scoreTableRoundCol: string   // per-round column header, %n = round number
  scoreTablePingCol: string
  scoreTableYou: string        // marker next to your own row
  scoreTableBot: string        // shown in the ping column for bot seats
  scoreTableNoPing: string     // ping not measured yet
  scoreTableEmptyRounds: string // no round has finished yet

  // ─── PixiGame in-canvas strings ───────────────────────────────
  yourTurn: string
  drawOrCounter: string  // contains %n placeholder for draw count
  drawPenalty: string    // same, for a hand that holds no counter
  playerTurnSuffix: string  // appended after nickname: "Alice's turn"
  // Ordinal suffixes for placement display ("1st", "2nd", "3rd", "4th"+)
  ord1: string
  ord2: string
  ord3: string
  ordN: string  // appended after number for 4+: "4th", "5th", …

  // ─── Game Over ────────────────────────────────────────────────
  matchWon: string
  gameOver: string
  youWin: string
  playAgain: string
  finalScores: string
  winsGame: string      // "{nickname} wins!"
  winsMatch: string     // "{nickname} wins the match!"
  rematch: string             // ask for another match; every seat has to
  leaveRoom: string           // secondary button: abandon the room entirely

  // ─── Language ────────────────────────────────────────────────
  language: string

  // ─── Rules ───────────────────────────────────────────────────
  rulesTitle: string
  rulesClose: string
  rules: readonly RulesSection[]
  /**
   * A readable name per card kind. `cardLabel()` only ever returns the glyph
   * (⊘ ⇄ +2 W +4 ⇋ ↻), and the names existed nowhere else but buried inside the
   * sentences of `rules`, so nothing could name a card in a table or a heading.
   */
  cardNames: Record<CardKind, string>

  // Privacy, terms and credits are not here: they are pages, and their copy
  // lives in `src/content/legal.ts`, which no bundle carries. See
  // `docs/notes/legal.md`.

  // ─── Refused actions ─────────────────────────────────────────
  errors: ErrorCopy
}

/**
 * English copy, and the source of truth every other language is typed against.
 *
 * The voice, in one line: this is a game talking to somebody sitting at a table
 * with their friends, not a website talking to a user. Players open a **table**,
 * share a table code and take a seat. A button is the verb about to happen. A
 * refusal says what to do next and never scolds. Only the streamable moments
 * shout, so that INTERCEPTED! and CAUGHT! keep their weight.
 *
 * `docs/notes/client.md` ("The voice") carries the rest, including what the
 * rules modal is allowed to sound like.
 */
export const en: Translations = {
  // ─── Lobby ───────────────────────────────────────────────────
  tagline: 'Cards at speed. Nobody waits their turn.',
  createRoom: 'New table',
  joinRoom: 'Join a table',
  createGame: 'Open the table',
  joinGame: 'Take a seat',
  yourNickname: 'Your name',
  roomCodeLabel: 'Table code',
  back: 'Back',
  // The button is a question-mark chip in a row of icons, in-game as well as in
  // the lobby, so this string is never drawn: it is the aria-label and the
  // tooltip. The modal it opens is the one that gets to be a sentence.
  rulesBtn: 'Rules',

  // ─── Preferences ──────────────────────────────────────────────
  prefsBtn: 'Preferences',
  prefsTitle: 'Preferences',
  prefsClose: 'Close',
  prefsLanguage: 'Language',
  prefsTheme: 'Theme',
  prefsThemeLight: 'Light',
  prefsThemeDark: 'Dark',
  prefsStreamer: 'Streamer mode',
  prefsColorAssist: 'Colour shapes',
  // Named after what appears, not after a condition: nobody should have to
  // self-diagnose to find the setting that makes the game playable.
  prefsColorAssistHint: 'Marks every suit with its own shape, so colour is never the only thing telling two cards apart.',
  prefsMotion: 'Reduced motion',
  // Names the two things a player would miss, so the switch is not a leap of
  // faith. Follows the system setting until it is touched.
  prefsMotionHint: 'Stops card flights and confetti. Follows your system until you set it here.',
  // Says what it does to the code, not what the mode is called: a player who
  // has to guess the effect will leave it off.
  prefsStreamerHint: 'Blurs the table code on screen. Hover it to read it yourself.',
  prefsCodeHidden: 'Hidden. Hover to read it.',

  // ─── 1v1 matchmaking ──────────────────────────────────────────
  findMatch: 'Play 1v1',
  findMatchHint: 'We find you someone',
  findMatchGo: 'Find an opponent',
  searchTitle: 'Looking for an opponent',
  searchFresh: 'Sit tight. This usually takes seconds.',
  searchPatient: 'Still looking. Nobody has sat down opposite you yet.',
  searchLong: 'This one is taking a while. Stay here and you get the next player who shows up, or open a table and bring someone yourself.',
  searchElapsed: 'Waiting',
  searchCancel: 'Stop looking',
  searchCreateTable: 'Open a table instead',
  matchFoundKicker: 'Opponent found',
  matchFoundTab: 'Opponent found, come back!',
  matchFoundYou: 'You',
  matchFoundStartingIn: 'Dealing in %n…',
  matchFoundDealing: 'Dealing…',
  opponentAway: 'lost connection',
  opponentAwayHint: 'If they do not come back, the match is yours.',
  serverUpdatingBanner: 'New version landing. This match plays to the end.',
  forfeitWon: 'They walked',
  forfeitWonSub: 'The seat opposite is empty. The match is yours.',
  forfeitYouLeft: 'You left',
  forfeitYouLeftSub: 'The match went to your opponent.',
  findAnotherOpponent: 'Find another opponent',
  rematchWaitingOpponent: 'Waiting on them…',
  rematchWaitingTable: 'Waiting on the table…',
  rematchAccept: 'They want another. Go.',
  rematchProgress: (done, total) => `${done}/${total}`,

  // ─── Waiting Room ─────────────────────────────────────────────
  waitingRoom: 'The table',
  roomCode: 'Table code',
  // The screen already says "The table" and "Table code": a third one in the
  // same column reads as a half-filled template.
  shareCode: 'Tap the code to copy a link straight to this table.',
  copyCode: 'Link copied!',
  copyLink: 'Copy the link to this table',
  leaveConfirm: 'Leave this table?',
  leaveConfirmYes: 'Yes, leave',
  leaveConfirmStay: 'Stay',
  // ─── Audio ────────────────────────────────────────────────────────
  audioTitle: 'Sound',
  audioMaster: 'Overall',
  audioSfx: 'Effects',
  audioMusic: 'Music',
  audioTrack: 'Now playing',
  audioNextTrack: 'Next track',
  audioMute: 'Mute',
  audioUnmute: 'Unmute',

  // ─── Interrupt ────────────────────────────────────────────────────
  interruptTitle: 'INTERCEPTED!',
  interruptBy: '%actor cut in',
  interruptByYou: 'You cut in',
  interruptCombo: '×%n',
  fxSkip: 'SKIP!',
  fxReverse: 'REVERSE!',
  fxColors: { red: 'RED!', yellow: 'YELLOW!', green: 'GREEN!', blue: 'BLUE!' },
  directionCw: 'Play order: clockwise',
  directionCcw: 'Play order: counter-clockwise',
  drawPile: 'Draw pile',
  hostBadge: 'Host',
  kickPlayer: 'Remove from the table',
  matchFormat: 'Match length',
  maxPlayersLabel: 'Seats',
  addBot: '+ Add a bot',
  startGame: 'Deal',
  waitingForPlayers: 'Waiting on players…',
  waitingForHost: 'Waiting on the host to deal…',

  // ─── Format labels ────────────────────────────────────────────
  bestOf1: 'One round',
  bestOf3: 'Best of 3',
  bestOf5: 'Best of 5',
  bestOf7: 'Best of 7',

  // ─── Game View ────────────────────────────────────────────────
  draw: 'Draw',
  pass: 'Pass',
  unoBtn: 'LOCO!',
  unoBanner: 'LOCO!',
  catchBtn: 'Catch!',
  chooseColor: 'Call the color',
  choosePlayer: 'Whose hand do you want?',
  pickerCancel: 'Put it back',
  swapTargetCards: '%n cards',
  swapTargetCardOne: '1 card',
  catchWindow: 'Catch them!',
  catchFailedYou: 'Too late. +1 card',
  catchFailedOther: '%player called too late: +1 card',
  catchBannerTitle: 'CAUGHT!',
  catchBannerYou: 'You never called LOCO!',
  catchBannerOther: '%player never called LOCO!',
  catchBannerPenalty: '+%n cards',
  swapNotice: '%actor took %target’s hand',
  swapNoticeYouTarget: '%actor took your hand',
  swapNoticeYouActor: 'You took %target’s hand',
  globalSwitchNoticeCw: '%actor called Global Switch. Every hand moves →',
  globalSwitchNoticeCcw: '%actor called Global Switch. Every hand moves ←',
  reconnected: 'Back in',
  rebuildingTable: 'Setting the table back up…',
  reconnectingGame: 'Getting your seat back…',
  reconnectingRoom: 'Heading back to the table…',
  reconnectingHint: 'Your hand and your score are held for a minute. Nothing is lost yet.',
  reconnectingHintRoom: 'No cards are out yet. Nothing to lose.',
  reconnectCancel: 'Back to the menu',
  wsLostConnection: 'Connection lost',
  wsReconnecting: 'Reconnecting…',
  mapLoadingTitle: 'Tonight you play in',
  mapLoadingWaiting: 'Setting the table…',
  mapLoadingReady: 'You are seated. Waiting on the others…',
  mapLoadingCount: '%ready of %total ready',
  maps: {
    neon: {
      name: 'Neon',
      tagline: 'A rooftop club above the skyline. Black marble, and a ring of light.',
    },
    rune: {
      name: 'Rune',
      tagline: 'The back room of an arcane tavern. Carved oak, gemstones, candlelight.',
    },
    velvet: {
      name: 'Velvet',
      tagline: 'An art-deco lounge. Brass, burgundy baize, and lamps turned low.',
    },
    orbit: {
      name: 'Orbit',
      tagline: 'A starship hangar in high orbit. Brushed alloy over a holo table.',
    },
  },
  round: 'Round',
  of: 'of',
  complete: 'down',
  winsRound: 'takes the round!',
  player: 'Player',
  // The rank column is 40px wide and its cells already read "1st", "2nd": any
  // word here spills into the player column, in every language. A leaderboard
  // hash says the same thing and cannot overflow.
  placementLabel: '#',
  ptsLabel: '+pts',
  totalLabel: 'Total',
  winsLabel: 'Wins',
  matchScoreboard: 'Where the match stands',
  continueBtn: 'Next round',
  spectating: 'Hand empty. Enjoy the show…',

  // ─── In-game score table (hold TAB) ───────────────────────────
  scoreTableTitle: 'Scores',
  scoreTableHint: 'Hold TAB',
  scoreTableBtn: 'Scores',
  scoreTableClose: 'Close',
  scoreTableRoundCol: 'R%n',
  scoreTablePingCol: 'Ping',
  scoreTableYou: 'you',
  scoreTableBot: 'BOT',
  scoreTableNoPing: '--',
  scoreTableEmptyRounds: 'Nothing settled yet',

  // ─── PixiGame in-canvas strings ───────────────────────────────
  yourTurn: 'Your turn',
  drawOrCounter: 'Draw %n or fight back!',
  drawPenalty: 'Draw %n',
  playerTurnSuffix: "'s turn",
  ord1: '1st',
  ord2: '2nd',
  ord3: '3rd',
  ordN: 'th',

  // ─── Game Over ────────────────────────────────────────────────
  matchWon: 'THE MATCH IS YOURS!',
  gameOver: 'That is the match',
  youWin: 'YOU WIN!',
  playAgain: 'Play again',
  finalScores: 'Final standings',
  winsGame: 'wins!',
  winsMatch: 'takes the match!',
  rematch: 'Rematch',
  leaveRoom: 'Leave the table',

  // ─── Language ────────────────────────────────────────────────
  language: 'Language',

  // ─── Rules ───────────────────────────────────────────────────
  rulesTitle: 'How to play',
  rulesClose: 'Close',

  cardNames: {
    number: 'Number',
    skip: 'Skip',
    reverse: 'Reverse',
    draw_two: '+2',
    wild: 'Wild',
    wild_draw_four: '+4',
    swap: 'Swap',
    global_switch: 'Global Switch',
  },

  rules: [
    {
      heading: 'The table',
      items: [
        '2 to 10 players. It breathes best between 2 and 6.',
        'Eight cards each, dealt fresh every round.',
        'The pile always opens on a number card, so nobody eats a +4 before their first turn.',
        'Round 1 opens on a random seat. After that, whoever is last on points goes first.',
      ],
    },
    {
      heading: 'Your turn',
      items: [
        'Match the top card by color or by value, drop a wild, or take one from the pile.',
        'A card you just drew can go straight back down if it fits. If it does not, pass.',
        'One draw per turn. Not two.',
      ],
    },
    {
      heading: 'Doubles go down together',
      items: [
        'Holding the exact same card twice? Play both. Three, four, all of them, in one tap.',
        'The effects stack: three +2s means the next player draws six, two Skips burn two seats.',
      ],
    },
    {
      heading: 'The cards that hurt',
      items: [
        'Skip: the next player loses their turn.',
        'Reverse: play changes direction. In a duel, it simply skips.',
        '+2: the next player draws two, unless they answer with a +2 of their own. Taking the cards does not cost them the turn: they draw, then play or pass.',
        'Wild: lands on anything. You call the color.',
        '+4: the wild that bites. Call the color, and the next player draws four unless they stack.',
        'Swap (⇋): a colored card, played on your turn. Pick anyone and take their whole hand. Yes, all of it.',
        'Global Switch (↻): call the color, then every hand at the table slides one seat along. Nobody keeps anything.',
      ],
    },
    {
      heading: 'Cut in whenever you like',
      items: [
        'A card is sitting on the pile. Hold one exactly like it, same color and same value? Slam it down, even out of turn.',
        'There is no deadline. The window stays open until somebody plays, draws or passes.',
        'Nobody is shut out: the player who just played can cut straight back in, and so can the player whose turn it was.',
        'Several copies go down in the same tap, effects and all.',
        'Every card can interrupt, wilds and Global Switch included. A Wild lands on a Wild, a +4 extends a +4. Identical is the only rule.',
      ],
    },
    {
      heading: 'Photo finish',
      items: [
        'Two players slam at the same instant? The server decides, and the first one it receives takes the lead.',
        'Its clock is the only clock. No arguing with the table.',
      ],
    },
    {
      heading: 'One card left: say it',
      items: [
        'Down to your last card, hit LOCO! Right away.',
        'Being handed your last card counts too: after a Swap or a Global Switch, everyone sitting on one card owes the call.',
        'Stay quiet and any opponent has five seconds to hit Catch! You draw two.',
        'Catch! is a bet, not a free shot: thrown after the LOCO!, it costs the caller a card.',
      ],
    },
    {
      heading: 'The clock',
      items: [
        'Every turn is timed. Let it run out and the server draws and passes in your place.',
        'Four turns in a row like that, roughly two rounds, and your seat is given up.',
      ],
    },
    {
      heading: 'Points',
      items: [
        'A round ends the second somebody empties their hand.',
        'They pocket the value of every card still stuck in everyone else’s hands. Everyone else scores nothing.',
        'Numbers are worth their face. Reverse 10. Skip 20. +2 and Swap 30. Wild and Global Switch 40. +4 is 50, and you feel it.',
      ],
    },
    {
      heading: 'Taking the match',
      items: [
        'Match length is set before the deal: one round, or best of 3, 5 or 7.',
        'Highest total once the last round lands takes the whole thing.',
        'Level on points? Most rounds won, then the smallest pile of leftovers, then one sudden-death round.',
      ],
    },
  ],

  // ─── Refused actions ─────────────────────────────────────────
  errors: {
    generic: 'That one did not go through.',

    nicknameTaken: 'Someone at this table already goes by that.',
    nicknameRejected: 'Pick another nickname.',
    roomNotFound: 'No table with that code.',
    roomFull: 'That table is full.',
    gameInProgress: 'Cards are already out at that table.',
    sessionInvalid: 'Your seat could not be recovered. Join again.',
    notInRoom: 'You have left the table.',
    alreadyInRoom: 'You are already at a table. Leave it first.',

    notYourTurn: 'Wait your turn.',
    mustAnswerPenalty: 'Fight back, or take the cards.',
    alreadyDrew: 'One draw per turn.',
    mustDrawFirst: 'Draw before you pass.',
    needColor: 'Call a color first.',
    cardNotInHand: 'That card is not in your hand.',
    illegalCard: 'That one does not match.',

    counterMismatch: 'Only the exact same card stacks.',
    noPendingDraw: 'Nothing to fight back against.',

    interruptClosed: 'Someone beat you to it.',
    interruptDrawChain: 'Only a matching draw card cuts in here.',
    interruptMismatch: 'It has to be identical to the top card.',
    batchNotAllowed: 'Swap and Global Switch go down one at a time.',
    batchMismatch: 'Cards played together must be identical.',

    declareTooEarly: 'Call LOCO on your last card, not before.',
    alreadyDeclared: 'Already called.',
    catchExpired: 'The window has closed.',
    catchTargetSafe: 'Nothing to catch there.',

    swapSelf: 'Pick someone else.',
    swapTargetInvalid: 'That seat cannot be your target.',

    hostOnly: 'That one is the host’s call.',
    kicked: 'The host freed your seat.',
    notEnoughPlayers: 'Not enough players to deal.',
    lobbyOnly: 'Too late, the cards are out.',
    maxPlayersInvalid: 'That seat count is not allowed.',
    rematchTooEarly: 'The match is not over yet.',
    alreadySearching: 'You are already looking for a game.',
    matchmadeUnavailable: 'Not a thing in a 1v1.',
    cannotLeaveMatch: 'Cards are out. Play it through.',
    opponentGone: 'They have left the table.',
    afkForfeit: 'You were away too long. The match went to your opponent.',
    afkKicked: 'You were away too long.',

    rateLimited: 'Easy on the taps.',
    serverBusy: 'The server is packed. Try again.',
    serverUpdating: 'New version landing. Tables open again in a minute.',
    reconnectFailed: 'Your seat is gone. The match may be over.',
    serverFull: 'Every table is taken. Try again in a minute.',
    tooManyAttempts: 'Too many tries. Wait a moment.',
    serverError: 'Something broke on our side. Try that again.',
    gameNotInProgress: 'No cards are out at this table.',
  },
}
