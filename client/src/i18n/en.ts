export interface RulesSection {
  heading: string
  items: readonly string[]
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

  // ─── PixiGame in-canvas strings ───────────────────────────────
  yourTurn: string
  drawOrCounter: string  // contains %n placeholder for draw count
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

  // ─── Language ────────────────────────────────────────────────
  language: string

  // ─── Rules ───────────────────────────────────────────────────
  rulesTitle: string
  rulesClose: string
  rules: readonly RulesSection[]
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
  unoBtn: 'UNO!',
  unoBanner: 'UNO!',
  catchBtn: 'Catch!',
  chooseColor: 'Choose a color',
  choosePlayer: 'Choose a player to swap hands with',
  catchWindow: 'Catch window!',
  swapNotice: '%actor swapped hands with %target',
  swapNoticeYouTarget: '%actor swapped hands with you',
  swapNoticeYouActor: 'You swapped hands with %target',
  globalSwitchNoticeCw: '%actor triggered Global Switch — hands passed →',
  globalSwitchNoticeCcw: '%actor triggered Global Switch — hands passed ←',
  reconnected: 'Reconnected',
  rebuildingTable: 'Rebuilding table…',
  wsLostConnection: 'Connection lost',
  wsReconnecting: 'Reconnecting…',
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

  // ─── PixiGame in-canvas strings ───────────────────────────────
  yourTurn: 'Your turn',
  drawOrCounter: 'Draw %n or counter!',
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
        'Global Swap (↻) — wild card; every player passes their hand to the next player in the current direction.',
      ],
    },
    {
      heading: 'Lead-Taking (Identical-Card Interrupt)',
      items: [
        'Once any card is played, any other player has a short window (~1.5 s) to immediately play an identical card (same color, kind, AND value) — even when it is not their turn.',
        'The fastest server-received play wins: the interrupter takes the lead and play continues from their seat.',
        'If you hold multiple identical copies, you may play them all in one tap — effects stack just like a turn-time batch play.',
        'Wild cards and Global Swap cannot be used to interrupt. The player who just played cannot interrupt themselves.',
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
      heading: 'UNO! Declaration & Catch',
      items: [
        'When you play down to exactly 1 card you must press UNO!',
        'If you forget, any other player has 5 seconds to press Catch! — penalty: you draw 2 cards.',
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
}
