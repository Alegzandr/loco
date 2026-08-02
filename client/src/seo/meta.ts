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
 * Mostly build-time, but importable from the browser on purpose: `RulesModal`
 * links to the rules page and must not hardcode its URL beside this registry.
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
 * Read through a `typeof` guard rather than directly: this module is also
 * imported by a React component (for the page paths alone), and a bare
 * `process.env` throws "process is not defined" in a browser. In that context
 * the value is never used — only the paths are.
 */
export const ORIGIN = (
  (typeof process !== 'undefined' ? process.env?.VITE_PUBLIC_ORIGIN : undefined) ??
  'https://loco.kisukesaama.com'
).replace(/\/+$/, '')

/**
 * Cache buster on the preview image. Both Discord and X cache a preview by URL
 * for days, so this is the only way to make them re-fetch after the art
 * changes: bump it whenever `make og` regenerates the PNGs.
 */
export const OG_VERSION = 2

export const SITE_NAME = 'LOCO'

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
}

export const OG_IMAGE = {
  /** English art by default; the French card is rendered by `make og --lang=fr`. */
  path: { en: `/og.png?v=${OG_VERSION}`, fr: `/og.fr.png?v=${OG_VERSION}` } as Record<Lang, string>,
  type: 'image/png',
  width: 1200,
  height: 630,
  alt: {
    en: 'The LOCO duck beside a fan of five cards: green 4, blue skip, wild +4, yellow +2, red 7.',
    fr: 'Le canard LOCO à côté d’un éventail de cinq cartes : 4 vert, passe bleu, +4 joker, +2 jaune, 7 rouge.',
  } as Record<Lang, string>,
} as const

export const HOME: PageDef = {
  id: 'home',
  path: { en: '/', fr: '/fr/' },
  title: {
    en: 'LOCO · Fast multiplayer card game, free and no signup',
    fr: 'LOCO · Jeu de cartes multijoueur rapide, gratuit et sans inscription',
  },
  description: {
    en: 'Fast online card game for 2 to 10 players, free and with no signup. Pick a name, share a code, sit down: nobody waits their turn. Cut in, stack the penalties, call LOCO on your last card.',
    fr: 'Jeu de cartes en ligne pour 2 à 10 joueurs, gratuit et sans inscription. Choisis un pseudo, partage un code, assieds-toi : personne n’attend son tour. Intercepte, empile les pénalités, annonce LOCO sur ta dernière carte.',
  },
  ogTitle: {
    en: 'LOCO · The card game where nobody waits their turn',
    fr: 'LOCO · Le jeu de cartes où personne n’attend son tour',
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
    en: 'LOCO rules · How to play, card by card',
    fr: 'Règles de LOCO · Comment jouer, carte par carte',
  },
  description: {
    en: 'The full rules: the 112-card deck, what every card does, cutting in out of turn, calling LOCO on your last card, and how a round is scored. Readable in one sitting.',
    fr: 'Les règles complètes : le jeu de 112 cartes, l’effet de chaque carte, l’interception hors de son tour, l’annonce LOCO sur la dernière carte et le décompte des points. Lisible d’une traite.',
  },
}

export const CARDS: PageDef = {
  id: 'cards',
  path: { en: '/cards/', fr: '/fr/cartes/' },
  navLabel: { en: 'Cards', fr: 'Cartes' },
  title: {
    en: 'Every LOCO card · What each one does, and what it is worth',
    fr: 'Toutes les cartes de LOCO · Effet et valeur de chacune',
  },
  description: {
    en: 'The whole deck, drawn: 72 numbers, Skip, Reverse, +2, Swap, Global Switch, Wild and +4. What each card does, how many are in the deck, and what it costs you at the end of a round.',
    fr: 'Tout le jeu, dessiné : 72 numéros, Passe, Changement de sens, +2, Échange, Rotation, Changement de couleur et +4. L’effet de chaque carte, son nombre d’exemplaires et ce qu’elle coûte en fin de manche.',
  },
}

export const TABLES: PageDef = {
  id: 'tables',
  path: { en: '/tables/', fr: '/fr/tables/' },
  navLabel: { en: 'Tables', fr: 'Tables' },
  title: {
    en: 'The four LOCO tables · Neon, Rune, Velvet, Orbit',
    fr: 'Les quatre tables de LOCO · Neon, Rune, Velvet, Orbit',
  },
  description: {
    en: 'Every match is dealt in a room: a rooftop club, an arcane tavern, an art-deco lounge or a station in orbit. The four rooms, and what each one looks like.',
    fr: 'Chaque partie se joue dans une pièce : un club sur les toits, une taverne arcanique, un salon art déco ou une station en orbite. Les quatre salles, et à quoi elles ressemblent.',
  },
}

