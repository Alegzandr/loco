/**
 * Visual showcase scenes — dev-only.
 *
 * Every meaningful screen/state of the game, described as pure data so it can be
 * rendered without a server, a WebSocket, or a second player. The capture script
 * (`tools/visual/shoot.mjs`) walks this registry and screenshots each entry, which
 * is how the whole UI can be reviewed in one pass.
 *
 * Adding a screen or a visual state? Add a scene here in the same change set.
 */
import type { CardDTO, LatencyEntryDTO, PlayerDTO, ScoreboardEntryDTO } from '../types/protocol'
import type { RoundScoreEntry } from '../hooks/gameStore'

// ─── Mock builders ──────────────────────────────────────────────────────────

export const card = (
  color: CardDTO['color'],
  kind: CardDTO['kind'],
  value?: number,
): CardDTO => (value === undefined ? { color, kind } : { color, kind, value })

export const num = (color: CardDTO['color'], value: number) => card(color, 'number', value)

const player = (index: number, nickname: string, hand_size: number, connected = true): PlayerDTO => ({
  index,
  nickname,
  hand_size,
  connected,
})

const PLAYERS_4: PlayerDTO[] = [
  player(0, 'Nova', 7),
  player(1, 'Kiwi', 4),
  player(2, 'Bot1', 9),
  player(3, 'Pixel', 1),
]

const PLAYERS_8: PlayerDTO[] = [
  player(0, 'Nova', 6),
  player(1, 'Kiwi', 3),
  player(2, 'Bot1', 9),
  player(3, 'Pixel', 1),
  player(4, 'Momo', 5),
  player(5, 'Yuzu', 12),
  player(6, 'Bot2', 2),
  player(7, 'Zed', 7, false),
]

const HAND_7: CardDTO[] = [
  num('red', 7),
  card('red', 'skip'),
  num('blue', 3),
  card('green', 'draw_two'),
  num('yellow', 9),
  card('wild', 'wild'),
  card('wild', 'wild_draw_four'),
]

const HAND_FULL: CardDTO[] = [
  num('red', 1), num('red', 5), card('red', 'reverse'),
  num('blue', 2), num('blue', 8), card('blue', 'skip'),
  num('green', 4), card('green', 'swap'),
  num('yellow', 6), card('yellow', 'draw_two'),
  card('wild', 'wild'), card('wild', 'global_switch'),
]

const SCOREBOARD: ScoreboardEntryDTO[] = [
  { player_index: 0, nickname: 'Nova', score: 187, rounds_won: 2 },
  { player_index: 1, nickname: 'Kiwi', score: 142, rounds_won: 1 },
  { player_index: 2, nickname: 'Bot1', score: 96, rounds_won: 0 },
  { player_index: 3, nickname: 'Pixel', score: 55, rounds_won: 0 },
]

// Three finished rounds. Only the finisher scores in LOCO, so exactly one
// column is non-zero per row, and the rows add up to SCOREBOARD_HISTORIC.
const ROUND_HISTORY: number[][] = [
  [113, 0, 0, 0],
  [0, 142, 0, 0],
  [74, 0, 0, 0],
]

const SCOREBOARD_HISTORIC: ScoreboardEntryDTO[] = [
  { player_index: 0, nickname: 'Nova', score: 187, rounds_won: 2 },
  { player_index: 1, nickname: 'Kiwi', score: 142, rounds_won: 1 },
  { player_index: 2, nickname: 'Bot1', score: 0, rounds_won: 0 },
  { player_index: 3, nickname: 'Pixel', score: 0, rounds_won: 0 },
]

// rtt_ms -1 means "nothing measured", which is what a bot seat always reports.
const LATENCIES: LatencyEntryDTO[] = [
  { player_index: 0, rtt_ms: 38 },
  { player_index: 1, rtt_ms: 145 },
  { player_index: 2, rtt_ms: -1, bot: true },
  { player_index: 3, rtt_ms: 312 },
]

