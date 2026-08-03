import type { Translations } from './en'

/**
 * French copy. Two conventions the whole file obeys:
 *
 * - **Tutoiement.** The game speaks to a player sitting at a table with their
 *   friends, not to a user of a service. `vous` put a counter between the two.
 * - **The table, not the room.** `salle` / `salon` are venue-booking words;
 *   everything a player joins, shares or leaves here is a *table*.
 */
export const fr: Translations = {
  // ─── Lobby ───────────────────────────────────────────────────
  tagline: 'Des cartes à toute vitesse. Personne n\'attend son tour.',
  createRoom: 'Nouvelle table',
  joinRoom: 'Rejoindre une table',
  createGame: 'Ouvrir la table',
  joinGame: 'Prendre place',
  yourNickname: 'Ton pseudo',
  roomCodeLabel: 'Code de la table',
  back: 'Retour',
  // Le bouton est une pastille point d'interrogation dans une rangée d'icônes,
  // en jeu comme au lobby : ce texte n'est jamais dessiné, il sert d'aria-label
  // et d'infobulle. C'est la modale qu'il ouvre qui a le droit d'être une phrase.
  rulesBtn: 'Règles',

  // ─── Préférences ──────────────────────────────────────────────
  prefsBtn: 'Préférences',
  prefsTitle: 'Préférences',
  prefsClose: 'Fermer',
  prefsLanguage: 'Langue',
  // Le verbe qui va se produire. Choisir dans la liste ne change rien tout
  // seul, et à l'écran d'entrée cette pression quitte la page.
  prefsApply: 'Appliquer',
  prefsLanguageHint: 'La page se recharge pour que tout change avec elle.',
  prefsTheme: 'Thème',
  prefsThemeLight: 'Clair',
  prefsThemeDark: 'Sombre',
  prefsStreamer: 'Mode streamer',
  prefsColorAssist: 'Formes des couleurs',
  // On nomme ce qui apparaît, pas une condition : personne ne devrait avoir à
  // se diagnostiquer pour trouver le réglage qui rend le jeu jouable.
  prefsColorAssistHint: 'Donne une forme à chaque couleur, pour que la teinte ne soit jamais seule à distinguer deux cartes.',
  prefsMotion: 'Animations réduites',
  // On nomme ce qui disparaît, pour que l'interrupteur ne soit pas un pari.
  // Suit le réglage système tant qu'on n'y touche pas.
  prefsMotionHint: 'Coupe les vols de cartes et les confettis. Suit ton système tant que tu n’y touches pas.',
  // On dit ce que ça fait au code, pas comment le mode s'appelle : un joueur
  // qui doit deviner l'effet laissera l'option éteinte.
  prefsStreamerHint: 'Floute le code de la table à l’écran. Survole-le pour le lire toi-même.',
  prefsCodeHidden: 'Masqué. Survole pour le lire.',

  // ─── Matchmaking 1v1 ──────────────────────────────────────────
  findMatch: 'Jouer en 1v1',
  findMatchHint: 'On te trouve quelqu’un',
  findMatchGo: 'Trouver un adversaire',
  searchTitle: 'Recherche d’un adversaire',
  searchFresh: 'Reste là, ça prend souvent quelques secondes.',
  searchPatient: 'Toujours en recherche. Personne ne s’est encore assis en face.',
  searchLong: 'Ça peut durer. Reste ici et tu prends le prochain qui arrive, ou ouvre une table et amène quelqu’un.',
  searchElapsed: 'Attente',
  searchCancel: 'Arrêter la recherche',
  searchCreateTable: 'Ouvrir une table à la place',
  matchFoundKicker: 'Adversaire trouvé',
  matchFoundTab: 'Adversaire trouvé, reviens !',
  matchFoundYou: 'Toi',
  matchFoundStartingIn: 'Distribution dans %n…',
  matchFoundDealing: 'Distribution…',
  opponentAway: 'a perdu la connexion',
  opponentAwayHint: 'Sans retour, le match est à toi.',
  serverUpdatingBanner: 'Nouvelle version en route. Cette partie va au bout.',
  forfeitWon: 'Adversaire parti',
  forfeitWonSub: 'La place en face est vide. Le match est à toi.',
  forfeitYouLeft: 'Tu as quitté',
  forfeitYouLeftSub: 'Le match revient à ton adversaire.',
  findAnotherOpponent: 'Chercher un autre adversaire',
  rematchWaitingOpponent: 'On attend sa réponse…',
  rematchWaitingTable: 'On attend la table…',
  rematchAccept: 'Il en veut une autre. Go.',
  rematchProgress: (done, total) => `${done}/${total}`,

  // ─── Waiting Room ─────────────────────────────────────────────
  waitingRoom: 'La table',
  roomCode: 'Code de la table',
  // La page dit déjà « La table » et « Code de la table » : une troisième
  // occurrence dans la même colonne se lit comme un gabarit mal rempli.
  shareCode: 'Touche le code pour copier un lien direct vers cette table.',
  leaveConfirm: 'Tu quittes la table\u00a0?',
  leaveConfirmYes: 'Oui, je pars',
  leaveConfirmStay: 'Rester',
  copyLink: 'Copier le lien vers cette table',
  copyCode: 'Lien copié\u00a0!',
  // ─── Audio ────────────────────────────────────────────────────────
  audioTitle: 'Son',
  audioClose: 'Fermer',
  audioMaster: 'Général',
  audioSfx: 'Effets',
  audioMusic: 'Musique',
  audioTrack: 'En écoute',
  audioNextTrack: 'Morceau suivant',
  audioMute: 'Couper le son',
  audioUnmute: 'Rétablir le son',

  // ─── Interrupt ────────────────────────────────────────────────────
  interruptTitle: 'INTERCEPTION\u00a0!',
  interruptBy: '%actor rafle la main',
  interruptByYou: 'Tu rafles la main',
  interruptCombo: '×%n',
  fxSkip: 'PASSE\u00a0!',
  fxReverse: 'DEMI-TOUR\u00a0!',
  fxColors: { red: 'ROUGE\u00a0!', yellow: 'JAUNE\u00a0!', green: 'VERT\u00a0!', blue: 'BLEU\u00a0!' },
  directionCw: 'Sens du jeu\u00a0: horaire',
  directionCcw: 'Sens du jeu\u00a0: antihoraire',
  drawPile: 'Pioche',
  hostBadge: 'Hôte',
  kickPlayer: 'Retirer de la table',
  matchFormat: 'Longueur du match',
  maxPlayersLabel: 'Places',
  addBot: '+ Ajouter un bot',
  startGame: 'Distribuer',
  waitingForPlayers: 'En attente de joueurs…',
  waitingForHost: 'On attend que l\'hôte distribue…',

  // ─── Format labels ────────────────────────────────────────────
  bestOf1: 'Manche unique',
  bestOf3: 'Meilleur des 3',
  bestOf5: 'Meilleur des 5',
  bestOf7: 'Meilleur des 7',

  // ─── Game View ────────────────────────────────────────────────
  draw: 'Piocher',
  pass: 'Passer',
  unoBtn: 'LOCO\u00a0!',
  unoBanner: 'LOCO\u00a0!',
  catchBtn: 'Contre-LOCO\u00a0!',
  chooseColor: 'Annonce la couleur',
  pickerCancel: 'Repose la carte',
  choosePlayer: 'Tu veux la main de qui\u00a0?',
  swapTargetCards: '%n cartes',
  swapTargetCardOne: '1 carte',
  catchWindow: 'Attrape-le\u00a0!',
  catchFailedYou: 'Trop tard. +1 carte',
  catchFailedOther: '%player a crié trop tard\u00a0: +1 carte',
  catchBannerTitle: 'CONTRE-LOCO\u00a0!',
  catchBannerYou: 'Tu n\'as pas annoncé LOCO\u00a0!',
  catchBannerOther: '%player n\'a pas annoncé LOCO\u00a0!',
  catchBannerPenalty: '+%n cartes',
  swapNotice: '%actor a pris la main de %target',
  swapNoticeYouTarget: '%actor t\'a pris ta main',
  swapNoticeYouActor: 'Tu as pris la main de %target',
  globalSwitchNoticeCw: '%actor lance la Rotation. Toutes les mains bougent →',
  globalSwitchNoticeCcw: '%actor lance la Rotation. Toutes les mains bougent ←',
  reconnected: 'De retour',
  rebuildingTable: 'On remet la table en place…',
  reconnectingGame: 'Récupération de ta place…',
  reconnectingRoom: 'Retour à la table…',
  reconnectingHint: 'Ta main et ton score sont gardés une minute. Rien n\'est perdu.',
  reconnectingHintRoom: 'Aucune carte n\'est encore sortie. Rien à perdre.',
  reconnectCancel: 'Retour au menu',
  wsLostConnection: 'Connexion perdue',
  wsReconnecting: 'Reconnexion…',
  mapLoadingTitle: 'Ce soir, direction',
  mapLoadingWaiting: 'On dresse la table…',
  mapLoadingReady: 'Tu es en place. On attend les autres…',
  // "1 sur 3 en place" plutôt que "prêt(s)" : la formule vaut au singulier
  // comme au pluriel sans parenthèses à lire au milieu d'un chargement.
  mapLoadingCount: '%ready sur %total en place',
  maps: {
    neon: {
      name: 'Neon',
      tagline: 'Un club sur les toits, face aux gratte-ciels. Marbre noir et cercle de lumière.',
    },
    rune: {
      name: 'Rune',
      tagline: 'L’arrière-salle d’une taverne arcanique. Chêne sculpté, gemmes, chandelles.',
    },
    velvet: {
      name: 'Velvet',
      tagline: 'Un salon art déco. Laiton, feutre bordeaux et lampes en veilleuse.',
    },
    orbit: {
      name: 'Orbit',
      tagline: 'Un hangar de vaisseau en orbite haute. Alliage brossé sur table holographique.',
    },
  },
  round: 'Manche',
  of: 'sur',
  complete: 'pliée',
  winsRound: 'rafle la manche\u00a0!',
  player: 'Joueur',
  // Colonnes de 40px dans RoundSummary : « Position » et « Victoires »
  // débordaient sur leurs voisines dès 320px de large. Le rang se lit déjà dans
  // ses cellules (« 1er », « 2e ») : le dièse de classement suffit.
  placementLabel: '#',
  ptsLabel: '+pts',
  totalLabel: 'Total',
  winsLabel: 'Vict.',
  matchScoreboard: 'Où en est le match',
  continueBtn: 'Manche suivante',
  spectating: 'Main vide. Profite du spectacle…',

  // ─── Tableau des scores en jeu (TAB maintenu) ─────────────────
  scoreTableTitle: 'Scores',
  scoreTableHint: 'Maintiens TAB',
  scoreTableBtn: 'Scores',
  scoreTableClose: 'Fermer',
  scoreTableRoundCol: 'M%n',
  scoreTablePingCol: 'Ping',
  scoreTableYou: 'toi',
  scoreTableBot: 'BOT',
  scoreTableNoPing: '--',
  scoreTableEmptyRounds: 'Rien n\'est encore joué',

  // ─── PixiGame in-canvas strings ───────────────────────────────
  yourTurn: 'À toi',
  drawOrCounter: 'Pioche %n ou riposte\u00a0!',
  drawPenalty: 'Pioche %n',
  playerTurnSuffix: ' joue',
  ord1: '1er',
  ord2: '2e',
  ord3: '3e',
  ordN: 'e',

  // ─── Game Over ────────────────────────────────────────────────
  matchWon: 'LE MATCH EST À TOI\u00a0!',
  gameOver: 'Le match est plié',
  youWin: 'TU GAGNES\u00a0!',
  playAgain: 'Rejouer',
  finalScores: 'Classement final',
  winsGame: 'l\'emporte\u00a0!',
  winsMatch: 'rafle le match\u00a0!',
  rematch: 'Revanche',
  leaveRoom: 'Quitter la table',

  // ─── Language ────────────────────────────────────────────────
  language: 'Langue',

  // ─── Rules ───────────────────────────────────────────────────
  // Les noms que les phrases de `rules` emploient déjà, extraits pour qu'un
  // tableau ou un titre puisse nommer une carte sans les réécrire.
  cardNames: {
    number: 'Numéro',
    skip: 'Passe',
    reverse: 'Changement de sens',
    draw_two: '+2',
    wild: 'Changement de couleur',
    wild_draw_four: '+4',
    swap: 'Échange',
    global_switch: 'Rotation',
  },

  rulesTitle: 'Comment jouer',
  rulesClose: 'Fermer',

  rules: [
    {
      heading: 'La table',
      items: [
        'De 2 à 10 joueurs. C\'est entre 2 et 6 que ça respire le mieux.',
        'Huit cartes chacun, redistribuées à chaque manche.',
        'La pile s\'ouvre toujours sur une carte numérotée\u00a0: personne ne se prend un +4 avant d\'avoir joué.',
        'La manche 1 démarre sur une place tirée au sort. Ensuite, c\'est le dernier au score qui ouvre.',
      ],
    },
    {
      heading: 'À toi de jouer',
      items: [
        'Pose une carte de la même couleur ou de la même valeur, sors un Changement de couleur, ou prends une carte à la pioche.',
        'La carte que tu viens de piocher peut repartir aussitôt si elle passe. Sinon, tu passes.',
        'Une seule pioche par tour. Pas deux.',
      ],
    },
    {
      heading: 'Les doublons partent ensemble',
      items: [
        'Tu as deux fois exactement la même carte\u00a0? Envoie les deux. Trois, quatre, toutes, d\'un seul geste.',
        'Les effets s\'additionnent\u00a0: trois +2 font piocher six cartes, deux Passe grillent deux joueurs.',
      ],
    },
    {
      heading: 'Les cartes qui font mal',
      items: [
        'Passe\u00a0: le joueur suivant saute son tour.',
        'Changement de sens\u00a0: le jeu repart dans l\'autre sens. En duel, ça revient à un Passe.',
        '+2\u00a0: le suivant pioche deux cartes, sauf s\'il répond par un +2. Piocher ne lui coûte pas son tour\u00a0: il pioche, puis joue ou passe.',
        'Changement de couleur\u00a0: se pose sur n\'importe quoi. C\'est toi qui annonces la nouvelle couleur.',
        '+4\u00a0: celle qui mord. Tu annonces la couleur, et le suivant pioche quatre cartes s\'il ne cumule pas.',
        'Échange (⇋)\u00a0: carte colorée, jouée à ton tour. Tu désignes quelqu\'un et tu prends toute sa main. Oui, toute.',
        'Rotation (↻)\u00a0: tu annonces la couleur, puis chaque main glisse d\'une place dans le sens du jeu. Personne ne garde rien.',
      ],
    },
    {
      heading: 'Interceptable à tout moment',
      items: [
        'Une carte est posée sur la pile. Tu as exactement la même, couleur et valeur\u00a0? Claque-la, même si ce n\'est pas ton tour.',
        'Aucun délai\u00a0: la fenêtre reste ouverte jusqu\'à ce que quelqu\'un joue, pioche ou passe.',
        'Personne n\'est écarté\u00a0: celui qui vient de jouer peut reprendre la main dans la foulée, et celui dont c\'était le tour aussi.',
        'Plusieurs copies partent d\'un seul geste, effets compris.',
        'Toutes les cartes interceptent, Changement de couleur et Rotation compris\u00a0: un Changement de couleur se pose sur un Changement de couleur, un +4 prolonge un +4. Seule règle\u00a0: être identique.',
      ],
    },
    {
      heading: 'Photo finish',
      items: [
        'Deux joueurs claquent au même instant\u00a0? Le serveur tranche, et c\'est la première carte reçue qui prend la main.',
        'Sa montre est la seule qui compte. Inutile de plaider.',
      ],
    },
    {
      heading: 'Dernière carte\u00a0: annonce-la',
      items: [
        'Quand il ne te reste qu\'une carte, tape LOCO\u00a0! Tout de suite.',
        'Recevoir sa dernière carte compte aussi\u00a0: après un Échange ou une Rotation, tous ceux qui sont à une carte doivent l\'annoncer.',
        'Si tu restes muet, chaque adversaire a cinq secondes pour tenter un Contre-LOCO\u00a0! Tu piocheras deux cartes.',
        'Le Contre-LOCO est un pari, pas un coup gratuit\u00a0: lancé après l\'annonce, il coûte une carte à celui qui le crie.',
      ],
    },
    {
      heading: 'Le chrono',
      items: [
        'Chaque tour est chronométré. S\'il tombe à zéro, le serveur pioche et passe à ta place.',
        'Quatre tours d\'affilée comme ça, soit environ deux manches, et ta place est libérée.',
      ],
    },
    {
      heading: 'Les points',
      items: [
        'La manche s\'arrête à la seconde où quelqu\'un vide sa main.',
        'Il empoche la valeur de toutes les cartes restées dans les mains des autres. Les autres marquent zéro.',
        'Les numéros valent leur chiffre. Changement de sens 10. Passe 20. +2 et Échange 30. Changement de couleur et Rotation 40. Le +4 vaut 50, et ça se sent.',
      ],
    },
    {
      heading: 'Remporter le match',
      items: [
        'La longueur du match se choisit avant de distribuer\u00a0: manche unique, ou meilleur des 3, 5 ou 7.',
        'Le plus gros total quand la dernière manche tombe rafle tout.',
        'Égalité\u00a0? Le plus de manches gagnées, puis le plus petit total de cartes perdantes, puis une manche décisive.',
      ],
    },
  ] as const,

  // ─── Actions refusées ────────────────────────────────────────
  errors: {
    generic: 'Ça n\'est pas passé.',

    nicknameTaken: 'Quelqu\'un porte déjà ce nom à cette table.',
    nicknameRejected: 'Choisis un autre pseudo.',
    roomNotFound: 'Aucune table avec ce code.',
    roomFull: 'Cette table est complète.',
    gameInProgress: 'Les cartes sont déjà sorties à cette table.',
    sessionInvalid: 'Ta place n\'a pas pu être récupérée. Rejoins la table.',
    notInRoom: 'Tu as quitté la table.',
    alreadyInRoom: 'Tu es déjà à une table. Quitte-la d\'abord.',

    notYourTurn: 'Attends ton tour.',
    mustAnswerPenalty: 'Riposte, ou prends les cartes.',
    alreadyDrew: 'Une seule pioche par tour.',
    mustDrawFirst: 'Pioche avant de passer.',
    needColor: 'Annonce d\'abord une couleur.',
    cardNotInHand: 'Cette carte n\'est pas dans ta main.',
    illegalCard: 'Celle-là ne correspond pas.',

    counterMismatch: 'Seule la carte identique se cumule.',
    noPendingDraw: 'Il n\'y a rien à riposter.',

    interruptClosed: 'Quelqu\'un a été plus rapide.',
    interruptDrawChain: 'Seule une carte de pioche identique s\'intercale ici.',
    interruptMismatch: 'Il faut une carte identique à celle du dessus.',
    batchNotAllowed: 'Échange et Rotation se jouent une par une.',
    batchMismatch: 'Les cartes jouées ensemble doivent être identiques.',

    declareTooEarly: 'On annonce LOCO sur sa dernière carte, pas avant.',
    alreadyDeclared: 'Déjà annoncé.',
    catchExpired: 'La fenêtre s\'est refermée.',
    catchTargetSafe: 'Rien à attraper ici.',

    swapSelf: 'Choisis quelqu\'un d\'autre.',
    swapTargetInvalid: 'Cette place ne peut pas être ciblée.',

    hostOnly: 'Ça, c\'est à l\'hôte de décider.',
    kicked: 'L\'hôte a libéré ta place.',
    notEnoughPlayers: 'Pas assez de joueurs pour distribuer.',
    lobbyOnly: 'Trop tard, les cartes sont sorties.',
    maxPlayersInvalid: 'Ce nombre de places n\'est pas autorisé.',
    rematchTooEarly: 'Le match n\'est pas encore terminé.',
    alreadySearching: 'Tu cherches déjà une partie.',
    matchmadeUnavailable: 'Pas en 1v1.',
    cannotLeaveMatch: 'Les cartes sont en jeu. Va au bout.',
    opponentGone: 'La place en face est vide.',
    afkForfeit: 'Trop longtemps sans jouer. Le match va à ton adversaire.',
    afkKicked: 'Trop longtemps sans jouer.',

    rateLimited: 'Doucement sur les doigts.',
    serverBusy: 'Le serveur est bondé. Réessaie.',
    serverUpdating: 'Nouvelle version en route. Les tables rouvrent dans une minute.',
    reconnectFailed: 'Ta place est perdue. Le match est peut-être terminé.',
    serverFull: 'Toutes les tables sont prises. Réessaie dans une minute.',
    tooManyAttempts: 'Trop d\'essais. Attends un instant.',
    serverError: 'Ça a cassé de notre côté. Retente le coup.',
    gameNotInProgress: 'Aucune carte n\'est en jeu à cette table.',
  },
}
