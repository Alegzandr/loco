/**
 * The handful of strings the content pages need around their own prose: the
 * header, the footer, the language link.
 *
 * Deliberately not in `src/i18n/en.ts`. That file is loaded by every player on
 * every visit and is already 28 KB; none of this is ever rendered inside the
 * game. `t.rules` and `t.cardNames` are the exception in the other direction —
 * they are the game's own copy, and the rules page reads them precisely so the
 * page and the in-game modal cannot drift apart.
 *
 * Voice, per `docs/notes/client.md`: a table, never a "room" or a "lobby";
 * tutoiement in French; a button is the verb about to happen.
 */
import type { Lang } from '../seo/meta'

type Copy = Record<Lang, string>

export const UI: Record<string, Copy> = {
  /** The primary action on every content page: go and play. */
  play: { en: 'Play', fr: 'Jouer' },
  /** Skip link, first thing a keyboard or screen reader meets. */
  skipToContent: { en: 'Skip to content', fr: 'Aller au contenu' },
  homeLabel: { en: 'LOCO, home', fr: 'LOCO, accueil' },
  navLabel: { en: 'Pages', fr: 'Pages' },
  /** The burger's accessible name. It is an icon, so this is all it says. */
  menuLabel: { en: 'Menu', fr: 'Menu' },
  /** The drawer's own way out, for a reader who has no Escape key. */
  menuClose: { en: 'Close', fr: 'Fermer' },
  /** Names a language in that language, which is the only way to label one. */
  langName: { en: 'English', fr: 'Français' },
  /** The globe's accessible name; the button itself shows the current language. */
  langLabel: { en: 'Language', fr: 'Langue' },
  langTitle: { en: 'Read this in', fr: 'Lire cette page en' },
  /** The panel's own way out, for a reader who never presses Escape. */
  langClose: { en: 'Close', fr: 'Fermer' },
  /** The switch's accessible name; the icon says which way it is set. */
  themeLabel: { en: 'Dark mode', fr: 'Mode sombre' },
  /** Appears once the reader is a screenful down. Icon only, so this is its name. */
  toTop: { en: 'Back to top', fr: 'Revenir en haut' },

  // ── The rules page ──────────────────────────────────────────────────────
  rulesH1: { en: 'How to play LOCO', fr: 'Comment jouer à LOCO' },
  rulesLede: {
    en: 'Everything the game does, in the order you meet it. Written to be read once, standing up, in the middle of a round.',
    fr: 'Tout ce que fait le jeu, dans l’ordre où tu le rencontres. Écrit pour être lu une fois, debout, au milieu d’une manche.',
  },
  deckH2: { en: 'The 112 cards', fr: 'Les 112 cartes' },
  deckLede: {
    en: 'Every kind in the deck, how many of it there are, and what it costs you to still be holding it when somebody else goes out.',
    fr: 'Chaque type de carte, en combien d’exemplaires, et ce qu’elle te coûte si tu l’as encore en main quand quelqu’un se débarrasse de la sienne.',
  },
  colCard: { en: 'Card', fr: 'Carte' },
  colCopies: { en: 'Copies', fr: 'Exemplaires' },
  colPoints: { en: 'Points', fr: 'Points' },
  colDetail: { en: 'How they break down', fr: 'Répartition' },
  faceValue: { en: 'face value', fr: 'sa valeur' },
  deckTotal: { en: 'Total', fr: 'Total' },
  rulesOutro: {
    en: 'That is the whole game. A table takes ten seconds and asks for nothing but a name.',
    fr: 'C’est tout le jeu. Ouvrir une table prend dix secondes et ne demande qu’un pseudo.',
  },

  // ── The cards page ──────────────────────────────────────────────────────
  cardsH1: { en: 'Every card in the deck', fr: 'Toutes les cartes du jeu' },
  cardsLede: {
    en: 'Drawn exactly as they are dealt: these are the same cards the game renders, not pictures of them. What each one does, how many there are, and what it costs you to still be holding it.',
    fr: 'Dessinées exactement comme elles sont distribuées : ce sont les cartes du jeu, pas des images de celles-ci. Ce que fait chacune, en combien d’exemplaires, et ce qu’elle te coûte si tu l’as encore en main.',
  },
  cardsNumbersH2: { en: 'The numbers', fr: 'Les numéros' },
  cardsActionsH2: { en: 'The cards that do something', fr: 'Les cartes qui font quelque chose' },
  cardsWildsH2: { en: 'The three that ignore colour', fr: 'Les trois qui ignorent la couleur' },
  cardsCopies: { en: 'In the deck', fr: 'Dans le jeu' },
  cardsWorth: { en: 'Worth', fr: 'Vaut' },
  cardsPoints: { en: 'points', fr: 'points' },
  cardsOutro: {
    en: 'The rules page says how they go down, and when somebody can cut in on top of them.',
    fr: 'La page des règles dit comment elles se posent, et quand quelqu’un peut intercepter par-dessus.',
  },

  // ── The tables page ─────────────────────────────────────────────────────
  tablesH1: { en: 'The four tables', fr: 'Les quatre tables' },
  tablesLede: {
    en: 'A match is dealt in a room, and the room is picked for you. Everyone at one table plays in the same one, so a clip of a game is a clip of a place.',
    fr: 'Une partie se joue dans une pièce, et la pièce t’est attribuée. Tout le monde à une même table y joue, donc un extrait de partie est un extrait d’un lieu.',
  },
  tablesOutro: {
    en: 'The room changes how the felt is painted and nothing else: the seats, the pile and the reach of a card are the same at every table.',
    fr: 'La pièce change la façon dont le tapis est peint, et rien d’autre : les places, la pile et la portée d’une carte sont identiques à toutes les tables.',
  },

  // ── Playing with friends ────────────────────────────────────────────────
  friendsH1: { en: 'Playing with friends', fr: 'Jouer entre amis' },
  friendsLede: {
    en: 'Three steps, no account, and nothing to install on either side. From a cold open to a dealt hand is about ten seconds.',
    fr: 'Trois étapes, aucun compte, et rien à installer d’un côté ni de l’autre. D’un départ à froid à une main distribuée, il faut une dizaine de secondes.',
  },
  friendsStep1: { en: 'Open a table', fr: 'Ouvre une table' },
  friendsStep1Body: {
    en: 'Pick a nickname and open a table. You get a short code, and you are already sitting at it.',
    fr: 'Choisis un pseudo et ouvre une table. Tu reçois un code court, et tu y es déjà assis.',
  },
  friendsStep2: { en: 'Send the code', fr: 'Envoie le code' },
  friendsStep2Body: {
    en: 'Paste it wherever you already talk to them. It is the only thing they need: no link to click through, no invitation to accept, nothing to sign up to.',
    fr: 'Colle-le là où vous vous parlez déjà. C’est tout ce dont ils ont besoin : aucun lien à suivre, aucune invitation à accepter, aucune inscription.',
  },
  friendsStep3: { en: 'They sit down', fr: 'Ils prennent place' },
  friendsStep3Body: {
    en: 'They enter the code, pick their own nickname, and take a seat. Deal when everybody is there.',
    fr: 'Ils saisissent le code, choisissent leur pseudo et prennent place. Tu distribues quand tout le monde est là.',
  },
  friendsMoreH2: { en: 'A few things worth knowing', fr: 'Quelques points utiles' },
  friendsOutro: {
    en: 'Nothing about a table outlives the match: close the tab and it is gone, along with everything it knew.',
    fr: 'Rien d’une table ne survit au match : ferme l’onglet et elle disparaît, avec tout ce qu’elle savait.',
  },

  // ── FAQ ─────────────────────────────────────────────────────────────────
  faqH1: { en: 'Questions people ask', fr: 'Les questions qu’on nous pose' },
  faqLede: {
    en: 'What it costs, what it needs, and what happens when something goes wrong mid-match.',
    fr: 'Ce que ça coûte, ce que ça demande, et ce qui se passe quand quelque chose lâche en pleine partie.',
  },
  faqOutro: {
    en: 'Anything the rules themselves cover is on the rules page instead.',
    fr: 'Tout ce qui relève des règles elles-mêmes est sur la page des règles.',
  },

  // ── Privacy, terms and credits ─────────────────────────────────────────
  /** The footer link, on the content pages and under the game. */
  legalNav: { en: 'Privacy & terms', fr: 'Confidentialité et conditions' },
  legalH1: { en: 'Privacy & terms', fr: 'Confidentialité et conditions' },
  legalLede: {
    en: 'Three short documents: what the game knows about you, what you agree to by playing, and who made what. Written to be finished, not to be scrolled past.',
    fr: 'Trois documents courts : ce que le jeu sait de toi, ce que tu acceptes en jouant, et qui a fait quoi. Écrits pour être lus jusqu’au bout, pas pour être passés au défilement.',
  },
  /** The jump list's landmark label. Says what it does; the <h1> already says
      what the page is. */
  legalJump: { en: 'Jump to a document', fr: 'Aller à un document' },

  // ── The block under the game on the home page ──────────────────────────
  homeAboutH2: { en: 'What LOCO is', fr: 'LOCO, en deux mots' },
  homeAbout: {
    en: 'A fast card game for 2 to 10 players, in the browser, free and with no signup. You match a card by colour or by number, and the round ends the second somebody empties their hand.',
    fr: 'Un jeu de cartes rapide pour 2 à 10 joueurs, dans le navigateur, gratuit et sans inscription. Tu poses une carte de la même couleur ou du même chiffre, et la manche s’arrête à la seconde où quelqu’un vide sa main.',
  },
  homeDiffH2: { en: 'What makes it different', fr: 'Ce qui le distingue' },
  homeDiff1: {
    en: 'Nobody waits their turn. Hold the card that is sitting on the pile and you can slam it down out of turn, any time, until somebody plays.',
    fr: 'Personne n’attend son tour. Si tu as la carte posée sur la pile, tu peux l’abattre hors de ton tour, à n’importe quel moment, jusqu’à ce que quelqu’un joue.',
  },
  homeDiff2: {
    en: 'Down to one card, you have to say so. Stay quiet and anyone has five seconds to catch you out.',
    fr: 'À une carte, tu dois l’annoncer. Reste silencieux et n’importe qui a cinq secondes pour te prendre en défaut.',
  },
  homeDiff3: {
    en: 'A name is all it asks. No account, no password, nothing kept about you between matches.',
    fr: 'Il ne demande qu’un pseudo. Pas de compte, pas de mot de passe, rien de conservé sur toi d’une partie à l’autre.',
  },
  homeMoreH2: { en: 'Read more', fr: 'En savoir plus' },
  /** Opens the sheet the prose lives in. The home page never scrolls. */
  homeSheetBtn: { en: 'More about LOCO', fr: 'En savoir plus sur LOCO' },
  homeSheetClose: { en: 'Close', fr: 'Fermer' },
}

/** `UI.play.en` and friends, read once per page. */
export function ui(key: keyof typeof UI, lang: Lang): string {
  return UI[key][lang]
}
