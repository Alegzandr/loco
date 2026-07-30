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
  nicknameLength: string
  roomNotFound: string
  roomFull: string
  gameInProgress: string
  sessionInvalid: string
  notInRoom: string

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
  notEnoughPlayers: string
  lobbyOnly: string
  maxPlayersInvalid: string
  rematchTooEarly: string

  // Transport
  rateLimited: string
  serverBusy: string
  deckExhausted: string
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

  // ─── Waiting Room ─────────────────────────────────────────────
  waitingRoom: string
  roomCode: string
  shareCode: string
  copyCode: string
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
  catchWindow: string
  // A Contre-LOCO! that arrived after the target's own call: it costs the
  // caller one card, so the table is told whose it was.
  catchFailedYou: string
  catchFailedOther: string            // contains %player
  // Banners surfaced after Swap / GlobalSwitch resolves so players see why hands changed.
  swapNotice: string                // contains %actor and %target placeholders
  swapNoticeYouTarget: string       // shown when %target would be the local player
  swapNoticeYouActor: string        // shown when %actor would be the local player
  globalSwitchNoticeCw: string      // contains %actor — clockwise rotation
  globalSwitchNoticeCcw: string     // contains %actor — counter-clockwise rotation
  reconnected: string
  rebuildingTable: string
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
  rematch: string             // host button: reopen the room for another match
  rematchWaiting: string      // shown to non-hosts while they wait for the host
  leaveRoom: string           // secondary button: abandon the room entirely

  // ─── Language ────────────────────────────────────────────────
  language: string

  // ─── Rules ───────────────────────────────────────────────────
  rulesTitle: string
  rulesClose: string
  rules: readonly RulesSection[]

  // ─── Refused actions ─────────────────────────────────────────
  errors: ErrorCopy
}