export const FRIENDS: PageDef = {
  id: 'friends',
  path: { en: '/play-with-friends/', fr: '/fr/jouer-entre-amis/' },
  navLabel: { en: 'With friends', fr: 'Entre amis' },
  title: {
    en: 'Play cards online with friends · Free, no signup, one code',
    fr: 'Jouer aux cartes en ligne entre amis · Gratuit, sans inscription',
  },
  description: {
    en: 'Open a table, send the code, play. Two to ten friends in the same game in about ten seconds, in any browser, with no account and nothing to install on either side.',
    fr: 'Ouvre une table, envoie le code, jouez. De deux à dix amis dans la même partie en une dizaine de secondes, dans n’importe quel navigateur, sans compte et sans rien installer.',
  },
}

export const FAQ_PAGE: PageDef = {
  id: 'faq',
  path: { en: '/faq/', fr: '/fr/faq/' },
  navLabel: { en: 'FAQ', fr: 'FAQ' },
  title: {
    en: 'LOCO FAQ · Free, no account, 2 to 10 players',
    fr: 'FAQ LOCO · Gratuit, sans compte, de 2 à 10 joueurs',
  },
  description: {
    en: 'Is it free, does it need an account, how many can play, does it work on a phone, can you play against bots, and what happens to your seat if you drop mid-match.',
    fr: 'Est-ce gratuit, faut-il un compte, à combien peut-on jouer, ça marche sur téléphone, peut-on affronter des bots, et que devient ta place si tu perds la connexion en pleine partie.',
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
    en: 'LOCO privacy & terms · No account, no cookie, no tracker',
    fr: 'Confidentialité et conditions de LOCO · Sans compte ni cookie',
  },
  description: {
    en: 'What the game knows about you, which is almost nothing: no account, no cookie banner, no analytics, no third-party request. Plus the terms of use and the credits.',
    fr: 'Ce que le jeu sait de toi, c’est-à-dire presque rien : aucun compte, aucun bandeau cookies, aucune mesure d’audience, aucune requête tierce. Avec les conditions d’utilisation et les crédits.',
  },
}

/** Every indexable page. The sitemap, the hreflang pairs and the tests read this. */
export const PAGES: readonly PageDef[] = [HOME, RULES, CARDS, TABLES, FRIENDS, FAQ_PAGE, LEGAL]

/**
 * The pages the site navigation offers, in order. The home page is not one of
 * them: it is the game, and it is reached by the logo and the play button.
 * Neither is `LEGAL`, which sits on its own at the right-hand end of the bar:
 * it is not something to read, it is something to be able to find.
 */
export const NAV: readonly PageDef[] = [RULES, CARDS, TABLES, FRIENDS, FAQ_PAGE]

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
 * Structured data for an ordinary content page: what it is, and where it sits.
 *
 * `Article` rather than `HowTo`, even for the rules. Google removed HowTo rich
 * results from search in 2023, so the extra markup would buy nothing and would
 * still have to be kept correct. The breadcrumb is what actually shows: it
 * replaces the raw URL under the title in a result.
 */
export function pageJsonLd(page: PageDef, lang: Lang): object {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        '@id': `${absolute(page.path[lang])}#article`,
        headline: page.title[lang],
        description: page.description[lang],
        inLanguage: LOCALE[lang],
        url: absolute(page.path[lang]),
        isPartOf: { '@id': `${ORIGIN}/#website` },
        about: { '@id': `${ORIGIN}/#game` },
      },
      {
        '@type': 'BreadcrumbList',
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
      },
    ],
  }
}

/**
 * Structured data for the home page.
 *
 * `VideoGame` is what describes a playable thing rather than a product page,
 * and the free/no-signup offer is the single most searched property of this
 * category, so it is stated as data and not only as prose.
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
        '@type': 'VideoGame',
        '@id': `${ORIGIN}/#game`,
        name: SITE_NAME,
        url: absolute(HOME.path[lang]),
        description: HOME.description[lang],
        alternateName: title,
        inLanguage: LOCALE[lang],
        image: absolute(OG_IMAGE.path[lang]),
        applicationCategory: 'GameApplication',
        gamePlatform: 'Web browser',
        playMode: ['MultiPlayer', 'SinglePlayer'],
        numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 2, maxValue: 10 },
        operatingSystem: 'Any',
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'EUR', availability: 'https://schema.org/InStock' },
      },
    ],
  }
}
