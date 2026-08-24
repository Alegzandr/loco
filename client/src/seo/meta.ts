/**
 * Everything the served HTML says about a page, as data rather than as markup.
 *
 * These tags are the one part of the UI nobody on the team ever looks at: they
 * render inside Discord, X and a search result, from values no screen displays.
 * Keeping them here rather than inline in the layout is what lets a test assert
 * the real values instead of running a regex over a template, and it makes
 * `PAGES` the single source the sitemap, the `hreflang` pairs and
 * `src/test/seo.test.ts` all read. A page that exists in one of those and not
 * the others is the failure this shape is meant to make impossible.
 *
 * Mostly build-time, but importable from the browser on purpose: `tableInvite`
 * lands an invitation on a home path and must not hardcode one beside this
 * registry.
 * `ORIGIN` is therefore read defensively — see below — and everything that
 * depends on it (the absolute URLs, the JSON-LD) is only ever called from an
 * .astro file, where `process` exists.
 */

export type Lang = 'en' | 'fr'

export const LANGS: readonly Lang[] = ['en', 'fr']
export const DEFAULT_LANG: Lang = 'en'

/** BCP-47 tags, for `hreflang` and `og:locale`. */
export const LOCALE: Record<Lang, string> = { en: 'en-US', fr: 'fr-FR' }
export const OG_LOCALE: Record<Lang, string> = { en: 'en_US', fr: 'fr_FR' }

/**
 * Absolute origin baked into the canonical, `hreflang` and link-preview tags.
 *
 * Discord, X and Slack resolve `og:image` against nothing (a relative path is
 * simply not fetched) and they do not run JS, so this cannot be filled in at
 * runtime. Defaults to production; `VITE_PUBLIC_ORIGIN` overrides it, which is
 * what stops an image built for the dev host from claiming to be production.
 *
 * The production default is the apex. `www.` exists as a 301 to it at the edge
 * and nowhere else, so an origin carrying the prefix would make every canonical,
 * every `hreflang` and the whole sitemap name a redirect instead of a page.
 *
 * Read through a `typeof` guard rather than directly: this module is also
 * imported by client-side code (for the page paths alone), and a bare
 * `process.env` throws "process is not defined" in a browser. In that context
 * the value is never used — only the paths are.
 */
export const ORIGIN = (
  (typeof process !== 'undefined' ? process.env?.VITE_PUBLIC_ORIGIN : undefined) ??
  'https://ohloco.com'
).replace(/\/+$/, '')

/**
 * Cache buster on the preview image. Both Discord and X cache a preview by URL
 * for days, so this is the only way to make them re-fetch after the art
 * changes: bump it whenever `make og` regenerates the PNGs.
 */
export const OG_VERSION = 3

export const SITE_NAME = 'LOCO!'