const ROUND_SCORES: RoundScoreEntry[] = [
  { player_index: 0, nickname: 'Nova', round_points: 74, cumulative_score: 187, rounds_won: 2 },
  { player_index: 1, nickname: 'Kiwi', round_points: 0, cumulative_score: 142, rounds_won: 1 },
  { player_index: 2, nickname: 'Bot1', round_points: 0, cumulative_score: 96, rounds_won: 0 },
  { player_index: 3, nickname: 'Pixel', round_points: 0, cumulative_score: 55, rounds_won: 0 },
]

// ─── Scene registry ─────────────────────────────────────────────────────────

/** Extra element layered over the base screen (component-local state we can't set from the store). */
export type SceneOverlay =
  | 'color-picker'
  | 'player-picker'
  | 'rules'
  | 'scores'
  // Pinned by the touch button rather than held with TAB: the header swaps the
  // "Hold TAB" hint for a ✕, and that is the only way out a phone has.
  | 'scores-pinned'
  | null

export interface Scene {
  id: string
  /** Human label shown in the gallery index. */
  title: string
  /** Which top-level screen to mount. */
  screen:
    | 'lobby'
    | 'searching'
    | 'matchfound'
    | 'waiting'
    | 'game'
    | 'gameover'
    | 'restoring'
    | 'cards'
    | 'og'
  /**
   * Store patch applied before mounting. `deadlineIn`/`unoIn` are relative so
   * captures stay stable regardless of when they run.
   */
  state?: Record<string, unknown>
  /** Seconds of turn timer left; converted to an absolute deadline at apply time. */
  deadlineIn?: number
  /** Seconds left in the UNO catch window. */
  unoIn?: number
  overlay?: SceneOverlay
  /** Lobby sub-screen: drives Lobby's internal mode. */
  lobbyMode?: 'home' | 'find' | 'create' | 'join'
  /** Lobby: the table code a shared link arrived with, already in the field. */
  lobbyCode?: string
  /** Seconds already spent searching, so the three stages of the copy can each
   *  be captured (see Searching.tsx: 0-15s, 15-45s, 45s+). */
  searchingFor?: number
  /** Simulated transport state for the game screen. */
  wsStatus?: 'connecting' | 'open' | 'closed'
  /** Waiting room: mount straight into the leave confirmation. */
  confirmLeave?: boolean
  /** Preferences: hide the table code, the way a streamer would. */
  streamerMode?: boolean
  /** Lobby: mount with the preferences panel open. */
  prefsOpen?: boolean
  /** Lobby: mount with the language list open inside that panel. */
  langOpen?: boolean
  /** Lobby: mount with the sound panel open. */
  audioOpen?: boolean
  /** Colour assist: every suit also carries its silhouette. */
  colorAssist?: boolean
}

const gameBase = {
  myIndex: 0,
  players: PLAYERS_4,
  myHand: HAND_7,
  discard: num('red', 5),
  activeColor: 'red' as const,
  currentTurn: 0,
  direction: 1,
  pendingDraw: 0,
  hasDrawn: false,
  roundNumber: 2,
  matchFormat: 'BO3' as const,
  maxPlayers: 10,
  scoreboard: SCOREBOARD,
  roomCode: 'KX7QP2',
}

