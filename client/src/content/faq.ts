/**
 * The questions somebody asks before they play, and the answers.
 *
 * Every answer here describes behaviour the server actually has — the 60-second
 * hold on a dropped seat, the turn clock, the bots, the 2-to-10 range — so this
 * file is as much a promise as it is copy. When one of those changes, this is
 * one of the places that has to change with it; `CLAUDE.md` and
 * `docs/notes/server.md` are where the numbers come from.
 *
 * The shape is also the `FAQPage` structured data verbatim, which is what can
 * put these questions straight into a search result. That is the reason a FAQ
 * page earns its place at all: the questions are the query.
 *
 * Build-time only, like everything under `src/content/`.
 */
import { absolute, breadcrumbJsonLd, FAQ_PAGE, ORIGIN, type Lang } from '../seo/meta'

export interface QA {
  q: Record<Lang, string>
  /** One or more paragraphs. Plain text: this is also fed to schema.org. */
  a: Record<Lang, readonly string[]>
}

export const FAQ: readonly QA[] = [
  {
    q: { en: 'Is LOCO free?', fr: 'Est-ce que LOCO est gratuit ?' },
    a: {
      en: [
        'Yes, completely. There is nothing to buy, nothing to unlock and no advantage anyone can pay for. Every table, every room and every card is there from the first game.',
      ],
      fr: [
        'Oui, entièrement. Il n’y a rien à acheter, rien à débloquer et aucun avantage que quelqu’un puisse payer. Toutes les tables, toutes les salles et toutes les cartes sont là dès la première partie.',
      ],
    },
  },
  {
    q: { en: 'Do I need an account?', fr: 'Faut-il créer un compte ?' },
    a: {
      en: [
        'No. You pick a nickname and sit down. There is no signup, no password and no email, so there is nothing to forget and nothing to lose.',
        'The nickname is not an identity: two people can use the same one at two different tables, and nothing is kept about you between matches.',
      ],
      fr: [
        'Non. Tu choisis un pseudo et tu t’assieds. Pas d’inscription, pas de mot de passe, pas d’adresse mail : rien à oublier et rien à perdre.',
        'Le pseudo n’est pas une identité : deux personnes peuvent porter le même à deux tables différentes, et rien n’est conservé sur toi d’une partie à l’autre.',
      ],
    },
  },
  {
    q: { en: 'How many people can play?', fr: 'On peut jouer à combien ?' },
    a: {
      en: [
        'From 2 to 10 at one table. It breathes best between 2 and 6: past that the wait between your turns starts to be felt, even though anyone can cut in at any moment.',
      ],
      fr: [
        'De 2 à 10 à une même table. C’est entre 2 et 6 que ça respire le mieux : au-delà, l’attente entre tes tours commence à se sentir, même si n’importe qui peut intercepter à tout instant.',
      ],
    },
  },
  {
    q: {
      en: 'How do I play with my friends?',
      fr: 'Comment jouer avec mes amis ?',
    },
    a: {
      en: [
        'Open a table and you are given a code. Send the code, they enter it, and you are all sitting at the same table. Nobody has to install or register anything.',
        'You can also press Play 1v1 instead, which puts you against whoever is looking for a game at that moment.',
      ],
      fr: [
        'Ouvre une table et un code t’est donné. Tu envoies le code, ils le saisissent, et vous êtes tous à la même table. Personne n’a rien à installer ni à créer.',
        'Tu peux aussi appuyer sur Jouer en 1v1, qui te met face à qui cherche une partie à ce moment-là.',
      ],
    },
  },
  {
    q: { en: 'Does it work on a phone?', fr: 'Ça marche sur téléphone ?' },
    a: {
      en: [
        'Yes. It is the same game in a mobile browser as on a desktop, laid out for the screen it is on rather than shrunk to fit. Nothing to install.',
      ],
      fr: [
        'Oui. C’est le même jeu dans un navigateur mobile que sur un ordinateur, mis en page pour l’écran sur lequel il tourne plutôt que réduit pour y tenir. Rien à installer.',
      ],
    },
  },
  {
    q: { en: 'Can I play against the computer?', fr: 'Peut-on jouer contre l’ordinateur ?' },
    a: {
      en: [
        'At a table you opened, yes: add as many bots as you like before dealing. They play by the same rules you do, and they will cut in on you and catch you out on your last card.',
        'A 1v1 through the queue is always a person.',
      ],
      fr: [
        'À une table que tu as ouverte, oui : ajoute autant de bots que tu veux avant de distribuer. Ils jouent aux mêmes règles que toi, ils t’intercepteront et ils te prendront sur ta dernière carte.',
        'Un 1v1 par la file, en revanche, c’est toujours une personne.',
      ],
    },
  },
  {
    q: {
      en: 'What if I lose my connection mid-match?',
      fr: 'Et si je perds la connexion en pleine partie ?',
    },
    a: {
      en: [
        'Your seat is held for a minute, with your hand and your score exactly as you left them. Come back inside that and you sit straight back down; reloading the page works too.',
        'A 1v1 from the queue holds a seat for fifteen seconds rather than a minute. Nobody should have to wait a whole minute on a stranger who may not be coming back.',
      ],
      fr: [
        'Ta place est gardée une minute, avec ta main et ton score exactement comme tu les as laissés. Reviens dans ce délai et tu te rassieds ; recharger la page fonctionne aussi.',
        'Un 1v1 issu de la file garde la place quinze secondes plutôt qu’une minute. Personne ne devrait attendre une minute entière quelqu’un qu’il ne connaît pas et qui ne reviendra peut-être pas.',
      ],
    },
  },
  {
    q: { en: 'Is there a time limit on a turn?', fr: 'Y a-t-il un temps limite par tour ?' },
    a: {
      en: [
        'Yes. Every turn is on a clock, and letting it run out draws and passes for you rather than stalling the table. Do it four turns running and the seat is given up, so a table is never held hostage by somebody who walked away.',
      ],
      fr: [
        'Oui. Chaque tour est chronométré, et laisser filer le temps pioche et passe à ta place plutôt que de bloquer la table. Quatre tours d’affilée comme ça et la place est libérée : une table n’est jamais prise en otage par quelqu’un qui est parti.',
      ],
    },
  },
]

/**
 * The same questions as schema.org `FAQPage`, plus the trail every other page
 * carries.
 *
 * `FAQPage` is the one structured-data type on the site that can put content
 * *directly* into a result rather than decorate one, which is why the FAQ is
 * shaped as data first and rendered second. It replaces the shared `WebPage`
 * node rather than sitting beside it — `FAQPage` is a `WebPage` — but it is
 * still joined to the site and the game by `@id` and still names its
 * breadcrumb, or this would be the single page here with no trail under its
 * title and no link to the entity the other six describe.
 */
export function faqJsonLd(lang: Lang, locale: string): object {
  const url = absolute(FAQ_PAGE.path[lang])
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        '@id': `${url}#webpage`,
        url,
        name: FAQ_PAGE.title[lang],
        description: FAQ_PAGE.description[lang],
        inLanguage: locale,
        isPartOf: { '@id': `${ORIGIN}/#website` },
        about: { '@id': `${ORIGIN}/#game` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
        mainEntity: FAQ.map((item) => ({
          '@type': 'Question',
          name: item.q[lang],
          acceptedAnswer: { '@type': 'Answer', text: item.a[lang].join(' ') },
        })),
      },
      breadcrumbJsonLd(FAQ_PAGE, lang),
    ],
  }
}
