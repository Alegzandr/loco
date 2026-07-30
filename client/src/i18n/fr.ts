import type { Translations } from './en'

export const fr: Translations = {
  // ─── Lobby ───────────────────────────────────────────────────
  tagline: 'Jeu de cartes multijoueur en temps réel',
  createRoom: 'Créer une partie',
  joinRoom: 'Rejoindre',
  createGame: 'Créer la partie',
  joinGame: 'Rejoindre',
  yourNickname: 'Votre pseudo',
  roomCodeLabel: 'Code de salle',
  back: 'Retour',
  rulesBtn: 'Règles',

  // ─── Waiting Room ─────────────────────────────────────────────
  waitingRoom: 'Salle d\'attente',
  roomCode: 'Code de salle',
  shareCode: 'Partagez ce code avec vos amis !',
  copyCode: 'Copié !',
  // ─── Audio ────────────────────────────────────────────────────────
  audioTitle: 'Son',
  audioMaster: 'Général',
  audioSfx: 'Effets',
  audioMusic: 'Musique',
  audioTrack: 'En cours',
  audioNextTrack: 'Morceau suivant',
  audioMute: 'Couper le son',
  audioUnmute: 'Rétablir le son',

  // ─── Interrupt ────────────────────────────────────────────────────
  interruptTitle: 'INTERCEPTION !',
  interruptBy: '%actor prend la main',
  interruptByYou: 'Vous prenez la main',
  interruptCombo: '×%n',
  fxSkip: 'PASSE !',
  fxReverse: 'DEMI-TOUR !',
  drawPile: 'Pioche',
  hostBadge: 'Hôte',
  matchFormat: 'Format de match',
  maxPlayersLabel: 'Joueurs max',
  addBot: '+ Ajouter un bot',
  startGame: 'Démarrer',
  waitingForPlayers: 'En attente de joueurs…',
  waitingForHost: 'En attente du démarrage par l\'hôte…',

  // ─── Format labels ────────────────────────────────────────────
  bestOf1: 'Manche unique',
  bestOf3: 'Meilleur des 3',
  bestOf5: 'Meilleur des 5',
  bestOf7: 'Meilleur des 7',

  // ─── Game View ────────────────────────────────────────────────
  draw: 'Piocher',
  pass: 'Passer',
  unoBtn: 'LOCO !',
  unoBanner: 'LOCO !',
  catchBtn: 'Contre-LOCO !',
  chooseColor: 'Choisissez une couleur',
  choosePlayer: 'Choisissez un joueur avec qui échanger votre main',
  catchWindow: 'Contre-LOCO possible !',
  swapNotice: '%actor a échangé sa main avec %target',
  swapNoticeYouTarget: '%actor a échangé sa main avec vous',
  swapNoticeYouActor: 'Vous avez échangé votre main avec %target',
  globalSwitchNoticeCw: '%actor a joué Global Switch — les mains tournent →',
  globalSwitchNoticeCcw: '%actor a joué Global Switch — les mains tournent ←',
  reconnected: 'Reconnecté',
  rebuildingTable: 'Reconstruction de la table…',
  wsLostConnection: 'Connexion perdue',
  wsReconnecting: 'Reconnexion…',
  round: 'Manche',
  of: 'sur',
  complete: 'Terminée',
  winsRound: 'remporte la manche !',
  player: 'Joueur',
  placementLabel: 'Position',
  ptsLabel: '+pts',
  totalLabel: 'Total',
  winsLabel: 'Victoires',
  matchScoreboard: 'Classement du match',
  continueBtn: 'Continuer',
  spectating: 'Vous avez terminé ! Regardez la suite…',

  // ─── Tableau des scores en jeu (TAB maintenu) ─────────────────
  scoreTableTitle: 'Scores',
  scoreTableHint: 'Maintenez TAB',
  scoreTableBtn: 'Scores',
  scoreTableRoundCol: 'M%n',
  scoreTablePingCol: 'Ping',
  scoreTableYou: 'vous',
  scoreTableBot: 'BOT',
  scoreTableNoPing: '--',
  scoreTableEmptyRounds: 'Première manche en cours',

  // ─── PixiGame in-canvas strings ───────────────────────────────
  yourTurn: 'Votre tour',
  drawOrCounter: 'Piocher %n ou contrer !',
  drawPenalty: 'Piocher %n',
  playerTurnSuffix: ' joue',
  ord1: '1er',
  ord2: '2e',
  ord3: '3e',
  ordN: 'e',

  // ─── Game Over ────────────────────────────────────────────────
  matchWon: 'Match gagné !',
  gameOver: 'Partie terminée',
  youWin: 'Vous avez gagné !',
  playAgain: 'Rejouer',
  finalScores: 'Scores finaux',
  winsGame: 'remporte la partie !',
  winsMatch: 'remporte le match !',
  rematch: 'Revanche',
  rematchWaiting: 'En attente d\'une revanche lancée par l\'hôte…',
  leaveRoom: 'Quitter le salon',

  // ─── Language ────────────────────────────────────────────────
  language: 'Langue',

  // ─── Rules ───────────────────────────────────────────────────
  rulesTitle: 'Règles du jeu',
  rulesClose: 'Fermer',

  rules: [
    {
      heading: 'Joueurs et mise en place',
      items: [
        'De 2 à 10 joueurs par partie (recommandé : 2–6).',
        'Chaque joueur reçoit 8 cartes au début de chaque manche.',
        'La première carte retournée pour démarrer la défausse est toujours une carte numérotée.',
        'Le premier à jouer en manche 1 est tiré au hasard ; les manches suivantes commencent par le joueur ayant le score le plus bas.',
      ],
    },
    {
      heading: 'À votre tour',
      items: [
        'Jouez une carte qui correspond à la couleur ou à la valeur du dessus, jouez un Joker, ou piochez.',
        'Après avoir pioché, vous pouvez jouer la carte si elle est légale, sinon appuyez sur Passer.',
      ],
    },
    {
      heading: 'Jouer plusieurs cartes identiques',
      items: [
        'Vous pouvez jouer plusieurs cartes strictement identiques (même couleur et même valeur) en une seule fois.',
        'Les effets se cumulent — trois +2 forcent à piocher 6, deux Passe sautent deux joueurs, etc.',
      ],
    },
    {
      heading: 'Cartes spéciales',
      items: [
        'Passe — le joueur suivant perd son tour.',
        'Inverse — inverse le sens de jeu (agit comme un Passe à 2 joueurs).',
        '+2 — le joueur suivant pioche 2 et perd son tour sauf s\'il cumule.',
        'Joker — choisissez la couleur active.',
        'Joker +4 — choisissez la couleur ; le suivant pioche 4 sauf s\'il cumule.',
        'Échange (⇋) — carte colorée ; à votre tour, choisissez un adversaire et échangez vos mains. Pas de cumul.',
        'Rotation globale (↻) — carte joker ; choisissez la couleur active, puis chaque joueur passe sa main au joueur suivant dans le sens en cours.',
      ],
    },
    {
      heading: 'Prise de tête (interruption carte identique)',
      items: [
        'Tant qu\'une carte est sur la pile, n\'importe qui peut jouer instantanément une carte identique (même couleur, type et valeur) et prendre la main — même quand ce n\'est pas son tour.',
        'Aucun délai : la fenêtre reste ouverte jusqu\'à ce que quelqu\'un joue, pioche ou passe. Y compris pour celui qui vient de jouer et pour celui dont c\'est le tour.',
        'La première interruption reçue par le serveur l\'emporte : l\'interrupteur prend la main et le jeu continue depuis sa place.',
        'Si vous avez plusieurs copies identiques, vous pouvez toutes les jouer d\'un seul coup — les effets se cumulent comme pour un jeu groupé en cours de tour.',
        'Toutes les cartes peuvent intercepter, jokers et Rotation globale compris : un Joker se pose sur un Joker, un +4 prolonge une chaîne de +4. Seule règle : être identique au sommet de la pile.',
      ],
    },
    {
      heading: 'Priorité',
      items: [
        'En cas de réactions simultanées, la première interruption reçue par le serveur l\'emporte.',
        'Le timing du serveur fait foi.',
      ],
    },
    {
      heading: 'LOCO ! et Contre-LOCO',
      items: [
        'Quand il ne vous reste qu\'une carte, vous devez appuyer sur LOCO !',
        'Recevoir sa dernière carte compte aussi : après un Échange ou une Rotation globale, tous ceux qui n\'ont plus qu\'une carte doivent appuyer sur LOCO !',
        'Sinon, tout autre joueur a 5 secondes pour appuyer sur Contre-LOCO ! — pénalité : vous piochez 2 cartes.',
      ],
    },
    {
      heading: 'Minuteur & AFK',
      items: [
        'Chaque tour est limité dans le temps ; si le minuteur expire, le serveur pioche et passe automatiquement.',
        'Environ 2 manches d\'inactivité (4 tours auto à la suite) entraînent l\'expulsion de la partie.',
      ],
    },
    {
      heading: 'Fin de manche & score',
      items: [
        'La manche se termine dès qu\'un joueur vide sa main — il remporte la manche.',
        'Le vainqueur marque la somme des valeurs restantes de tous les autres joueurs ; les autres marquent 0.',
        'Cartes numérotées = valeur faciale (1–9). Inverse = 10 pts. Passe = 20 pts. +2 / Échange = 30 pts. Joker / Rotation = 40 pts. +4 = 50 pts.',
      ],
    },
    {
      heading: 'Formats de match et départage',
      items: [
        'BO1 / BO3 / BO5 / BO7 — la longueur du match correspond au nombre de manches.',
        'Le vainqueur du match est celui qui totalise le score le plus élevé après toutes les manches.',
        'Départage : manches gagnées → total de cartes perdantes le plus bas → manche décisive.',
      ],
    },
  ] as const,

  // ─── Actions refusées ────────────────────────────────────────
  errors: {
    generic: 'Ça n\'a pas marché. Réessayez.',

    nicknameTaken: 'Ce pseudo est déjà pris dans cette salle.',
    nicknameLength: 'Choisissez un pseudo de 1 à 20 caractères.',
    roomNotFound: 'Aucune salle avec ce code.',
    roomFull: 'Cette salle est pleine.',
    gameInProgress: 'Cette partie a déjà commencé.',
    sessionInvalid: 'Impossible de récupérer votre place. Rejoignez la salle.',
    notInRoom: 'Vous n\'êtes plus dans une salle.',

    notYourTurn: 'Ce n\'est pas encore à vous.',
    mustAnswerPenalty: 'Contrez, ou prenez les cartes.',
    alreadyDrew: 'Une seule pioche par tour.',
    mustDrawFirst: 'Piochez avant de passer.',
    needColor: 'Choisissez d\'abord une couleur.',
    cardNotInHand: 'Vous n\'avez pas cette carte.',
    illegalCard: 'Cette carte ne correspond pas.',

    counterMismatch: 'Seule la carte identique se cumule.',
    noPendingDraw: 'Rien à contrer pour l\'instant.',

    interruptClosed: 'Trop tard.',
    interruptDrawChain: 'Seule une carte de pioche identique peut s\'intercaler ici.',
    interruptMismatch: 'Il faut une carte identique à celle du dessus.',
    batchNotAllowed: 'Échange et Rotation globale ne se jouent pas en série.',
    batchMismatch: 'Les cartes jouées ensemble doivent être identiques.',

    declareTooEarly: 'Annoncez LOCO avec exactement une carte.',
    alreadyDeclared: 'Déjà annoncé.',
    catchExpired: 'Trop tard pour attraper.',
    catchTargetSafe: 'Rien à attraper ici.',

    swapSelf: 'Choisissez un autre joueur.',
    swapTargetInvalid: 'Ce joueur ne peut pas être ciblé.',

    hostOnly: 'Seul l\'hôte peut faire ça.',
    notEnoughPlayers: 'Pas assez de joueurs pour démarrer.',
    lobbyOnly: 'Modifiable seulement avant le début de la partie.',
    maxPlayersInvalid: 'Cette limite de joueurs n\'est pas autorisée.',
    rematchTooEarly: 'Le match n\'est pas encore terminé.',

    rateLimited: 'Doucement, une seconde.',
    serverBusy: 'Serveur occupé. Réessayez.',
    deckExhausted: 'Plus de cartes à piocher.',
  },
}
