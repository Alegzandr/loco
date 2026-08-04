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
import type { Lang } from "../seo/meta";

type Copy = Record<Lang, string>;

export const UI: Record<string, Copy> = {
    /** The primary action on every content page: go and play. */
    play: { en: "Play", fr: "Jouer" },
    /** Skip link, first thing a keyboard or screen reader meets. */
    skipToContent: { en: "Skip to content", fr: "Aller au contenu" },
    homeLabel: { en: "LOCO, home", fr: "LOCO, accueil" },
    navLabel: { en: "Pages", fr: "Pages" },
    /**
     * The accessible name of the chip row a page ends on. The chips say where
     * they go; this says what the row is, which is the part a landmark needs.
     */
    readNext: { en: "Read next", fr: "À lire ensuite" },
    /** The burger's accessible name. It is an icon, so this is all it says. */
    menuLabel: { en: "Menu", fr: "Menu" },
    /** The drawer's own way out, for a reader who has no Escape key. */
    menuClose: { en: "Close", fr: "Fermer" },
    /**
     * The game drawer's one action, and the only string here the app also owns:
     * it must read exactly as `Translations.prefsBtn`, because the row opens the
     * panel that carries that title. A drawer offering "Settings" onto a modal
     * headed "Preferences" is two features as far as a player is concerned.
     */
    prefs: { en: "Preferences", fr: "Préférences" },
    /** Names a language in that language, which is the only way to label one. */
    langName: { en: "English", fr: "Français" },
    /** The globe's accessible name; the button itself shows the current language. */
    langLabel: { en: "Language", fr: "Langue" },
    langTitle: { en: "Read this in", fr: "Lire cette page en" },
    /** The panel's own way out, for a reader who never presses Escape. */
    langClose: { en: "Close", fr: "Fermer" },
    /** The switch's accessible name; the icon says which way it is set. */
    themeLabel: { en: "Dark mode", fr: "Mode sombre" },
    /** Appears once the reader is a screenful down. Icon only, so this is its name. */
    toTop: { en: "Back to top", fr: "Revenir en haut" },

    // ── The rules page ──────────────────────────────────────────────────────
    rulesH1: { en: "How to play LOCO", fr: "Comment jouer à LOCO" },
    rulesLede: {
        en: "Everything the game does, in the order you meet it. Written to be read once, standing up, in the middle of a round.",
        fr: "Tout ce que fait le jeu, dans l’ordre où tu le rencontres. Écrit pour être lu une fois, debout, au milieu d’une manche.",
    },
    /**
     * The contrast block, first thing on the rules page. It names the other game
     * by describing it, which is the only way this copy is ever allowed to refer
     * to it.
     */
    contrastH2: {
        en: "If you have played a game of colours and symbols",
        fr: "Si tu as déjà joué à un jeu de couleurs et de symboles",
    },
    deckH2: { en: "The 112 cards", fr: "Les 112 cartes" },
    deckLede: {
        en: "Every kind in the deck, how many of it there are, and what it costs you to still be holding it when somebody else goes out.",
        fr: "Chaque type de carte, en combien d’exemplaires, et ce qu’elle te coûte si tu l’as encore en main quand quelqu’un se débarrasse de la sienne.",
    },
    colCard: { en: "Card", fr: "Carte" },
    colCopies: { en: "Copies", fr: "Exemplaires" },
    colPoints: { en: "Points", fr: "Points" },
    colDetail: { en: "How they break down", fr: "Répartition" },
    faceValue: { en: "face value", fr: "sa valeur" },
    deckTotal: { en: "Total", fr: "Total" },
    rulesOutro: {
        en: "That is the whole game. A table takes ten seconds and asks for nothing but a name.",
        fr: "C’est tout le jeu. Ouvrir une table prend dix secondes et ne demande qu’un pseudo.",
    },

    // ── The cards page ──────────────────────────────────────────────────────
    cardsH1: { en: "Every card in the deck", fr: "Toutes les cartes du jeu" },
    cardsLede: {
        en: "Drawn exactly as they are dealt: these are the same cards the game renders, not pictures of them. What each one does, how many there are, and what it costs you to still be holding it.",
        fr: "Dessinées exactement comme elles sont distribuées : ce sont les cartes du jeu, pas des images de celles-ci. Ce que fait chacune, en combien d’exemplaires, et ce qu’elle te coûte si tu l’as encore en main.",
    },
    cardsNumbersH2: { en: "The numbers", fr: "Les numéros" },
    cardsActionsH2: {
        en: "The cards that do something",
        fr: "Les cartes qui font quelque chose",
    },
    cardsWildsH2: {
        en: "The three that ignore colour",
        fr: "Les trois qui ignorent la couleur",
    },
    cardsCopies: { en: "In the deck", fr: "Dans le jeu" },
    cardsWorth: { en: "Worth", fr: "Vaut" },
    cardsPoints: { en: "points", fr: "points" },
    cardsOutro: {
        en: "The rules page says how they go down, and when somebody can cut in on top of them.",
        fr: "La page des règles dit comment elles se posent, et quand quelqu’un peut intercepter par-dessus.",
    },

    // ── The tables page ─────────────────────────────────────────────────────
    /*
     * One word per thing. A **table** is the group of seats a code is shared for;
     * a **room** (fr: *décor*) is one of the four places a match is dealt in.
     * Three words used to name two objects here — table, pièce, salle — and the
     * menu made it worse by sending "Tables" to a page about the four places.
     * The URL and the <title> keep the old word: they carry the search value.
     */
    tablesH1: { en: "The four rooms", fr: "Les quatre décors" },
    tablesLede: {
        en: "A match is dealt in a room, and the room is picked for you. Everyone at one table plays in the same one, so a clip of a game is a clip of a place.",
        fr: "Une partie se joue dans un décor, et le décor t’est attribué. Tout le monde à une même table y joue, donc un extrait de partie est un extrait d’un lieu.",
    },
    tablesOutro: {
        en: "The room changes how the felt is painted and nothing else: the seats, the pile and the reach of a card are the same at every table.",
        fr: "Le décor change la façon dont le tapis est peint, et rien d’autre : les places, la pile et la portée d’une carte sont identiques à toutes les tables.",
    },

    // ── Playing with friends ────────────────────────────────────────────────
    friendsH1: { en: "Playing with friends", fr: "Jouer entre amis" },
    friendsLede: {
        en: "Three steps, no account, and nothing to install on either side. From a cold open to a dealt hand is about ten seconds.",
        fr: "Trois étapes, aucun compte, et rien à installer d’un côté ni de l’autre. D’un départ à froid à une main distribuée, il faut une dizaine de secondes.",
    },
    friendsStep1: { en: "Open a table", fr: "Ouvre une table" },
    friendsStep1Body: {
        en: "Pick a nickname and open a table. You get a short code, you are already sitting at it, and the table is yours: you decide how long the match runs and how many seats it has, up to ten.",
        fr: "Choisis un pseudo et ouvre une table. Tu reçois un code court, tu y es déjà assis, et la table est à toi : c’est toi qui décides de la longueur du match et du nombre de places, jusqu’à dix.",
    },
    friendsStep2: { en: "Send the link", fr: "Envoie le lien" },
    friendsStep2Body: {
        en: "Press the code and the link to your table lands in your clipboard. Paste it wherever you already talk to them: a tap opens the game already pointed at the table, with no invitation to accept and nothing to sign up to. The code stays on screen, because that is the version you read out loud.",
        fr: "Appuie sur le code et le lien vers ta table arrive dans ton presse-papier. Colle-le là où vous vous parlez déjà : il leur suffit de l’ouvrir pour arriver directement à la table, sans invitation à accepter ni inscription. Le code, lui, reste affiché : c’est la version qui se lit à voix haute.",
    },
    friendsStep3: { en: "They sit down", fr: "Ils prennent place" },
    friendsStep3Body: {
        en: "The link seats them straight away when their browser already knows the name they play under, and otherwise hands them the form with the code filled in and a nickname as the only thing left to type. Deal when everybody is there, or fill the empty seats with bots rather than wait.",
        fr: "Le lien les assoit directement quand leur navigateur connaît déjà le pseudo sous lequel ils jouent, sinon il leur donne le formulaire avec le code déjà rempli et le pseudo comme seule chose à saisir. Tu distribues quand tout le monde est là, ou tu complètes les places libres avec des bots plutôt que d’attendre.",
    },
    friendsHostH2: {
        en: "While the table is open",
        fr: "Tant que la table est ouverte",
    },
    friendsHostBody: {
        en: "The seats are yours to hold: one press takes somebody off the roster before the deal, and the code still works afterwards, so a mistake costs them a click and nothing else.",
        fr: "Les places sont à toi : une pression retire quelqu’un de la liste avant la distribution, et le code fonctionne toujours ensuite, donc une erreur ne leur coûte qu’un clic.",
    },
    friendsRematchBody: {
        en: "When the match ends, every seat is asked whether to go again. Nobody starts one on their own: the table deals a new match once everybody still there has said yes, on the same code.",
        fr: "Quand le match se termine, on demande à chaque place si elle remet ça. Personne n’en lance un tout seul : la table distribue un nouveau match une fois que tous ceux qui restent ont dit oui, sur le même code.",
    },
    friendsMoreH2: {
        en: "A few things worth knowing",
        fr: "Quelques points utiles",
    },
    friendsOutro: {
        en: "None of it outlives the table itself: when the last of you leaves, it is gone, along with everything it knew about the match.",
        fr: "Rien de tout cela ne survit à la table : quand le dernier d’entre vous s’en va, elle disparaît, avec tout ce qu’elle savait de la partie.",
    },

    // ── FAQ ─────────────────────────────────────────────────────────────────
    faqH1: { en: "Questions people ask", fr: "Les questions qu’on nous pose" },
    faqLede: {
        en: "What it costs, what it needs, and what happens when something goes wrong mid-match.",
        fr: "Ce que ça coûte, ce que ça demande, et ce qui se passe quand quelque chose lâche en pleine partie.",
    },
    faqOutro: {
        en: "Anything the rules themselves cover is on the rules page instead.",
        fr: "Tout ce qui relève des règles elles-mêmes est sur la page des règles.",
    },

    // ── Privacy, terms and credits ─────────────────────────────────────────
    /** The footer link, on the content pages and under the game. */
    legalNav: { en: "Privacy & terms", fr: "Confidentialité et conditions" },
    legalH1: { en: "Privacy & terms", fr: "Confidentialité et conditions" },
    legalLede: {
        en: "Three short documents: what the game knows about you, what you agree to by playing, and who made what. Written to be finished, not to be scrolled past.",
        fr: "Trois documents courts : ce que le jeu sait de toi, ce que tu acceptes en jouant, et qui a fait quoi. Écrits pour être lus jusqu’au bout, pas pour être passés au défilement.",
    },
    /** The jump list's landmark label. Says what it does; the <h1> already says
      what the page is. */
    legalJump: { en: "Jump to a document", fr: "Aller à un document" },

    // ── The block under the game on the home page ──────────────────────────
    /**
     * The home page's <h1>, in the served HTML and off the screen (`.sr-only`
     * in tokens.css). `/` is a game: what stands where a heading would is the
     * wordmark, which is a drawing, and the app's own heading does not exist
     * until the bundle has mounted. A crawler reads neither. So the document states
     * once, in text, what the page is — and it says it the way somebody would
     * search for it rather than the way the logo says it.
     */
    homeH1: {
        en: "LOCO, a fast multiplayer card game you play in your browser",
        fr: "LOCO, le jeu de cartes multijoueur rapide dans le navigateur",
    },
    homeAboutH2: { en: "What LOCO is", fr: "LOCO, en deux mots" },
    homeAbout: {
        en: "A fast card game for 2 to 10 players, in the browser, free and with no signup. You match a card by colour or by number, and the round ends the second somebody empties their hand.",
        fr: "Un jeu de cartes rapide pour 2 à 10 joueurs, dans le navigateur, gratuit et sans inscription. Tu poses une carte de la même couleur ou du même chiffre, et la manche s’arrête à la seconde où quelqu’un vide sa main.",
    },
    homeDiffH2: { en: "What makes it different", fr: "Ce qui le distingue" },
    /*
     * Three mechanics, and only mechanics. The visitor arrives holding a model of
     * a card game of colours and symbols and is looking for the delta; two of
     * these three used to spend that attention on things that game also does, and
     * one of them on there being no signup — which is already `homeAbout`'s
     * second sentence, and is not a reason to play rather than a reason to stay.
     */
    homeDiff1: {
        en: "Nobody waits their turn. Hold the card sitting on the pile and you can slam it down out of turn — the window has no deadline, and nobody is shut out of it, not even the player who just played.",
        fr: "Personne n’attend son tour. Si tu as la carte posée sur la pile, tu peux l’abattre hors de ton tour : la fenêtre n’a aucun délai, et personne n’en est exclu, pas même celui qui vient de jouer.",
    },
    homeDiff2: {
        en: "Doubles go down together. Two identical cards, three, four — one tap, and the effects stack: three +2s make the next player draw six.",
        fr: "Les doublons partent ensemble. Deux cartes identiques, trois, quatre — un seul geste, et les effets se cumulent : trois +2 font piocher six cartes.",
    },
    homeDiff3: {
        en: "Swap and Global Switch move whole hands. One takes somebody’s entire hand off them; the other slides every hand at the table one seat along.",
        fr: "Échange et Rotation déplacent des mains entières. L’une te donne toute la main de quelqu’un, l’autre fait glisser chaque main d’une place autour de la table.",
    },
    homeMoreH2: { en: "Read more", fr: "En savoir plus" },
    /**
     * Opens the sheet the prose lives in, and heads it. The home page never
     * scrolls, so this line is the whole invitation — it asks the question the
     * visitor already has rather than offering them a section.
     */
    homeSheetBtn: { en: "What is LOCO?", fr: "C’est quoi LOCO ?" },
    homeSheetClose: { en: "Close", fr: "Fermer" },
};

/** `UI.play.en` and friends, read once per page. */
export function ui(key: keyof typeof UI, lang: Lang): string {
    return UI[key][lang];
}