export const en: Translations = {
  // ─── Lobby ───────────────────────────────────────────────────
  tagline: 'Real-time multiplayer card game',
  createRoom: 'Create Room',
  joinRoom: 'Join Room',
  createGame: 'Create Game',
  joinGame: 'Join Game',
  yourNickname: 'Your nickname',
  roomCodeLabel: 'Room code',
  back: 'Back',
  rulesBtn: 'Rules',

  // ─── Waiting Room ─────────────────────────────────────────────
  waitingRoom: 'Waiting Room',
  roomCode: 'Room Code',
  shareCode: 'Share this code with friends!',
  copyCode: 'Copied!',
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
  interruptBy: '%actor stole the lead',
  interruptByYou: 'You stole the lead',
  interruptCombo: '×%n',
  fxSkip: 'SKIP!',
  fxReverse: 'REVERSE!',
  fxColors: { red: 'RED!', yellow: 'YELLOW!', green: 'GREEN!', blue: 'BLUE!' },
  directionCw: 'Play order: clockwise',
  directionCcw: 'Play order: counter-clockwise',
  drawPile: 'Draw pile',
  hostBadge: 'Host',
  matchFormat: 'Match Format',
  maxPlayersLabel: 'Max Players',
  addBot: '+ Add Bot',
  startGame: 'Start Game',
  waitingForPlayers: 'Waiting for players…',
  waitingForHost: 'Waiting for host to start…',

  // ─── Format labels ────────────────────────────────────────────
  bestOf1: 'Best of 1',
  bestOf3: 'Best of 3',
  bestOf5: 'Best of 5',
  bestOf7: 'Best of 7',

  // ─── Game View ────────────────────────────────────────────────
  draw: 'Draw',
  pass: 'Pass',
  unoBtn: 'LOCO!',
  unoBanner: 'LOCO!',
  catchBtn: 'Catch!',
  chooseColor: 'Choose a color',
  choosePlayer: 'Choose a player to swap hands with',
  catchWindow: 'Catch window!',
  catchFailedYou: 'Too late! +1 card',
  catchFailedOther: '%player called too late — +1 card',
  swapNotice: '%actor swapped hands with %target',
  swapNoticeYouTarget: '%actor swapped hands with you',
  swapNoticeYouActor: 'You swapped hands with %target',
  globalSwitchNoticeCw: '%actor triggered Global Switch — hands passed →',
  globalSwitchNoticeCcw: '%actor triggered Global Switch — hands passed ←',
  reconnected: 'Reconnected',
  rebuildingTable: 'Rebuilding table…',
  wsLostConnection: 'Connection lost',
  wsReconnecting: 'Reconnecting…',
  mapLoadingTitle: 'Tonight you play in',
  mapLoadingWaiting: 'Waiting for the table…',
  mapLoadingReady: 'You are in. Waiting for the others…',
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
  complete: 'Complete',
  winsRound: 'wins the round!',
  player: 'Player',
  placementLabel: 'Place',
  ptsLabel: '+pts',
  totalLabel: 'Total',
  winsLabel: 'Wins',
  matchScoreboard: 'Match Scoreboard',
  continueBtn: 'Continue',
  spectating: 'You finished! Watching the round…',

  // ─── In-game score table (hold TAB) ───────────────────────────
  scoreTableTitle: 'Scores',
  scoreTableHint: 'Hold TAB',
  scoreTableBtn: 'Scores',
  scoreTableRoundCol: 'R%n',
  scoreTablePingCol: 'Ping',
  scoreTableYou: 'you',
  scoreTableBot: 'BOT',
  scoreTableNoPing: '--',
  scoreTableEmptyRounds: 'First round in progress',

  // ─── PixiGame in-canvas strings ───────────────────────────────
  yourTurn: 'Your turn',
  drawOrCounter: 'Draw %n or counter!',
  drawPenalty: 'Draw %n',
  playerTurnSuffix: "'s turn",
  ord1: '1st',
  ord2: '2nd',
  ord3: '3rd',
  ordN: 'th',

  // ─── Game Over ────────────────────────────────────────────────
  matchWon: 'Match Won!',
  gameOver: 'Game Over',
  youWin: 'You Win!',
  playAgain: 'Play Again',
  finalScores: 'Final Scores',
  winsGame: 'wins!',
  winsMatch: 'wins the match!',
  rematch: 'Rematch',
  rematchWaiting: 'Waiting for the host to start a rematch…',
  leaveRoom: 'Leave room',

  // ─── Language ────────────────────────────────────────────────
  language: 'Language',

  // ─── Rules ───────────────────────────────────────────────────
  rulesTitle: 'Game Rules',
  rulesClose: 'Close',

  rules: [
    {
      heading: 'Players & Setup',
      items: [
        '2 to 10 players per game (recommended 2–6).',
        'Each player is dealt 8 cards at the start of each round.',
        'The first card flipped to start the discard pile is always a Number card.',
        'Round 1 starter is chosen at random; later rounds start with the player who has the lowest score so far.',
      ],
    },
    {
      heading: 'On Your Turn',
      items: [
        'Play a card matching the top card by color or value, play a Wild, or draw a card.',
        'If you draw, you may play that card immediately if it is legal; otherwise press Pass to end your turn.',
      ],
    },
    {
      heading: 'Playing Multiple Identical Cards',
      items: [
        'You may play several cards of the exact same color and value at once.',
        'Stacked effects compound — three +2s force the next player to draw 6, two Skips skip two players, and so on.',
      ],
    },
    {
      heading: 'Special Cards',
      items: [
        'Skip — the next player loses their turn.',
        'Reverse — flips play direction (acts as Skip with 2 players).',
        'Draw Two (+2) — next player draws 2 and loses their turn unless they stack.',
        'Wild — choose the next active color.',
        'Wild Draw Four (+4) — choose the color; next player draws 4 unless they stack.',
        'Swap (⇋) — colored card; on your turn, pick an opponent and exchange entire hands. No stacking.',
        'Global Swap (↻) — wild card; choose the active colour, then every player passes their hand to the next player in the current direction.',
      ],
    },
    {
      heading: 'Lead-Taking (Identical-Card Interrupt)',
      items: [
        'While a card sits on the pile, anyone holding an identical card (same color, kind, AND value) may slam it down and take the lead — even when it is not their turn.',
        'No deadline: the window stays open until somebody plays, draws or passes. That includes the player who just played and the player whose turn it is.',
        'The fastest server-received play wins: the interrupter takes the lead and play continues from their seat.',
        'If you hold multiple identical copies, you may play them all in one tap — effects stack just like a turn-time batch play.',
        'Every card can interrupt, wilds and Global Swap included: a Wild lands on a Wild, a +4 extends a +4 chain. The only rule is being identical to the top of the pile.',
      ],
    },
    {
      heading: 'Priority',
      items: [
        'When several reactions overlap, the first interrupt received by the server wins.',
        'Server timing is final.',
      ],
    },
    {
      heading: 'LOCO! Declaration & Catch',
      items: [
        'When you play down to exactly 1 card you must press LOCO!',
        'Being handed your last card counts too: after a Swap or a Global Swap, everyone left on one card must press LOCO!',
        'If you forget, any other player has 5 seconds to press Catch! — penalty: you draw 2 cards.',
        'Catch! is a wager: it only counts inside those 5 seconds, and a call that arrives after the LOCO! costs the caller 1 card.',
      ],
    },
    {
      heading: 'Turn Timer & AFK',
      items: [
        'Every turn is time-limited; if the timer expires the server auto-draws and passes for you.',
        'AFK across roughly 2 rounds (4 consecutive auto-acted turns) gets you removed from the game.',
      ],
    },
    {
      heading: 'Round End & Scoring',
      items: [
        'A round ends the moment one player empties their hand. That player wins the round.',
        'Round winner scores the sum of all opponents’ remaining card values; everyone else scores 0.',
        'Number cards = face value (1–9). Reverse = 10 pts. Skip = 20 pts. +2 / Swap = 30 pts. Wild / Global Swap = 40 pts. +4 = 50 pts.',
      ],
    },
    {
      heading: 'Match Formats & Tiebreakers',
      items: [
        'BO1 / BO3 / BO5 / BO7 — match length is the configured number of rounds.',
        'Match winner is the highest cumulative score after all rounds.',
        'Tiebreakers: most rounds won → lowest losing-hand total → sudden-death extra round.',
      ],
    },
  ],

  // ─── Refused actions ─────────────────────────────────────────
  errors: {
    generic: "That didn't work. Try again.",

    nicknameTaken: 'That nickname is taken in this room.',
    nicknameLength: 'Pick a nickname of 1 to 20 characters.',
    roomNotFound: 'No room with that code.',
    roomFull: 'That room is full.',
    gameInProgress: 'That game has already started.',
    sessionInvalid: 'Could not restore your seat. Rejoin the room.',
    notInRoom: 'You are not in a room any more.',

    notYourTurn: 'Not your turn yet.',
    mustAnswerPenalty: 'Counter it, or take the cards.',
    alreadyDrew: 'One draw per turn.',
    mustDrawFirst: 'Draw a card before passing.',
    needColor: 'Pick a color first.',
    cardNotInHand: 'You do not hold that card.',
    illegalCard: 'That card does not match.',

    counterMismatch: 'Only the exact same card stacks.',
    noPendingDraw: 'Nothing to counter right now.',

    interruptClosed: 'Too late.',
    interruptDrawChain: 'Only a matching draw card can cut in here.',
    interruptMismatch: 'It has to be identical to the top card.',
    batchNotAllowed: 'Swap and Global Swap cannot be played in a batch.',
    batchMismatch: 'Batched cards must be identical.',

    declareTooEarly: 'Call LOCO with exactly one card left.',
    alreadyDeclared: 'Already called.',
    catchExpired: 'Too late to catch.',
    catchTargetSafe: 'Nothing to catch there.',

    swapSelf: 'Pick another player.',
    swapTargetInvalid: 'That player cannot be your target.',

    hostOnly: 'Only the host can do that.',
    notEnoughPlayers: 'Not enough players to start.',
    lobbyOnly: 'That can only be changed before the game starts.',
    maxPlayersInvalid: 'That player limit is not allowed.',
    rematchTooEarly: 'The match is not over yet.',

    rateLimited: 'Slow down a moment.',
    serverBusy: 'Server is busy. Try again.',
    deckExhausted: 'No cards left to draw.',
  },
}
