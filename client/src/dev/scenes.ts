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
import type { CardDTO, PlayerDTO, ScoreboardEntryDTO } from '../types/protocol'
import type { RoundScoreEntry } from '../hooks/useGameStore'

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

const ROUND_SCORES: RoundScoreEntry[] = [
  { player_index: 0, nickname: 'Nova', round_points: 74, cumulative_score: 187, rounds_won: 2 },
  { player_index: 1, nickname: 'Kiwi', round_points: 0, cumulative_score: 142, rounds_won: 1 },
  { player_index: 2, nickname: 'Bot1', round_points: 0, cumulative_score: 96, rounds_won: 0 },
  { player_index: 3, nickname: 'Pixel', round_points: 0, cumulative_score: 55, rounds_won: 0 },
]

// ─── Scene registry ─────────────────────────────────────────────────────────

/** Extra element layered over the base screen (component-local state we can't set from the store). */
export type SceneOverlay = 'color-picker' | 'player-picker' | 'rules' | null

export interface Scene {
  id: string
  /** Human label shown in the gallery index. */
  title: string
  /** Which top-level screen to mount. */
  screen: 'lobby' | 'waiting' | 'game' | 'gameover'
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
  /** Lobby sub-screen ('home' | 'create' | 'join') — drives Lobby's internal mode. */
  lobbyMode?: 'home' | 'create' | 'join'
  /** Simulated transport state for the game screen. */
  wsStatus?: 'connecting' | 'open' | 'closed'
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
    id: 'lobby-error',
    title: 'Accueil · erreur',
    screen: 'lobby',
    lobbyMode: 'join',
    state: { errorMsg: 'nickname already taken' },
  },
  {
    id: 'lobby-rules',
    title: 'Règles du jeu',
    screen: 'lobby',
    overlay: 'rules',
  },
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
    id: 'game-uno',
    title: 'Partie · UNO annoncé',
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
]

export const SCENE_IDS = SCENES.map((s) => s.id)
