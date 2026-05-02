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
  unoBtn: 'UNO !',
  unoBanner: 'UNO !',
  catchBtn: 'Catch !',
  chooseColor: 'Choisissez une couleur',
  choosePlayer: 'Choisissez un joueur avec qui échanger votre main',
  catchWindow: 'Fenêtre de catch !',
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

  // ─── PixiGame in-canvas strings ───────────────────────────────
  yourTurn: 'Votre tour',
  drawOrCounter: 'Piocher %n ou contrer !',
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
        'Rotation globale (↻) — carte joker ; chaque joueur passe sa main au joueur suivant dans le sens en cours.',
      ],
    },
    {
      heading: 'Prise de tête (interruption carte identique)',
      items: [
        'Dès qu\'une carte est jouée, tout autre joueur dispose d\'une courte fenêtre (~1,5 s) pour jouer instantanément une carte identique (même couleur, type et valeur) — même quand ce n\'est pas son tour.',
        'La première interruption reçue par le serveur l\'emporte : l\'interrupteur prend la main et le jeu continue depuis sa place.',
        'Si vous avez plusieurs copies identiques, vous pouvez toutes les jouer d\'un seul coup — les effets se cumulent comme pour un jeu groupé en cours de tour.',
        'Les jokers et la Rotation globale ne peuvent pas servir d\'interruption. Le joueur qui vient de jouer ne peut pas s\'interrompre lui-même.',
      ],
    },
    {
      heading: 'Interruption +2 libre',
      items: [
        'Un +2 peut être joué à tout moment hors de votre tour, même s\'il ne correspond pas à la couleur ou à la valeur du dessus.',
        'Le joueur suivant doit cumuler (+2 / +4) ou piocher le total accumulé.',
        'Impossible si une pioche pénalité est déjà active — utilisez le cumul classique à la place.',
      ],
    },
    {
      heading: 'Priorité',
      items: [
        'En cas de réactions simultanées, le serveur tranche : interruption identique → interruption +2 → jeu normal.',
        'Le timing du serveur fait foi.',
      ],
    },
    {
      heading: 'UNO ! et Catch',
      items: [
        'Quand il ne vous reste qu\'une carte, vous devez appuyer sur UNO !',
        'Sinon, tout autre joueur a 5 secondes pour appuyer sur Catch ! — pénalité : vous piochez 2 cartes.',
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
        'Cartes numérotées = valeur faciale (1–9). Passe / Inverse / +2 / Échange = 20 pts. Joker / +4 / Rotation = 50 pts.',
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
}