/** Absolute URL for a site-relative path, which is what every crawler needs. */
export function absolute(path: string): string {
  return `${ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * One page of the site, in every language it exists in.
 *
 * Paths always end in a slash. Astro builds directories (`/rules/index.html`),
 * nginx would happily serve that at both `/rules` and `/rules/`, and picking one
 * form here is what stops the two from competing as duplicates.
 */
export interface PageDef {
  id: string
  path: Record<Lang, string>
  title: Record<Lang, string>
  description: Record<Lang, string>
  /**
   * Short label for the site navigation. A `<title>` is written for a search
   * result and is far too long to sit in a header.
   */
  navLabel?: Record<Lang, string>
  /** Overrides the shared social title when a page deserves its own. */
  ogTitle?: Record<Lang, string>
  ogDescription?: Record<Lang, string>
  /**
   * Overrides the shared link-preview art. Only the invite page has one: a page
   * whose whole reason to exist is how it unfurls in a chat window is also the
   * only page whose picture has a different job from the site's.
   */
  ogImage?: OgImage
}

interface OgImage {
  path: Record<Lang, string>
  type: string
  width: number
  height: number
  alt: Record<Lang, string>
}

export const OG_IMAGE = {
  /** English art by default; the French card is rendered by `make og --lang=fr`. */
  path: { en: `/og.png?v=${OG_VERSION}`, fr: `/og.fr.png?v=${OG_VERSION}` } as Record<Lang, string>,
  type: 'image/png',
  width: 1200,
  height: 630,
  alt: {
    en: 'The LOCO! duck beside a fan of five cards: green 4, blue skip, wild +4, yellow +2, red 7.',
    fr: 'Le canard LOCO! à côté d’un éventail de cinq cartes : 4 vert, passe bleu, +4 joker, +2 jaune, 7 rouge.',
  } as Record<Lang, string>,
} as const

export const HOME: PageDef = {
  id: 'home',
  path: { en: '/', fr: '/fr/' },
  title: {
    en: 'LOCO! · Fast multiplayer card game, free, no signup',
    fr: 'LOCO! · Jeu de cartes multijoueur gratuit, sans inscription',
  },
  description: {
    en: 'Free online card game for 2 to 10 players, no signup. Pick a name, share a code, sit down: nobody waits their turn.',
    fr: 'Jeu de cartes en ligne gratuit, de 2 à 10 joueurs, sans inscription. Un pseudo, un code, une place : personne n’attend son tour.',
  },
  ogTitle: {
    en: 'LOCO! · The card game where nobody waits their turn',
    fr: 'LOCO! · Le jeu de cartes où personne n’attend son tour',
  },
  ogDescription: {
    en: 'Free, no signup, 2 to 10 players. Pick a name, share a code, sit down.',
    fr: 'Gratuit, sans inscription, de 2 à 10 joueurs. Un pseudo, un code, une place.',
  },
}

export const RULES: PageDef = {
  id: 'rules',
  path: { en: '/rules/', fr: '/fr/regles/' },
  navLabel: { en: 'Rules', fr: 'Règles' },
  title: {
    en: 'LOCO! rules · How to play, card by card',
    fr: 'Règles de LOCO! · Comment jouer, carte par carte',
  },
  description: {
    en: 'The full rules: the 112-card deck, what every card does, cutting in out of turn, calling LOCO!, and how a round is scored.',
    fr: 'Les règles complètes : les 112 cartes, l’effet de chacune, l’interception hors de son tour, l’annonce LOCO! et le décompte des points.',
  },
}

export const CARDS: PageDef = {
  id: 'cards',
  path: { en: '/cards/', fr: '/fr/cartes/' },
  navLabel: { en: 'Cards', fr: 'Cartes' },
  title: {
    en: 'Every LOCO! card · What each one does and what it is worth',
    fr: 'Toutes les cartes de LOCO! · Effet et valeur de chacune',
  },
  description: {
    en: 'The whole deck, drawn: 72 numbers, Skip, Reverse, +2, Swap, Global Switch, Wild and +4. What each card does and what it is worth.',
    fr: 'Tout le jeu, dessiné : 72 numéros, Passe, Sens, +2, Échange, Rotation, Joker et +4. L’effet de chaque carte et ce qu’elle coûte en fin de manche.',
  },
}

export const TABLES: PageDef = {
  id: 'tables',
  path: { en: '/tables/', fr: '/fr/tables/' },
  // The page is about the four places, not about the seats sharing a code, and
  // the label is what tells a reader which of the two they are about to open.
  // The path and the title keep "tables": they carry the search value.
  navLabel: { en: 'Rooms', fr: 'Les décors' },
  title: {
    en: 'The four LOCO! tables · Neon, Rune, Velvet, Orbit',
    fr: 'Les quatre tables de LOCO! · Neon, Rune, Velvet, Orbit',
  },
  description: {
    en: 'Every match is dealt in a room: a rooftop club, an arcane tavern, an art-deco lounge or a station in orbit. The four rooms.',
    fr: 'Chaque partie se joue dans un décor : club sur les toits, taverne arcanique, fumoir art déco ou station en orbite. Les quatre décors.',
  },
}

export const FRIENDS: PageDef = {
  id: 'friends',
  path: { en: '/play-with-friends/', fr: '/fr/jouer-entre-amis/' },
  navLabel: { en: 'With friends', fr: 'Entre amis' },
  title: {
    en: 'Play cards online with friends · Free, no signup',
    fr: 'Jouer aux cartes entre amis · Gratuit, sans inscription',
  },
  description: {
    en: 'Open a table, send the code, play. Two to ten friends in the same game in ten seconds, in any browser, with nothing to install.',
    fr: 'Ouvre une table, envoie le code, jouez. De 2 à 10 amis dans la même partie en dix secondes, dans le navigateur, sans rien installer.',
  },
}

export const FAQ_PAGE: PageDef = {
  id: 'faq',
  path: { en: '/faq/', fr: '/fr/faq/' },
  navLabel: { en: 'FAQ', fr: 'FAQ' },
  title: {
    en: 'LOCO! FAQ · Free, no account, 2 to 10 players',
    fr: 'FAQ LOCO! · Gratuit, sans compte, de 2 à 10 joueurs',
  },
  description: {
    en: 'Is it free, does it need an account, how many can play, does it work on a phone, and what happens to your seat if you drop.',
    fr: 'Est-ce gratuit, faut-il un compte, à combien joue-t-on, ça marche sur téléphone, et que devient ta place si tu perds la connexion ?',
  },
}

/**
 * Who is streaming the game, and how to be one of them.
 *
 * The page is prose first and a list second, and that order is the whole
 * design. A list of live channels is wrong tomorrow, so it carries no search
 * value and is not what a crawler is offered: what is indexable here is what
 * the game gives a stream and what it takes to appear in the category, both of
 * which are properties of the product rather than of this afternoon. The list
 * is filled in the browser, from this origin, over what the prose already says.
 */
export const LIVE: PageDef = {
  id: 'live',
  path: { en: '/live/', fr: '/fr/en-direct/' },
  navLabel: { en: 'Live', fr: 'En direct' },
  title: {
    en: 'LOCO! live on Twitch · Who is streaming now',
    fr: 'LOCO! en direct sur Twitch · Qui streame maintenant',
  },
  description: {
    en: 'Every channel streaming LOCO! right now, biggest first, and what it takes to get your own stream listed here: a category and one setting.',
    fr: 'Toutes les chaînes qui streament LOCO! en ce moment, les plus grosses d’abord, et ce qu’il faut pour que ton live apparaisse ici : une catégorie.',
  },
}

/**
 * Privacy, terms and credits, on one page rather than behind a modal.
 *
 * A policy has to be linkable: somebody who wants to read what the game keeps
 * about them, or to send the terms on to somebody else, needs a URL and not a
 * button that exists on one screen of one application. It is the one page here
 * whose value is not in being found by search, and it is in the registry all the
 * same, because that is what gives it a canonical, an hreflang pair and a
 * sitemap entry like everything else.
 */
export const LEGAL: PageDef = {
  id: 'legal',
  path: { en: '/privacy/', fr: '/fr/confidentialite/' },
  navLabel: { en: 'Privacy & terms', fr: 'Confidentialité et conditions' },
  title: {
    en: 'LOCO! privacy & terms · No account, no cookie, no tracker',
    fr: 'Confidentialité et conditions · Sans compte ni cookie',
  },
  description: {
    en: 'What the game knows about you, which is almost nothing: no account, no cookie banner, no analytics. Plus the terms and credits.',
    fr: 'Ce que le jeu sait de toi, presque rien : aucun compte, aucun bandeau cookies, aucune mesure d’audience. Conditions et crédits.',
  },
}

/**
 * The link preview an invitation unfurls into.
 *
 * Same drawing as the site's, one line of copy different, and that line is the
 * whole point: the picture has to say *somebody is waiting for you at a table*
 * rather than *here is a card game*. It is captured from the same showcase scene
 * as `og.png` (`make og`), so the duck and the fan cannot drift between the two.
 *
 * The line is written once, here, and read twice: by `<meta og:title>` through
 * `INVITE.ogTitle` and by the card itself, which imports this module. A sentence
 * that appears in a picture and beside it is one sentence.
 */
export const INVITE_OG: OgImage = {
  path: {
    en: `/og.invite.png?v=${OG_VERSION}`,
    fr: `/og.invite.fr.png?v=${OG_VERSION}`,
  },
  type: 'image/png',
  width: 1200,
  height: 630,
  alt: {
    en: 'The LOCO! duck beside a fan of cards, over the words: a seat is being held for you.',
    fr: 'Le canard LOCO! à côté d’un éventail de cartes, sur les mots : on t’a gardé une place.',
  },
}

/**
 * Where an invitation points, and the one page here that is not a page of the
 * site.
 *
 * It exists for a single reason: a link dropped in a chat window unfurls into
 * whatever the *served* HTML says, and `/` says "LOCO!, a card game". An
 * invitation deserves to say that a seat is waiting, and the only way to say it
 * differently is to be a different document. Everything else about it is the
 * home page: the same mount, the same bundle, the same game.
 *
 * Four things follow from that, and each is asserted by `invitePage.test.ts`:
 *
 *  - **It is deliberately absent from `PAGES`**, so it is in no sitemap, in no
 *    `hreflang` set and in no navigation. It is a door somebody was handed, not
 *    a page anybody should arrive at from a search result.
 *  - **It is served `noindex`**, which is also what keeps it out of the
 *    canonical graph — `Base.astro` emits no canonical for a noindex page, and a
 *    duplicate of the home page claiming one would be competing with it.
 *  - **It has one path in both languages.** An invitation carries no language
 *    (see `hooks/tableInvite.ts`): the reader's browser decides, exactly as it
 *    does at `/`. So there is no French twin to point an `hreflang` at, and the
 *    page is served with no `data-served-lang` for `initLang` to act on.
 *  - **The code is not in the built path.** `/i/` is one emitted page and the
 *    code rides in the query string (`/i/?t=ABC234`), because a static build
 *    cannot emit a page per table. `/i/ABC234` would need a fallback in
 *    whoever serves the request; nginx can do that, `astro dev` cannot, so the
 *    path form would 404 under `make dev` and take the whole Playwright suite
 *    with it. `invitePage.test.ts` asserts the fallback stays absent.
 */
export const INVITE: PageDef = {
  id: 'invite',
  path: { en: '/i/', fr: '/i/' },
  title: {
    en: 'A seat is being held for you · LOCO!',
    fr: 'On t’a gardé une place · LOCO!',
  },
  description: {
    en: 'A LOCO! table is waiting for you. Pick a nickname, take your place, and play: no account, nothing to install, nobody waits their turn.',
    fr: 'Une table LOCO! t’attend. Choisis un pseudo, prends ta place et joue : aucun compte, rien à installer, personne n’attend son tour.',
  },
  ogTitle: {
    en: 'A seat is being held for you',
    fr: 'On t’a gardé une place',
  },
  ogDescription: {
    en: 'A LOCO! table is waiting. Pick a nickname, take your place: no account, nothing to install, nobody waits their turn.',
    fr: 'Une table LOCO! t’attend. Choisis un pseudo, prends ta place : aucun compte, rien à installer, personne n’attend son tour.',
  },
  ogImage: INVITE_OG,
}

/** Every indexable page. The sitemap, the hreflang pairs and the tests read this. */
export const PAGES: readonly PageDef[] = [HOME, RULES, CARDS, TABLES, FRIENDS, LIVE, FAQ_PAGE, LEGAL]

/**
 * The pages the site navigation offers, in order. The home page is not one of
 * them: it is the game, and it is reached by the logo and the play button.
 * Neither is `LEGAL`, which closes the row rather than joining this list: it
 * is not something to read, it is something to be able to find.
 */
export const NAV: readonly PageDef[] = [RULES, CARDS, TABLES, FRIENDS, LIVE, FAQ_PAGE]

/** Resolved social title/description, falling back to the page's own. */
export function social(page: PageDef, lang: Lang): { title: string; description: string } {
  return {
    title: page.ogTitle?.[lang] ?? page.title[lang],
    description: page.ogDescription?.[lang] ?? page.description[lang],
  }
}

export interface Alternate {
  hreflang: string
  href: string
}

/**
 * The `hreflang` set for a page: one entry per language plus `x-default`.
 *
 * Reciprocity is what makes these count — Google ignores a set where the pages
 * do not point back at each other — and it is free here because both sides are
 * generated from the same `PageDef`.
 */
export function alternates(page: PageDef): Alternate[] {
  const links = LANGS.map((l) => ({ hreflang: LOCALE[l], href: absolute(page.path[l]) }))
  return [...links, { hreflang: 'x-default', href: absolute(page.path[DEFAULT_LANG]) }]
}

/**
 * The trail under the title in a result: `LOCO! › Rules` instead of a raw URL.
 *
 * Shared, because it is the one rich result these pages actually earn and every
 * page owes Google the same two rungs. The FAQ builds its own graph and reads
 * this too, or it would be the single page on the site with no trail.
 */
export function breadcrumbJsonLd(page: PageDef, lang: Lang): object {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${absolute(page.path[lang])}#breadcrumb`,
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: SITE_NAME,
        item: absolute(HOME.path[lang]),
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: page.navLabel?.[lang] ?? page.title[lang],
        item: absolute(page.path[lang]),
      },
    ],
  }
}

