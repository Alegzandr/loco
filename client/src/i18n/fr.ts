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
  catchBtn: 'Catch !',
  chooseColor: 'Choisissez une couleur',
  catchWindow: 'Fenêtre de catch !',
  reconnected: 'Reconnecté',
  rebuildingTable: 'Reconstruction de la table…',
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

  // ─── Game Over ────────────────────────────────────────────────
  matchWon: 'Match gagné !',
  gameOver: 'Partie terminée',
  youWin: 'Vous avez gagné !',
  playAgain: 'Rejouer',
  finalScores: 'Scores finaux',

  // ─── Language ────────────────────────────────────────────────
  language: 'Langue',

  // ─── Rules ───────────────────────────────────────────────────
  rulesTitle: 'Règles du jeu',
  rulesClose: 'Fermer',

  rules: [
    {
      heading: 'Joueurs et mise en place',
      items: [
        'De 2 à 10 joueurs par partie.',
        'Chaque joueur reçoit 8 cartes au début de chaque manche.',
        'Le reste du paquet est posé face cachée ; la première carte retournée lance la pile de défausse.',
        'Un joueur est sélectionné aléatoirement pour commencer.',
      ],
    },
    {
      heading: 'À votre tour',
      items: [
        'Jouez une ou plusieurs cartes de votre main (voir règles spéciales ci-dessous).',
        'Si vous ne pouvez pas ou ne souhaitez pas jouer, piochez une carte.',
        'Après avoir pioché, vous pouvez jouer la carte immédiatement (piocher-et-jouer).',
        'Si vous ne pouvez toujours pas jouer après avoir pioché, appuyez sur Passer.',
      ],
    },
    {
      heading: 'Jouer plusieurs cartes identiques',
      items: [
        'Vous pouvez jouer plusieurs cartes de même numéro et couleur en une seule fois.',
        'Chaque carte jouée compte individuellement — ex. jouer deux +2 cumule l\'effet.',
      ],
    },
    {
      heading: 'Cartes spéciales',
      items: [
        'Passe — le joueur suivant perd son tour.',
        'Inverse — le sens de jeu est inversé.',
        '+2 — le joueur suivant doit piocher 2 cartes (et perd son tour sauf s\'il contre).',
        'Joker — peut être joué sur n\'importe quelle couleur ; vous choisissez la couleur active.',
        'Joker +4 — peut être joué sur n\'importe quelle couleur ; le suivant pioche 4 (sauf s\'il contre).',
        'Échange — échangez votre main avec n\'importe quel autre joueur.',
        'Rotation globale — tous les joueurs passent leur main entière au joueur suivant dans l\'ordre.',
      ],
    },
    {
      heading: 'Cumul des +2 / +4',
      items: [
        'Si l\'option est activée par l\'hôte, un joueur ciblé par un +2 ou +4 peut répondre avec son propre +2 ou +4.',
        'L\'accumulation continue jusqu\'à ce qu\'un joueur ne puisse ou ne veuille pas contrer ; il pioche le total.',
        'Un +2 ne peut être contré que par un +2 ; un +4 ne peut être contré que par un +4.',
        'Sans l\'option, le joueur ciblé pioche immédiatement.',
      ],
    },
    {
      heading: 'Déclaration UNO !',
      items: [
        'Quand vous jouez votre avant-dernière carte (il vous en reste exactement 1), appuyez sur UNO !',
        'Si vous oubliez et qu\'un autre joueur appuie sur Catch ! avant la fin des 5 secondes, vous piochez 2 cartes.',
        'Déclarer UNO n\'a aucun effet si vous avez plus d\'une carte.',
      ],
    },
    {
      heading: 'Counter-UNO (Catch !)',
      items: [
        'Après une déclaration UNO, n\'importe quel joueur peut appuyer sur Catch ! dans les 5 secondes.',
        'Si la déclaration était valide (1 carte), le challenger pioche 2 cartes.',
        'Si la déclaration était invalide (plus d\'1 carte), le déclarant pioche 2 cartes.',
      ],
    },
    {
      heading: 'Minuteur & AFK',
      items: [
        'Chaque joueur dispose d\'un temps limité par tour (affiché par un minuteur).',
        'Si le temps s\'écoule, une carte est piochée automatiquement.',
        'Un joueur AFK pendant 2 manches consécutives est expulsé de la salle.',
      ],
    },
    {
      heading: 'Terminer une manche',
      items: [
        'Quand vous jouez toutes vos cartes, vous terminez — vous marquez des points et devenez spectateur.',
        'Points gagnés = somme des valeurs des cartes des joueurs qui n\'ont pas encore terminé à ce moment.',
        'Le jeu continue jusqu\'à ce qu\'il ne reste qu\'un seul joueur avec des cartes ; ce joueur marque 0.',
        'Cartes numérotées = valeur faciale (0–9). Passe / Inverse / +2 = 20 pts. Joker / Joker+4 = 50 pts.',
      ],
    },
    {
      heading: 'Formats de match et score',
      items: [
        'Manche unique — une seule manche ; le plus haut score gagne.',
        'Meilleur des 3 — premier à remporter 2 manches gagne le match.',
        'Meilleur des 5 — premier à remporter 3 manches gagne le match.',
        'Meilleur des 7 — premier à remporter 4 manches gagne le match.',
        'Départage : score cumulé le plus élevé → manches gagnées → total de cartes perdantes le plus bas → manche décisive.',
      ],
    },
  ] as const,
}
