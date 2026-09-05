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
  // La même modale sur son autre onglet : le jeu dessiné, huit visuels et une
  // grille qui passe en une colonne sous 480px.
  | 'rules-cards'
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
    | 'tabtaken'
    | 'cards'
    | 'og'
    | 'cover'
    | 'roomStill'
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
  lobbyMode?: 'home' | 'find' | 'bot' | 'create' | 'join'
  /** Lobby: the table code a shared link arrived with, already in the field. */
  lobbyCode?: string
  /** Seconds already spent searching, so the three stages of the copy can each
   *  be captured (see components/searchStages.ts: 0-10s, 10-20s, 20s+). */
  searchingFor?: number
  /** Simulated transport state for the game screen. */
  wsStatus?: 'connecting' | 'open' | 'closed'
  /** Waiting room: mount straight into the leave confirmation. */
  confirmLeave?: boolean
  /** Waiting room: which roster row has its ⋯ menu open. A dropdown at `wide`,
   *  a bottom sheet at `small` — so this scene is worth both viewports. */
  rowMenuSeat?: number
  /** Waiting room: that menu, mounted straight into one of its two questions. */
  rowMenuAsk?: 'host' | 'kick'
  /** Preferences: hide the table code, the way a streamer would. */
  streamerMode?: boolean
  /** Lobby: mount with the preferences panel open. */
  prefsOpen?: boolean
  /** Lobby: mount with the language list open inside that panel. */
  langOpen?: boolean
  /** Lobby: mount with the sound panel open. */
  audioOpen?: boolean
  /** Which link preview to draw: the site's, or a table invitation's. */
  ogVariant?: 'default' | 'invite'
  /** Which cut of the 600×800 game cover to draw. */
  coverVariant?: 'duck' | 'fan' | 'mark'
  /** Colour assist: every suit also carries its silhouette. */
  colorAssist?: boolean
  /** One tab at a time: whether the tab holding the game is at a table. It is
   *  the difference between an offer and a warning, so both are worth a look. */
  otherTabSeated?: boolean
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
    // The same drawing with the invitation's line on it, captured into
    // og.invite.png. It is a scene rather than a variant of the one above
    // because it is a different picture shipped to a different URL, and the
    // review pass has to see both.
    id: 'og-invite',
    title: 'Aperçu de lien — invitation',
    screen: 'og',
    ogVariant: 'invite',
  },
  {
    // The 600×800 game cover, uploaded to IGDB and drawn by Twitch as the
    // category's box art. Captured by `tools/cover/shoot.mjs` into `brand/`.
    //
    // Three cuts rather than one because the pick is a judgement made by
    // looking, and because the size that decides it is not the size it is
    // reviewed at: a category is picked out of a sidebar at about 40px wide.
    // They live in the registry so a change to the mark or to a card face is
    // seen here too — this art is uploaded to a third party, where nothing in
    // this repository can watch it go stale.
    id: 'cover-duck',
    title: 'Cover · marque + main',
    screen: 'cover',
    coverVariant: 'duck',
  },
  {
    id: 'cover-fan',
    title: 'Cover · main large',
    screen: 'cover',
    coverVariant: 'fan',
  },
  {
    id: 'cover-mark',
    title: 'Cover · marque seule',
    screen: 'cover',
    coverVariant: 'mark',
  },
  {
    id: 'lobby-home',
    title: 'Accueil',
    screen: 'lobby',
    lobbyMode: 'home',
  },
  {
    // The count is drawn opposite the chip row, so this scene is worth both
    // viewports: under 46rem the burger owns that corner and the plate has to
    // clear it without wrapping the line.
    id: 'lobby-online',
    title: 'Accueil · joueurs connectés',
    screen: 'lobby',
    lobbyMode: 'home',
    state: { playersOnline: 128 },
  },
  {
    // The live strip, and it is worth all three viewports: above 46rem it is a
    // row of previews along the foot of the board and must clear the row of
    // links the page serves under it, under 46rem it collapses to one line
    // stacked above the connected-player plate, and on a notch the whole thing
    // has to stay inside the safe area. Nobody live draws nothing at all, which
    // is what `lobby-home` above already shows.
    id: 'lobby-live',
    title: 'Accueil · en direct',
    screen: 'lobby',
    lobbyMode: 'home',
    state: {
      playersOnline: 128,
      liveStreams: [
        { login: 'kisukesaama', name: 'KisukeSaama', viewers: 1240, thumb: '', lang: 'fr' },
        { login: 'someone_else', name: 'SomeoneElse', viewers: 312, thumb: '', lang: 'en' },
        { login: 'a_third_one', name: 'AThirdOne', viewers: 47, thumb: '', lang: 'fr' },
        { login: 'a_fourth', name: 'AFourth', viewers: 8, thumb: '', lang: 'en' },
      ],
    },
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
    // The queue's form with the wait taken out: one field, one button, no code.
    id: 'lobby-bot',
    title: 'Accueil · contre un bot',
    screen: 'lobby',
    lobbyMode: 'bot',
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
    searchingFor: 14,
  },
  {
    // The count, on the screen that asks for it. Worth both viewports: above
    // 46rem it holds the top-left corner opposite the chip row, under it it
    // moves to the foot of the screen as it does on the entry screen, and on a
    // notch it has to clear the home indicator. Drawn at the long stage on
    // purpose — that is the tallest this screen ever gets, two ways out instead
    // of one, and the placement under 46rem is the one the plate has to clear.
    id: 'matchmaking-searching-online',
    title: '1v1 · recherche avec joueurs connectés',
    screen: 'searching',
    searchingFor: 70,
    state: { playersOnline: 128 },
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
    id: 'tab-taken',
    title: 'Autre onglet · rien en cours',
    screen: 'tabtaken',
  },
  {
    id: 'tab-taken-seated',
    title: 'Autre onglet · partie en cours',
    screen: 'tabtaken',
    otherTabSeated: true,
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
  {
    id: 'lobby-rules-cards',
    title: 'Règles · les cartes',
    screen: 'lobby',
    overlay: 'rules-cards',
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
    // The host's two controls over one row. A dropdown hanging off the ⋯ at
    // `wide`, a bottom sheet at `small`: shoot both, they are two objects.
    id: 'waiting-row-menu',
    title: 'Salon · actions sur un joueur',
    screen: 'waiting',
    rowMenuSeat: 1,
    state: {
      roomCode: 'KX7QP2',
      players: PLAYERS_4,
      myIndex: 0,
      matchFormat: 'BO3',
      maxPlayers: 6,
    },
  },
  {
    // The other half of that panel: the question in the menu's place. This is
    // the destructive one, so it is the one worth looking at.
    id: 'waiting-row-menu-confirm',
    title: 'Salon · retirer un joueur',
    screen: 'waiting',
    rowMenuSeat: 1,
    rowMenuAsk: 'kick',
    state: {
      roomCode: 'KX7QP2',
      players: PLAYERS_4,
      myIndex: 0,
      matchFormat: 'BO3',
      maxPlayers: 6,
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
    // The action bar at its emptiest, and the reason `.slotFill` exists: it is
    // not our turn, so Piocher and Passer are gone, and nobody is close enough
    // to finishing for Contre-LOCO to be pressable either. Every button in the
    // bar is absent or dead at once — which is the only moment the two outer
    // columns are drawn rather than merely reserved. Reviewed on a phone
    // because that is where the bar runs edge to edge.
    id: 'game-opponent-turn-quiet',
    title: 'Partie · tour adverse, barre au repos',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 2,
      players: [player(0, 'Nova', 3), player(1, 'Kiwi', 6), player(2, 'Bot1', 6)],
      myHand: HAND_7.slice(0, 3),
      scoreboard: SCOREBOARD.slice(0, 3),
    },
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
    title: 'Partie · LOCO! annoncé',
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
    // The in-between state, and the common one: Kiwi is on two cards, so the
    // wager is on the table and the centre button is pressable — but nobody
    // owes the call yet, so it is awake rather than armed. Three readable
    // states, and this is the one that has to be legible at 720p without the
    // halo doing the work.
    id: 'game-catch-live',
    title: 'Partie · attrapage armé sans cible',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 0,
      catchTarget: null,
      players: [player(0, 'Nova', 5), player(1, 'Kiwi', 2), player(2, 'Bot1', 9), player(3, 'Pixel', 6)],
    },
    deadlineIn: 16,
  },
  {
    // The overlap: we are on one card AND Pixel is catchable. Catch keeps the
    // centre column, always, and the LOCO! chip above the bar — on screen and
    // dead in every other scene — is the only thing that changes.
    id: 'game-catch-and-loco',
    title: 'Partie · attraper + LOCO!',
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
    // The press, before the verdict: we have pressed on Pixel and the server
    // has not answered. The centre button is held down — ledge collapsed, face
    // darkened, the armed pop stopped — and nothing else on the board has
    // moved, because nothing else is ours to decide. Review it beside
    // `game-catch-window`: the two differ by the button alone.
    id: 'game-catch-pressed',
    title: 'Partie · Contre-LOCO! envoyé',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 0,
      catchTarget: 3,
      catchPending: true,
      players: [player(0, 'Nova', 5), player(1, 'Kiwi', 4), player(2, 'Bot1', 9), player(3, 'Pixel', 1)],
    },
    unoIn: 3.0,
    deadlineIn: 14,
  },
  {
    // The wager lost: our Contre-LOCO! arrived after Pixel's own call and drew
    // us a card for it. The notice is red and sits below the swap pill so the
    // two can share the screen; both are table news, not errors.
    id: 'game-catch-failed',
    title: 'Partie · Contre-LOCO! raté',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 0,
      catchFailed: { seat: 0, at: 1 },
      // The third reading of the centre button, and the board that produces it:
      // our call missed, the wager is spent, and Pixel's window is still
      // running with nothing left for us to aim at. A live button there would
      // do nothing at all when pressed, so it is drawn dead.
      catchSpent: true,
      catchTarget: 3,
      players: [player(0, 'Nova', 6), player(1, 'Kiwi', 4), player(2, 'Bot1', 9), player(3, 'Pixel', 1)],
    },
    unoIn: 1.8,
    deadlineIn: 16,
  },
  {
    // The wager won. The stamp names the seat that owed the call, the chip says
    // what it cost, and the board underneath flies the two cards to that seat.
    // Deliberately red and vertical where the interception slam is actor-tinted
    // and horizontal: review the two side by side in the contact sheet.
    id: 'game-catch-caught',
    title: 'Partie · Contre-LOCO! réussi',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 0,
      catchFlash: { seat: 3, at: 1 },
      // Pixel's hand has grown to three and the button is still live over it:
      // the offer is the window, not the hand, so a press a beat late is a
      // mistake the player is still allowed to make.
      catchTarget: 3,
      players: [player(0, 'Nova', 6), player(1, 'Kiwi', 4), player(2, 'Bot1', 9), player(3, 'Pixel', 3)],
    },
    unoIn: 1.2,
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
    // Leaving a match at a table that keeps playing without the seat. The chip
    // is in the chrome row, never on the action bar, and the question takes its
    // place out of the flow so the board does not move for it.
    id: 'game-leave-ask',
    title: 'Partie · quitter le match',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 0,
    },
    confirmLeave: true,
    deadlineIn: 18,
  },
  {
    // The same question at a table that cannot spare the seat: the line under it
    // is the one that changes, and it is the half of the decision the player
    // cannot read off their own screen.
    id: 'game-leave-ask-ends',
    title: 'Partie · quitter un 1v1',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 0,
      players: [player(0, 'Nova', 5), player(1, 'Kiwi', 4)],
    },
    confirmLeave: true,
    deadlineIn: 18,
  },
  {
    // What the seats that stayed are told. Held and gone read identically in the
    // roster, so this pill is the only thing that says the chair is empty for
    // the rest of the match.
    id: 'game-departure-notice',
    title: 'Partie · un siège est parti',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 1,
      goneSeats: [3],
      departureNotice: { nickname: 'Pixel', at: 1 },
    },
    deadlineIn: 20,
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
    // The longest line any of the three pills carries, and the one that names a
    // direction in words rather than drawing an arrow: this is the scene that
    // says whether it still wraps to two readable lines on a phone.
    id: 'game-global-switch-notice',
    title: 'Partie · notice Rotation',
    screen: 'game',
    state: {
      ...gameBase,
      currentTurn: 1,
      discard: card('wild', 'global_switch'),
      activeColor: 'blue',
      direction: -1,
      swapNotice: { kind: 'global_switch', actorIndex: 1, targetIndex: -1, direction: -1, at: 1 },
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
  // One scene per room at a representative hour, a few more at the hours and
  // skies that change the most, plus the loading screen that introduces it.
  // These are the only place a room is reviewable without a server dealing a
  // match: the diorama is rendered in the browser from the three ids, so what
  // `make visual` shoots here is exactly what a match draws.
  // The stills the rooms page is drawn from: each room alone, at its signature
  // hour under a clear sky, framed 16:9 with the podium under where the page's
  // CSS table will sit. `make rooms` (tools/rooms/shoot.mjs) shoots these six
  // into client/src/assets/rooms/ and commits them; a content page ships no
  // script, so a photograph of the render is the only way it can show the
  // room. The hours here and `SIGNATURE` in content/TablesArticle.astro are
  // one list, pinned by contentPages.test.ts.
  ...(
    [
      ['neon', 'night'],
      ['rune', 'dusk'],
      ['velvet', 'dusk'],
      ['orbit', 'night'],
      ['sakura', 'day'],
      ['marina', 'dawn'],
    ] as const
  ).map(([mapId, mapTime]) => ({
    id: `room-still-${mapId}`,
    title: `Décor · ${mapId} (vignette de la page des décors)`,
    screen: 'roomStill' as const,
    state: { mapId, mapTime, mapWeather: 'clear' },
  })),
  {
    id: 'game-map-neon',
    title: 'Map · Neon · nuit, pluie',
    screen: 'game',
    state: { ...gameBase, mapId: 'neon', mapTime: 'night', mapWeather: 'rain' },
    deadlineIn: 21,
  },
  {
    id: 'game-map-neon-day',
    title: 'Map · Neon · plein jour',
    screen: 'game',
    state: { ...gameBase, mapId: 'neon', mapTime: 'day', mapWeather: 'clear', discard: num('blue', 7), activeColor: 'blue' },
    deadlineIn: 21,
  },
  {
    id: 'game-map-rune',
    title: 'Map · Rune · crépuscule',
    screen: 'game',
    state: { ...gameBase, mapId: 'rune', mapTime: 'dusk', mapWeather: 'clear', discard: card('green', 'draw_two'), activeColor: 'green' },
    deadlineIn: 18,
  },
  {
    id: 'game-map-rune-snow',
    title: 'Map · Rune · jour, neige',
    screen: 'game',
    state: { ...gameBase, mapId: 'rune', mapTime: 'day', mapWeather: 'snow' },
    deadlineIn: 18,
  },
  {
    id: 'game-map-velvet',
    title: 'Map · Velvet · crépuscule',
    screen: 'game',
    state: { ...gameBase, mapId: 'velvet', mapTime: 'dusk', mapWeather: 'clear', discard: num('yellow', 4), activeColor: 'yellow' },
    deadlineIn: 24,
  },
  {
    id: 'game-map-velvet-fog',
    title: 'Map · Velvet · aube, brume',
    screen: 'game',
    state: { ...gameBase, mapId: 'velvet', mapTime: 'dawn', mapWeather: 'fog' },
    deadlineIn: 24,
  },
  {
    id: 'game-map-orbit',
    title: 'Map · Orbit · nuit',
    screen: 'game',
    state: {
      ...gameBase,
      mapId: 'orbit',
      mapTime: 'night',
      mapWeather: 'clear',
      discard: card('wild', 'wild'),
      activeColor: 'blue',
      direction: -1,
    },
    deadlineIn: 13,
  },
  {
    id: 'game-map-orbit-storm',
    title: 'Map · Orbit · jour, tempête',
    screen: 'game',
    state: { ...gameBase, mapId: 'orbit', mapTime: 'day', mapWeather: 'storm' },
    deadlineIn: 13,
  },
  {
    id: 'game-map-sakura',
    title: 'Map · Sakura · plein jour',
    screen: 'game',
    state: { ...gameBase, mapId: 'sakura', mapTime: 'day', mapWeather: 'clear', discard: num('green', 2), activeColor: 'green' },
    deadlineIn: 16,
  },
  {
    id: 'game-map-sakura-night',
    title: 'Map · Sakura · nuit, neige',
    screen: 'game',
    state: { ...gameBase, mapId: 'sakura', mapTime: 'night', mapWeather: 'snow' },
    deadlineIn: 16,
  },
  {
    id: 'game-map-marina',
    title: 'Map · Marina · aube',
    screen: 'game',
    state: { ...gameBase, mapId: 'marina', mapTime: 'dawn', mapWeather: 'clear', discard: card('blue', 'skip'), activeColor: 'blue' },
    deadlineIn: 19,
  },
  {
    id: 'game-map-marina-day',
    title: 'Map · Marina · plein jour',
    screen: 'game',
    state: { ...gameBase, mapId: 'marina', mapTime: 'day', mapWeather: 'clear', discard: num('yellow', 6), activeColor: 'yellow' },
    deadlineIn: 19,
  },
  {
    id: 'game-map-marina-storm',
    title: 'Map · Marina · nuit, orage',
    screen: 'game',
    state: { ...gameBase, mapId: 'marina', mapTime: 'night', mapWeather: 'storm' },
    deadlineIn: 19,
  },
  {
    // The reveal. Two seats in, one still rendering: the state the roster
    // exists for, since a bar alone cannot tell a slow player from a hung game.
    id: 'game-map-loading',
    title: 'Map · écran de chargement',
    screen: 'game',
    state: {
      ...gameBase,
      mapId: 'rune',
      mapTime: 'dusk',
      mapWeather: 'rain',
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
    // The format ran out and nothing separated the table, so the server dealt
    // one more. Two things to look at: the card announces the extra round next
    // to the button that goes there, and the chip top-left says "decisive
    // round" instead of counting past the format.
    id: 'round-summary-decisive',
    title: 'Fin de manche · décisive',
    screen: 'game',
    state: {
      ...gameBase,
      matchFormat: 'BO3' as const,
      roundNumber: 3,
      showRoundSummary: true,
      roundWinner: 'Nova',
      roundNumber_completed: 3,
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
      // One record is the match that just ended: the recap stays off, and the
      // duration line under the heading is drawn from it.
      matchHistory: [
        { rounds_won: [2, 1, 0, 0], scores: [90, 55, 20, 10], winner_index: 0, duration_ms: 14 * 60_000 },
      ],
    },
  },
  {
    // The evening's recap: only drawn once the table has rematched, so the
    // scene is the one that has. Four seats and four matches is the widest the
    // block gets before it starts scrolling sideways, which is the case worth
    // looking at.
    id: 'gameover-recap',
    title: 'Fin de match · récap de soirée',
    screen: 'gameover',
    state: {
      matchWinner: 'Nova',
      matchOver: true,
      scoreboard: SCOREBOARD,
      players: PLAYERS_4,
      myIndex: 0,
      matchHistory: [
        { rounds_won: [2, 1, 0, 0], scores: [90, 55, 20, 10], winner_index: 0, duration_ms: 14 * 60_000 },
        { rounds_won: [1, 0, 2, 0], scores: [40, 5, 85, 15], winner_index: 2, duration_ms: 11 * 60_000 },
        { rounds_won: [0, 2, 1, 0], scores: [12, 88, 44, 0], winner_index: 1, duration_ms: 17 * 60_000 },
        { rounds_won: [2, 0, 1, 0], scores: [95, 10, 35, 5], winner_index: 0, duration_ms: 65 * 60_000 },
      ],
    },
  },
  {
    // No rematch to negotiate: the other seat is the server. Another press, or
    // the queue.
    id: 'gameover-solo',
    title: 'Fin de match · contre un bot',
    screen: 'gameover',
    state: {
      matchWinner: 'Nova',
      matchOver: true,
      isSolo: true,
      myIndex: 0,
      players: [
        { index: 0, nickname: 'Nova', hand_size: 0, connected: true },
        { index: 1, nickname: 'Bot1', hand_size: 4, connected: true, is_bot: true },
      ],
      scoreboard: [
        { player_index: 0, nickname: 'Nova', score: 46, rounds_won: 1 },
        { player_index: 1, nickname: 'Bot1', score: 0, rounds_won: 0 },
      ],
    },
  },
  {
    // The three fixed things, and two of the four seats already talking: the
    // feed is one line per seat, so the two that said nothing are the empty
    // slots holding the card's height still. Nothing about any of it is kept.
    id: 'gameover-emotes',
    title: 'Fin de match · émotes',
    screen: 'gameover',
    state: {
      matchWinner: 'Nova',
      matchOver: true,
      scoreboard: SCOREBOARD,
      players: PLAYERS_4,
      myIndex: 0,
      emotes: [
        { seat: 1, emote: 'gg', at: 1 },
        { seat: 0, emote: 'close', at: 2 },
      ],
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
      // Under the "takes the match" sentence this time: the duration line has
      // to sit as well under a sub as under the heading alone.
      matchHistory: [
        { rounds_won: [1, 2, 0, 0], scores: [55, 90, 20, 10], winner_index: 1, duration_ms: 23 * 60_000 },
      ],
    },
  },
  {
    // A 1v1 decided on the cards, nobody having asked for anything yet: the one
    // state where the card carries all three controls at full strength. The
    // hierarchy is the thing to look at — the revanche and the relaunch are two
    // offers of equal weight, and the way out under them has to read as the
    // quietest thing there without disappearing.
    id: 'gameover-matchmade',
    title: 'Fin de match · 1v1',
    screen: 'gameover',
    state: {
      matchWinner: 'Nova',
      matchOver: true,
      isMatchmade: true,
      rematchNeeded: 2,
      scoreboard: SCOREBOARD.slice(0, 2),
      players: PLAYERS_4.slice(0, 2),
      myIndex: 0,
    },
  },
  {
    // The screen a walkover produces. It must not look like the victory above:
    // nothing falls, the mark is the face-down card, and the copy names what happened.
    id: 'gameover-forfeit-won',
    title: 'Fin de match · adversaire parti',
    screen: 'gameover',
    state: {
      matchWinner: 'Nova',
      matchOver: true,
      isMatchmade: true,
      forfeitBy: 1,
      forfeitedByMe: false,
      scoreboard: SCOREBOARD.slice(0, 2),
      players: PLAYERS_4.slice(0, 2),
      myIndex: 0,
      // A walkover is timed like any other match, from the open to the moment
      // the seat gave up.
      matchHistory: [
        { rounds_won: [0, 0], scores: [0, 0], winner_index: 0, duration_ms: 40_000 },
      ],
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
      forfeitedByMe: true,
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
    // The one state the board used to have no answer to: every other seat's
    // hold has run out, so nothing here will ever move again. The check is that
    // the card reads as an ending rather than as an error, and that the match
    // stays visible behind it — it is still the game that was being played.
    id: 'game-table-abandoned',
    title: 'Partie · table désertée',
    screen: 'game',
    state: {
      ...gameBase,
      players: PLAYERS_4.slice(0, 2).map((p) => (p.index === 0 ? p : { ...p, connected: false })),
      goneSeats: [1],
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
  {
    // The same deploy on a screen with no match running. The notice is an
    // ordinary line in the column here, not an absolute pill, and it says what
    // the deploy actually costs this screen: the start button below it.
    id: 'waiting-server-updating',
    title: 'Salon · mise à jour du serveur',
    screen: 'waiting',
    state: {
      roomCode: 'KX7QP2',
      players: PLAYERS_4,
      myIndex: 0,
      matchFormat: 'BO3',
      maxPlayers: 6,
      serverUpdating: true,
    },
  },
  {
    // And on the card people screenshot. It sits above the rematch button it is
    // about, and must not compete with the trophy at the top of the card.
    id: 'gameover-server-updating',
    title: 'Fin de match · mise à jour du serveur',
    screen: 'gameover',
    state: {
      matchWinner: 'Nova',
      matchOver: true,
      scoreboard: SCOREBOARD,
      players: PLAYERS_4,
      myIndex: 0,
      serverUpdating: true,
    },
  },
]

export const SCENE_IDS = SCENES.map((s) => s.id)
