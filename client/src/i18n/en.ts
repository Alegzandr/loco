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
  catchWindow: string
  reconnected: string
  rebuildingTable: string
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

  // ─── Game Over ────────────────────────────────────────────────
  matchWon: string
  gameOver: string
  youWin: string
  playAgain: string
  finalScores: string

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
  catchWindow: 'Catch window!',
  reconnected: 'Reconnected',
  rebuildingTable: 'Rebuilding table…',
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

  // ─── Game Over ────────────────────────────────────────────────
  matchWon: 'Match Won!',
  gameOver: 'Game Over',
  youWin: 'You Win!',
  playAgain: 'Play Again',
  finalScores: 'Final Scores',

  // ─── Language ────────────────────────────────────────────────
  language: 'Language',

  // ─── Rules ───────────────────────────────────────────────────
  rulesTitle: 'Game Rules',
  rulesClose: 'Close',

  rules: [
    {
      heading: 'Players & Setup',
      items: [
        '2 to 10 players per game.',
        'Each player is dealt 8 cards at the start of each round.',
        'The remaining deck is placed face-down; the top card flips to start the discard pile.',
        'A randomly selected player goes first.',
      ],
    },
    {
      heading: 'On Your Turn',
      items: [
        'Play one or more cards from your hand (see special rules below).',
        'If you cannot or choose not to play, draw a card from the deck.',
        'After drawing, you may play the drawn card immediately (draw-and-play).',
        'If you still cannot play after drawing, press Pass to end your turn.',
      ],
    },
    {
      heading: 'Playing Multiple Identical Cards',
      items: [
        'You may play several cards of the same number and color at once as a single turn.',
        'All played cards count individually — e.g., playing two Draw Two cards stacks the effect.',
      ],
    },
    {
      heading: 'Special Cards',
      items: [
        'Skip — the next player loses their turn.',
        'Reverse — play direction is reversed.',
        'Draw Two (+2) — the next player must draw 2 cards (and loses their turn unless they counter).',
        'Wild — play on any color; you choose the next active color.',
        'Wild Draw Four (+4) — play on any color; next player draws 4 (and loses their turn unless they counter).',
        'Swap — swap your hand with any other player of your choice.',
        'Global Switch — all players pass their entire hand to the next player in turn order.',
      ],
    },
    {
      heading: '+2 / +4 Stacking',
      items: [
        'When stacking is enabled (host option), a player targeted by a +2 or +4 may respond with their own +2 or +4.',
        'The stack accumulates until a player cannot or chooses not to counter; that player draws the total.',
        'A +2 can only be countered by another +2; a +4 can only be countered by another +4.',
        'When stacking is disabled, the targeted player must draw immediately.',
      ],
    },
    {
      heading: 'UNO! Declaration',
      items: [
        'When you play your second-to-last card (leaving exactly 1 card), you must press UNO! to declare.',
        'If you fail to declare and another player presses Catch! before the 5-second window closes, you draw 2 penalty cards.',
        'Declaring UNO has no effect if you have more than 1 card.',
      ],
    },
    {
      heading: 'Counter-UNO (Catch!)',
      items: [
        'After a UNO declaration, any player can press Catch! within 5 seconds to challenge it.',
        'If the declaration was valid (player has 1 card), the challenger draws 2 cards instead.',
        'If the declaration was invalid (player has more than 1 card), the declaring player draws 2 cards.',
      ],
    },
    {
      heading: 'Turn Timer & AFK',
      items: [
        'Each player has a limited time per turn (shown as a timer).',
        'If the timer expires, a card is drawn automatically.',
        'A player who is AFK for 2 consecutive rounds is kicked from the room.',
      ],
    },
    {
      heading: 'Finishing a Round',
      items: [
        'When you play all your cards you finish — you are awarded points and become a spectator.',
        'Points earned = sum of the card values held by players who have not yet finished at that moment.',
        'Play continues until only one player remains with cards; that player scores 0.',
        'Number cards = face value (0–9). Skip / Reverse / Draw Two = 20 pts. Wild / Wild Draw Four = 50 pts.',
      ],
    },
    {
      heading: 'Match Formats & Scoring',
      items: [
        'BO1 — single round; highest score wins.',
        'BO3 — first to win 2 rounds wins the match.',
        'BO5 — first to win 3 rounds wins the match.',
        'BO7 — first to win 4 rounds wins the match.',
        'Tiebreakers (if needed): highest cumulative score → most rounds won → lowest losing-hand total → sudden-death extra round.',
      ],
    },
  ],
}