/**
 * Structured data for an ordinary content page: what it is, and where it sits.
 *
 * `WebPage`, not `Article`, and not `HowTo` either. HowTo lost its rich result
 * in 2023, so the rules page would maintain markup that renders nowhere. And
 * `Article` is a *supported* type, which is exactly the problem: a validator
 * holds it to Google's article requirements and reports `author`,
 * `datePublished` and `image` as **errors** on every page here — three fields
 * this site has no honest value for. There is no editorial identity to name
 * (see `docs/notes/legal.md`) and these are evergreen documents with no
 * publication date. `WebPage` states the same thing with nothing to invent, and
 * the breadcrumb beside it is what a result actually shows.
 *
 * The nodes are joined by `@id`: every page points at the one `#website` and
 * the one `#game` the home page declares, so a crawler reads seven pages about
 * a single entity rather than seven unrelated documents.
 */
export function pageJsonLd(page: PageDef, lang: Lang): object {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${absolute(page.path[lang])}#webpage`,
        name: page.title[lang],
        description: page.description[lang],
        inLanguage: LOCALE[lang],
        url: absolute(page.path[lang]),
        isPartOf: { '@id': `${ORIGIN}/#website` },
        about: { '@id': `${ORIGIN}/#game` },
        breadcrumb: { '@id': `${absolute(page.path[lang])}#breadcrumb` },
      },
      breadcrumbJsonLd(page, lang),
    ],
  }
}