export const SCENES: Scene[] = [
  {
    id: 'card-sheet',
    title: 'Le jeu complet · toutes les cartes',
    screen: 'cards',
  },
  {
    // The whole deck again, the way a colour-blind player sees it. Reviewed on
    // the sheet rather than on the board because what matters is that the four
    // silhouettes stay apart at hand size, on all four faces.
    id: 'card-sheet-assist',
    title: 'Le jeu complet · formes des couleurs',
    screen: 'cards',
    colorAssist: true,
  },
  {
    // Not a screen either: the 1200×630 link preview, captured by
    // `tools/og/shoot.mjs` into client/public/og.png. It lives in the registry
    // so a change to the mark or to a card face is reviewed here too.
    id: 'og-card',
    title: 'Aperçu de lien (Discord / X)',
    screen: 'og',
  },
  {
    id: 'lobby-home',
    title: 'Accueil',
    screen: 'lobby',
    lobbyMode: 'home',
  },
  {
    id: 'lobby-create',
    title: 'Accueil · créer une partie',
    screen: 'lobby',
    lobbyMode: 'create',
  },
  {
    id: 'lobby-join',
    title: 'Accueil · rejoindre une partie',
    screen: 'lobby',
    lobbyMode: 'join',
  },
  {
    // Arriving on a shared link with no name in this browser: the code is in,
    // and the form is down to the one thing a link cannot carry.
    id: 'lobby-join-invite',
    title: 'Accueil · arrivée par lien',
    screen: 'lobby',
    lobbyMode: 'join',
    lobbyCode: 'KX7QP2',
  },
  {
    id: 'lobby-find',
    title: 'Accueil · 1v1',
    screen: 'lobby',
    lobbyMode: 'find',
  },
  {
    id: 'matchmaking-searching',
    title: '1v1 · recherche',
    screen: 'searching',
    searchingFor: 4,
  },
  {
    id: 'matchmaking-searching-patient',
    title: '1v1 · recherche qui dure',
    screen: 'searching',
    searchingFor: 22,
  },
  {
    // The stage that matters most: the queue is empty and the screen has to say
    // so without ever saying so.
    id: 'matchmaking-searching-long',
    title: '1v1 · attente indéterminée',
    screen: 'searching',
    searchingFor: 70,
  },
  {
    id: 'matchmaking-found',
    title: '1v1 · adversaire trouvé',
    screen: 'matchfound',
  },
  {
    id: 'lobby-error',
    title: 'Accueil · erreur',
    screen: 'lobby',
    lobbyMode: 'join',
    state: { errorMsg: 'nickname already taken' },
  },
  {
    id: 'reconnecting-game',
    title: 'Reconnexion · partie en cours',
    screen: 'restoring',
    state: { roomCode: 'KX7QP2', restoreTarget: 'game' },
  },
  {
    id: 'reconnecting-room',
    title: 'Reconnexion · salon',
    screen: 'restoring',
    state: { roomCode: 'KX7QP2', restoreTarget: 'waiting' },
  },
  {
    id: 'lobby-prefs',
    title: 'Accueil · préférences',
    screen: 'lobby',
    lobbyMode: 'home',
    prefsOpen: true,
  },
  {
    // The list open, which is the shot that matters: a `<select>` drew this
    // part itself, in the system's colours, and no screenshot of ours could
    // ever have caught it. Worth a look at `small` too, where the panel is a
    // sheet and the rows are thumb-sized.
    id: 'lobby-prefs-lang',
    title: 'Accueil · préférences · langue',
    screen: 'lobby',
    lobbyMode: 'home',
    prefsOpen: true,
    langOpen: true,
  },
  {
    // The mixer, which below 46rem is a sheet and not the dropdown this shot
    // catches at `wide`: three sliders a thumb has to land on, so it is the
    // `small` viewport this scene exists for.
    id: 'lobby-audio',
    title: 'Accueil · son',
    screen: 'lobby',
    lobbyMode: 'home',
    audioOpen: true,
  },
  {
    id: 'lobby-rules',
    title: 'Règles du jeu',
    screen: 'lobby',
    overlay: 'rules',
  },
  // Confidentialité, conditions et crédits ne sont plus une modale : ce sont des
  // pages Astro (/privacy/, /fr/confidentialite/), donc rien à photographier ici.
  {
    id: 'waiting-host',
    title: 'Salon · hôte',
    screen: 'waiting',
    state: {
      roomCode: 'KX7QP2',
      players: PLAYERS_4,
      myIndex: 0,
      matchFormat: 'BO3',
      maxPlayers: 6,
    },
  },
  {
    id: 'waiting-guest',
    title: 'Salon · invité',
    screen: 'waiting',
    state: {
      roomCode: 'KX7QP2',
      players: PLAYERS_4,
      myIndex: 2,
      matchFormat: 'BO1',
      maxPlayers: 10,
    },
  },
  {
    // The one destructive press on this screen, mid-question.
    id: 'waiting-leave-confirm',
    title: 'Salon · confirmer le départ',
    screen: 'waiting',
    confirmLeave: true,
    state: {
      roomCode: 'KX7QP2',
      players: PLAYERS_4,
      myIndex: 2,
      matchFormat: 'BO1',
      maxPlayers: 10,
    },
  },
  {
    // The screen a streamer actually leaves on camera: everything readable
    // except the six characters that open the table.
    id: 'waiting-streamer',
    title: 'Salon · mode streamer',
    screen: 'waiting',
    streamerMode: true,
    state: {
      roomCode: 'KX7QP2',
      players: PLAYERS_4,
      myIndex: 0,
      matchFormat: 'BO3',
      maxPlayers: 6,
    },
  },
  {
    id: 'waiting-solo',
    title: 'Salon · seul (attente)',
    screen: 'waiting',
    state: {
      roomCode: 'KX7QP2',
      players: [player(0, 'Nova', 0)],
      myIndex: 0,
      matchFormat: 'BO1',
      maxPlayers: 10,
    },
  },
  {
    id: 'game-my-turn',
    title: 'Partie · mon tour',
    screen: 'game',
    state: gameBase,
    deadlineIn: 21,
  },
  {
    id: 'game-opponent-turn',
    title: 'Partie · tour adverse',
    screen: 'game',
    state: { ...gameBase, currentTurn: 2 },
    deadlineIn: 9,
  },
  {
    // The direction ring is the only lasting record of a Reverse: the callout
    // lasts a second, the heading lasts the rest of the round. Both states are
    // captured so the flip is reviewable side by side.
    id: 'game-reversed',
    title: 'Partie · sens inversé',
    screen: 'game',
    state: { ...gameBase, discard: card('yellow', 'reverse'), activeColor: 'yellow', direction: -1 },
    deadlineIn: 21,
  },
  {
    id: 'game-full-hand',
    title: 'Partie · grande main',
    screen: 'game',
    state: { ...gameBase, myHand: HAND_FULL, discard: num('blue', 8), activeColor: 'blue' },
    deadlineIn: 25,
  },
  {
    id: 'game-pending-draw',
    title: 'Partie · +6 empilé',
    screen: 'game',
    state: {
      ...gameBase,
      discard: card('wild', 'wild_draw_four'),
      activeColor: 'green',
      pendingDraw: 6,
    },
    deadlineIn: 5,
  },
  {
    // The state the active-colour cues exist for: the top card is a wild, so
    // its face says nothing, and the pool/ring/chip are the whole answer.
    id: 'game-wild-active-color',
    title: 'Partie · joker, couleur active',
    screen: 'game',
    state: { ...gameBase, discard: card('wild', 'wild'), activeColor: 'yellow' },
    deadlineIn: 21,
  },
  {
    id: 'game-uno',
    title: 'Partie · LOCO annoncé',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 3,
      unoDeclared: true,
      unoDeclaredByIndex: 3,
    },
    deadlineIn: 14,
  },
  {
    // The catchable state: Pixel is down to one card and has NOT called it, so
    // the Catch button and its countdown are live for everyone else.
    id: 'game-catch-window',
    title: 'Partie · fenêtre d’attrapage',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 0,
      catchTarget: 3,
      players: [player(0, 'Nova', 5), player(1, 'Kiwi', 4), player(2, 'Bot1', 9), player(3, 'Pixel', 1)],
    },
    unoIn: 3.4,
    deadlineIn: 14,
  },
  {
    // The overlap: we are on one card AND Pixel is catchable. LOCO keeps the
    // centre column (declaring is ours to lose) and Catch floats beside the bar
    // — the only state where the floating slot is used at all.
    id: 'game-catch-and-loco',
    title: 'Partie · attraper + LOCO',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 0,
      catchTarget: 3,
      myHand: [num('red', 7)],
      players: [player(0, 'Nova', 1), player(1, 'Kiwi', 4), player(2, 'Bot1', 9), player(3, 'Pixel', 1)],
    },
    unoIn: 2.6,
    deadlineIn: 11,
  },
  {
    // The wager lost: our Contre-LOCO! arrived after Pixel's own call and drew
    // us a card for it. The notice is red and sits below the swap pill so the
    // two can share the screen; both are table news, not errors.
    id: 'game-catch-failed',
    title: 'Partie · Contre-LOCO raté',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 0,
      catchFailed: { seat: 0, at: 1 },
      players: [player(0, 'Nova', 6), player(1, 'Kiwi', 4), player(2, 'Bot1', 9), player(3, 'Pixel', 1)],
    },
    deadlineIn: 16,
  },
  {
    // The wager won. The stamp names the seat that owed the call, the chip says
    // what it cost, and the board underneath flies the two cards to that seat.
    // Deliberately red and vertical where the interception slam is actor-tinted
    // and horizontal: review the two side by side in the contact sheet.
    id: 'game-catch-caught',
    title: 'Partie · Contre-LOCO réussi',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 0,
      catchFlash: { seat: 3, at: 1 },
      players: [player(0, 'Nova', 6), player(1, 'Kiwi', 4), player(2, 'Bot1', 9), player(3, 'Pixel', 3)],
    },
    deadlineIn: 16,
  },
  {
    id: 'game-last-card',
    title: 'Partie · il me reste 1 carte',
    screen: 'game',
    state: {
      ...gameBase,
      myHand: [num('red', 7)],
      players: [player(0, 'Nova', 1), player(1, 'Kiwi', 4), player(2, 'Bot1', 9), player(3, 'Pixel', 3)],
    },
    deadlineIn: 18,
  },
  {
    id: 'game-swap-notice',
    title: 'Partie · notice Swap',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 1,
      discard: card('green', 'swap'),
      activeColor: 'green',
      swapNotice: { kind: 'swap', actorIndex: 1, targetIndex: 0, direction: 1, at: 1 },
    },
    deadlineIn: 20,
  },
  {
    id: 'game-interrupt',
    title: 'Partie · interception',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 1,
      discard: num('red', 5),
      interruptFlash: { actorIndex: 1, count: 1, at: 1 },
    },
    deadlineIn: 19,
  },
  {
    id: 'game-interrupt-combo',
    title: 'Partie · interception ×3',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 3,
      discard: card('blue', 'draw_two'),
      activeColor: 'blue',
      pendingDraw: 6,
      interruptFlash: { actorIndex: 3, count: 3, at: 2 },
    },
    deadlineIn: 8,
  },
  // ─── Maps ────────────────────────────────────────────────────────────────
  // One scene per room, plus the loading screen that introduces it. These are
  // the only place the art is reviewable without a server dealing a match, and
  // the table's placement (see maps.ts `playfield`) is measured by eye off the
  // art, so a drifted table shows up here and nowhere else.
  {
    id: 'game-map-neon',
    title: 'Map · Neon',
    screen: 'game',
    state: { ...gameBase, mapId: 'neon' },
    deadlineIn: 21,
  },
  {
    id: 'game-map-rune',
    title: 'Map · Rune',
    screen: 'game',
    state: { ...gameBase, mapId: 'rune', discard: card('green', 'draw_two'), activeColor: 'green' },
    deadlineIn: 18,
  },
  {
    id: 'game-map-velvet',
    title: 'Map · Velvet',
    screen: 'game',
    state: { ...gameBase, mapId: 'velvet', discard: num('yellow', 4), activeColor: 'yellow' },
    deadlineIn: 24,
  },
  {
    id: 'game-map-orbit',
    title: 'Map · Orbit',
    screen: 'game',
    state: {
      ...gameBase,
      mapId: 'orbit',
      discard: card('wild', 'wild'),
      activeColor: 'blue',
      direction: -1,
    },
    deadlineIn: 13,
  },
  {
    // The reveal. Two seats in, one still downloading: the state the roster
    // exists for, since a bar alone cannot tell a slow player from a hung game.
    id: 'game-map-loading',
    title: 'Map · écran de chargement',
    screen: 'game',
    state: {
      ...gameBase,
      mapId: 'rune',
      mapLoading: { ready: [0, 2] },
      turnDeadline: null,
    },
  },
  {
    id: 'game-eight-players',
    title: 'Partie · 8 joueurs',
    screen: 'game',
    state: { ...gameBase, players: PLAYERS_8, discard: card('yellow', 'reverse'), activeColor: 'yellow', direction: -1 },
    deadlineIn: 12,
  },
  {
    id: 'game-color-picker',
    title: 'Partie · choix de couleur',
    screen: 'game',
    state: gameBase,
    overlay: 'color-picker',
    deadlineIn: 16,
  },
  {
    // The same four swatches with the assist on. This is the control that is
    // unusable without it: four circles that differ in nothing but hue.
    id: 'game-color-picker-assist',
    title: 'Partie · choix de couleur (formes)',
    screen: 'game',
    state: gameBase,
    overlay: 'color-picker',
    colorAssist: true,
    deadlineIn: 16,
  },
  {
    id: 'game-player-picker',
    title: 'Partie · choix de joueur',
    screen: 'game',
    state: gameBase,
    overlay: 'player-picker',
    deadlineIn: 16,
  },
  {
    id: 'game-rules',
    title: 'Partie · règles ouvertes',
    screen: 'game',
    state: gameBase,
    overlay: 'rules',
  },
  {
    id: 'game-error',
    title: 'Partie · coup refusé',
    screen: 'game',
    state: { ...gameBase, errorMsg: 'not your turn' },
    deadlineIn: 11,
  },
  {
    id: 'game-disconnected',
    title: 'Partie · connexion perdue',
    screen: 'game',
    state: gameBase,
    wsStatus: 'connecting',
  },
  {
    // Held-TAB standings mid-match: two rounds played, one bot, one player on a
    // ping bad enough that the colour has to say so before the number does.
    id: 'game-scores',
    title: 'Partie · tableau des scores',
    screen: 'game',
    state: {
      ...gameBase,
      roundNumber: 4,
      matchFormat: 'BO7' as const,
      scoreboard: SCOREBOARD_HISTORIC,
      roundHistory: ROUND_HISTORY,
      latencies: LATENCIES,
    },
    overlay: 'scores',
  },
  {
    // Same overlay before anyone has scored: the round columns have nothing to
    // show yet, which is the state a player sees most often in a BO1.
    id: 'game-scores-round-one',
    title: 'Partie · scores (1re manche)',
    screen: 'game',
    state: {
      ...gameBase,
      roundNumber: 1,
      matchFormat: 'BO1' as const,
      roundHistory: [],
      scoreboard: SCOREBOARD_HISTORIC.map((e) => ({ ...e, score: 0, rounds_won: 0 })),
      latencies: LATENCIES,
    },
    overlay: 'scores',
  },
  {
    // The same standings pinned on a phone: no TAB to hold, so the hint gives
    // way to a ✕ and the scrim is no longer the only way back to the board.
    id: 'game-scores-pinned',
    title: 'Partie · scores épinglés',
    screen: 'game',
    state: {
      ...gameBase,
      roundNumber: 4,
      matchFormat: 'BO7' as const,
      scoreboard: SCOREBOARD_HISTORIC,
      roundHistory: ROUND_HISTORY,
      latencies: LATENCIES,
    },
    overlay: 'scores-pinned',
  },
  {
    id: 'round-summary',
    title: 'Fin de manche',
    screen: 'game',
    state: {
      ...gameBase,
      showRoundSummary: true,
      roundWinner: 'Nova',
      roundNumber_completed: 2,
      roundScores: ROUND_SCORES,
    },
  },
  {
    id: 'gameover-win',
    title: 'Fin de match · victoire',
    screen: 'gameover',
    state: {
      matchWinner: 'Nova',
      matchOver: true,
      scoreboard: SCOREBOARD,
      players: PLAYERS_4,
      myIndex: 0,
    },
  },
  {
    id: 'gameover-lose',
    title: 'Fin de match · défaite',
    screen: 'gameover',
    state: {
      matchWinner: 'Kiwi',
      matchOver: true,
      scoreboard: SCOREBOARD,
      players: PLAYERS_4,
      myIndex: 0,
    },
  },
  {
    // The screen a walkover produces. It must not look like the victory above:
    // no confetti, no trophy, and copy that names what happened.
    id: 'gameover-forfeit-won',
    title: 'Fin de match · adversaire parti',
    screen: 'gameover',
    state: {
      matchWinner: 'Nova',
      matchOver: true,
      isMatchmade: true,
      forfeitBy: 1,
      scoreboard: SCOREBOARD.slice(0, 2),
      players: PLAYERS_4.slice(0, 2),
      myIndex: 0,
    },
  },
  {
    id: 'gameover-forfeit-left',
    title: 'Fin de match · tu as quitté',
    screen: 'gameover',
    state: {
      matchWinner: 'Kiwi',
      matchOver: true,
      isMatchmade: true,
      forfeitBy: 0,
      scoreboard: SCOREBOARD.slice(0, 2),
      players: PLAYERS_4.slice(0, 2),
      myIndex: 0,
    },
  },
  {
    // The whole point of making a rematch offer public: the other side has
    // asked, and this screen has to say so.
    id: 'gameover-rematch-offered',
    title: 'Fin de match · revanche proposée',
    screen: 'gameover',
    state: {
      matchWinner: 'Kiwi',
      matchOver: true,
      isMatchmade: true,
      rematchOffers: [1],
      rematchNeeded: 2,
      scoreboard: SCOREBOARD.slice(0, 2),
      players: PLAYERS_4.slice(0, 2),
      myIndex: 0,
    },
  },
  {
    // Past two seats the wait is on the table rather than on one opponent, and
    // the count is the only thing saying how far off the next match is. Ours is
    // in, so this is the state that has to hold without looking broken.
    id: 'gameover-rematch-table',
    title: 'Fin de match · revanche à 4',
    screen: 'gameover',
    state: {
      matchWinner: 'Kiwi',
      matchOver: true,
      rematchOffers: [0, 3],
      rematchNeeded: 4,
      scoreboard: SCOREBOARD,
      players: PLAYERS_4,
      myIndex: 0,
    },
  },
  {
    // The board a disconnected opponent leaves behind, with the clock their
    // seat is on. Only a matchmade room ever renders this.
    id: 'game-opponent-away',
    title: 'Partie · adversaire déconnecté',
    screen: 'game',
    state: {
      ...gameBase,
      players: PLAYERS_4.slice(0, 2),
      isMatchmade: true,
      opponentAway: { seat: 1, deadline: Date.now() + 11_000 },
    },
  },
  {
    // A deploy landing mid-match. The one thing to check here is that it reads
    // as a note and not as a warning: nothing about the board changes, and a
    // player who never sees it loses nothing.
    id: 'game-server-updating',
    title: 'Partie · mise à jour du serveur',
    screen: 'game',
    state: {
      ...gameBase,
      serverUpdating: true,
    },
  },
  {
    // Both at once, which is the only reason the banner has an offset: the
    // countdown owns the slot, the deploy note waits its turn under it.
    id: 'game-server-updating-with-away',
    title: 'Partie · mise à jour + adversaire absent',
    screen: 'game',
    state: {
      ...gameBase,
      players: PLAYERS_4.slice(0, 2),
      isMatchmade: true,
      opponentAway: { seat: 1, deadline: Date.now() + 11_000 },
      serverUpdating: true,
    },
  },
]

export const SCENE_IDS = SCENES.map((s) => s.id)