/**
 * Structured data for the home page: the site, the page, and the game itself.
 *
 * `VideoGame` is what describes a playable thing rather than a product page,
 * and free / 2-to-10 / in-a-browser are the properties this category is
 * actually searched on, so they are stated as data and not only as prose.
 *
 * **Free is said with `isAccessibleForFree`, never with an `Offer`.** A
 * `VideoGame` carrying `offers`, `applicationCategory` and `operatingSystem`
 * is a `SoftwareApplication` as far as a validator is concerned, and Google's
 * software requirements make `aggregateRating` mandatory: the block came back
 * with a critical error on every audit, and the only way to satisfy it would
 * have been to publish ratings nobody has left. The boolean says the same thing
 * to the same crawlers and asks for nothing that does not exist.
 *
 * `playMode` values are the full enumeration URLs, which is what the range
 * `GamePlayMode` means; a bare string is a text value in an enumeration slot.
 */
export function homeJsonLd(lang: Lang): object {
  const { title } = social(HOME, lang)
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${ORIGIN}/#website`,
        url: absolute(HOME.path[lang]),
        name: SITE_NAME,
        inLanguage: LOCALE[lang],
        description: HOME.description[lang],
      },
      {
        '@type': 'WebPage',
        '@id': `${absolute(HOME.path[lang])}#webpage`,
        url: absolute(HOME.path[lang]),
        name: HOME.title[lang],
        description: HOME.description[lang],
        inLanguage: LOCALE[lang],
        isPartOf: { '@id': `${ORIGIN}/#website` },
        about: { '@id': `${ORIGIN}/#game` },
        primaryImageOfPage: absolute(OG_IMAGE.path[lang]),
      },
      {
        '@type': 'VideoGame',
        '@id': `${ORIGIN}/#game`,
        name: SITE_NAME,
        url: absolute(HOME.path[lang]),
        description: HOME.description[lang],
        alternateName: title,
        inLanguage: LOCALE[lang],
        image: absolute(OG_IMAGE.path[lang]),
        genre: lang === 'fr' ? 'Jeu de cartes' : 'Card game',
        gamePlatform: 'Web browser',
        playMode: ['https://schema.org/MultiPlayer', 'https://schema.org/SinglePlayer'],
        numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 2, maxValue: 10 },
        isAccessibleForFree: true,
      },
    ],
  }
}
