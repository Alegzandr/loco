/**
 * Privacy, terms and credits, as data.
 *
 * These three documents used to be `t.legal` in `i18n/en.ts` and `i18n/fr.ts`,
 * rendered by a modal over the lobby. They are pages now, for the reason a
 * policy is normally a page: it has to be linkable. Somebody who wants to read
 * what the game keeps about them, or to send the terms to somebody else, needs a
 * URL rather than a button that only exists on one screen of one application.
 *
 * Moving the copy here rather than leaving it in `src/i18n/` is the second half
 * of that: nothing in the game renders it any more, and `src/i18n/en.ts` is
 * loaded by every player on every visit. This file is read at build time by
 * `LegalArticle.astro` and ships in no bundle.
 *
 * Legal copy in a game is read by somebody who wanted to play cards, so it is
 * held to the same standard as the rules page: one sentence per item, headings
 * that say what the item will answer. What it may not do is trade accuracy for
 * brevity. Where the two pull apart, `docs/notes/legal.md` records which
 * obligation each line is discharging, so a future edit can shorten a sentence
 * without quietly deleting a disclosure. `src/test/legal.test.tsx` pins them.
 */
import type { Lang } from '../seo/meta'

export interface LegalSection {
  heading: string
  items: readonly string[]
}

export interface LegalDoc {
  /**
   * The anchor this document answers to, and deliberately the same word in both
   * languages: `#terms` has to keep working when somebody sends the link to a
   * reader who opens the other translation. It lives on the document because it
   * was a positional array in `LegalArticle.astro` — a fourth document, or a
   * reordering, would have rendered `#undefined` and a jump list that quietly
   * went nowhere while the page still looked right.
   */
  slug: 'privacy' | 'terms' | 'credits'
  /** Section heading on the page, and the label in the document jump list. */
  title: string
  sections: readonly LegalSection[]
}

/**
 * Hand-written, in both languages. Change it when the substance changes, not
 * when a sentence is reworded: a date that moves for a typo teaches a reader to
 * ignore it.
 */
export const LEGAL_UPDATED: Record<Lang, string> = {
  en: 'Last updated 1 August 2026',
  fr: 'Dernière mise à jour : 1er août 2026',
}

const EN: readonly LegalDoc[] = [
  {
    slug: 'privacy',
    title: 'Privacy',
    sections: [
      {
        heading: 'The short version',
        items: [
          'No account, no password, no email address. You type a name and you sit down.',
          'No cookie banner, because there is nothing here to consent to: no advertising, no analytics, no tracker, no third-party script of any kind.',
          'Nothing about you is sold, shared or measured. There is no business model to feed.',
        ],
      },
      {
        heading: 'What stays in your browser',
        items: [
          'The name you last played under, your language, your theme, your sound settings and whether streamer mode is on.',
          'A seat token, so reloading the page puts you back in your chair instead of at the door.',
          'All of it lives in your own browser storage. Only the seat token ever goes back to the server, and only to prove the seat is yours.',
          'Clearing this site’s data in your browser erases every bit of it, immediately and for good.',
        ],
      },
      {
        heading: 'What the server sees',
        items: [
          'The name you chose, the cards you play and when you played them. That is the game.',
          'Your name is shown to everyone at your table. That is what it is for, so pick one you are happy being seen with.',
          'Technical logs of connections and errors, kept so the game can be repaired when it breaks and defended when it is abused.',
          'The legal basis is legitimate interest: running the service you asked to use, and keeping it playable for the others.',
        ],
      },
      {
        heading: 'Your address is cut short before it is written down',
        items: [
          'Logs keep the network prefix only, never your full address: 192.0.2.0/24 rather than the machine behind it.',
          'That is enough to see a flood coming from one network, and not enough to point at a person.',
          'It is truncated at the moment of writing, not deleted afterwards, so the full address is never stored at all.',
        ],
      },
      {
        heading: 'How long any of it lasts',
        items: [
          'A table lives in memory. Leave it and your seat is released; restart the server and the match is gone with it.',
          'Technical logs are kept 30 days at most, then deleted.',
          'A match in progress can be written to disk for a few minutes so a server update does not end it, and it is dropped as soon as it has been picked back up.',
          'Nothing else is stored anywhere. There is no database, and no history of who played what.',
        ],
      },
      {
        heading: 'Things that never happen here',
        items: [
          'No advertising, no analytics, no fingerprinting, no profiling, no automated decision about you.',
          'No fonts, scripts or images loaded from anyone else’s server. Everything the page needs, it serves itself.',
          'No data sold, rented or transferred outside the European Union.',
        ],
      },
      {
        heading: 'Your rights',
        items: [
          'Access, correction, erasure, objection and portability are yours under the GDPR.',
          'In practice they are already in your hands: what is about you is either in your browser, where clearing site data erases it, or in a table that disappears when you leave it.',
          'If you think something here is wrong, you can complain to your national data protection authority. In France that is the CNIL.',
        ],
      },
      {
        heading: 'Children',
        items: [
          'The game suits every age and asks nobody how old they are, because it collects nothing that would need the answer.',
          'One piece of advice for anyone, and for younger players in particular: the name you type is public to your table, so use a nickname rather than your real one.',
        ],
      },
    ],
  },
  {
    slug: 'terms',
    title: 'Terms',
    sections: [
      {
        heading: 'What this is',
        items: [
          'A free game, made for the fun of it, with nothing to buy and nothing to sell.',
          'It is offered as it is. There is no promise that it will be up, that it will stay up, or that your match will survive an update, though it does try.',
        ],
      },
      {
        heading: 'Your name is not an account',
        items: [
          'Nothing is reserved. Two people can play under the same name, on the same evening, at different tables.',
          'A name proves nothing about who is holding the cards. Treat it as a label, not as an identity.',
        ],
      },
      {
        heading: 'House rules',
        items: [
          'Choose a name that does not insult anyone, impersonate anyone, or advertise anything.',
          'Play the game yourself. No scripts, no automation, no exploiting a bug you have found instead of reporting it.',
          'Do not hammer the server. It is one machine, and everyone at every table is sharing it.',
        ],
      },
      {
        heading: 'If you break them',
        items: [
          'A connection that does any of the above can be dropped or blocked, without notice.',
          'There is no account to suspend and nothing to appeal, which is the upside of not having one.',
        ],
      },
      {
        heading: 'No money is involved',
        items: [
          'Nothing costs anything, nothing can be bought, there is no currency and no prize.',
          'This is not gambling and it never will be.',
        ],
      },
      {
        heading: 'The game can change',
        items: [
          'Rules get balanced, screens get redrawn, and the whole thing can be taken offline one day.',
          'You will not be asked first, because there is no account through which to ask.',
        ],
      },
      {
        heading: 'Liability',
        items: [
          'The game is provided without warranty of any kind, to the fullest extent the law allows.',
          'It cannot be held liable for any loss arising from using it or from it being unavailable.',
          'Nothing in this paragraph removes a right the law gives you and does not let anyone sign away.',
        ],
      },
      {
        heading: 'Which law',
        items: [
          'French law applies.',
          'These terms exist in French and in English. Both say the same thing; the French text prevails if they ever disagree.',
        ],
      },
    ],
  },
  {
    slug: 'credits',
    title: 'Credits',
    sections: [
      {
        heading: 'This is not UNO',
        items: [
          'LOCO is an independent game with no connection whatsoever to Mattel, Inc.',
          'UNO is a registered trademark of Mattel, Inc. LOCO is not affiliated with, endorsed by or sponsored by them.',
          'Every card face, name, sound and rule wording here was made for this game.',
        ],
      },
      {
        heading: 'The sound',
        items: [
          'Every note and every effect is synthesised while you play. No audio file ships with this game, so there is no sample library to credit.',
        ],
      },
    ],
  },
]

const FR: readonly LegalDoc[] = [
  {
    slug: 'privacy',
    title: 'Confidentialité',
    sections: [
      {
        heading: 'En deux lignes',
        items: [
          'Pas de compte, pas de mot de passe, pas d\'adresse mail. Tu tapes un nom et tu t\'assieds.',
          'Pas de bandeau cookies, parce qu\'il n\'y a rien à accepter : aucune pub, aucune mesure d\'audience, aucun traceur, aucun script tiers.',
          'Rien de ce que tu fais ici n\'est vendu, partagé ou compté. Il n\'y a aucun modèle économique à nourrir.',
        ],
      },
      {
        heading: 'Ce qui reste dans ton navigateur',
        items: [
          'Le dernier nom sous lequel tu as joué, ta langue, ton thème, tes réglages de son et l\'état du mode streamer.',
          'Un jeton de place, pour qu\'un rechargement de page te remette sur ta chaise et pas à la porte.',
          'Tout ça vit dans le stockage de ton propre navigateur. Seul le jeton de place repart vers le serveur, et uniquement pour prouver que la place est la tienne.',
          'Effacer les données de ce site dans ton navigateur supprime l\'ensemble, tout de suite et définitivement.',
        ],
      },
      {
        heading: 'Ce que le serveur voit',
        items: [
          'Le nom que tu as choisi, les cartes que tu poses et le moment où tu les poses. C\'est le jeu.',
          'Ton nom est affiché à toute la table. C\'est exactement sa fonction, alors choisis-en un que tu assumes.',
          'Des journaux techniques de connexions et d\'erreurs, gardés pour réparer le jeu quand il casse et le défendre quand on en abuse.',
          'La base légale est l\'intérêt légitime : faire tourner le service que tu as demandé, et le garder jouable pour les autres.',
        ],
      },
      {
        heading: 'Ton adresse est coupée avant d\'être écrite',
        items: [
          'Les journaux ne gardent que le préfixe réseau, jamais l\'adresse complète : 192.0.2.0/24 plutôt que la machine derrière.',
          'C\'est assez pour voir un flot arriver d\'un même réseau, et pas assez pour désigner une personne.',
          'La coupe se fait au moment d\'écrire, pas après coup : l\'adresse entière n\'est donc jamais conservée.',
        ],
      },
      {
        heading: 'Combien de temps tout ça dure',
        items: [
          'Une table vit en mémoire. Tu la quittes, ta place est libérée ; le serveur redémarre, le match part avec.',
          'Les journaux techniques sont gardés 30 jours au maximum, puis supprimés.',
          'Un match en cours peut être écrit sur le disque quelques minutes pour qu\'une mise à jour ne l\'interrompe pas, et il est effacé dès qu\'il a été repris.',
          'Rien d\'autre n\'est stocké nulle part. Il n\'y a pas de base de données, et aucun historique de qui a joué quoi.',
        ],
      },
      {
        heading: 'Ce qui n\'arrive jamais ici',
        items: [
          'Aucune publicité, aucune mesure d\'audience, aucune empreinte de navigateur, aucun profilage, aucune décision automatisée à ton sujet.',
          'Aucune police, aucun script et aucune image chargés depuis le serveur de quelqu\'un d\'autre. Tout ce dont la page a besoin, elle le sert elle-même.',
          'Aucune donnée vendue, louée ou transférée hors de l\'Union européenne.',
        ],
      },
      {
        heading: 'Tes droits',
        items: [
          'Accès, rectification, effacement, opposition et portabilité te sont acquis au titre du RGPD.',
          'En pratique ils sont déjà entre tes mains : ce qui te concerne est soit dans ton navigateur, où effacer les données du site le supprime, soit dans une table qui disparaît quand tu la quittes.',
          'Si tu estimes que quelque chose ne va pas ici, tu peux saisir l\'autorité de protection des données de ton pays. En France, c\'est la CNIL.',
        ],
      },
      {
        heading: 'Les plus jeunes',
        items: [
          'Le jeu convient à tout âge et ne demande son âge à personne, parce qu\'il ne collecte rien qui exigerait la réponse.',
          'Un conseil valable pour tout le monde, et surtout pour les plus jeunes : le nom que tu tapes est public à ta table, alors prends un pseudo plutôt que ton vrai prénom.',
        ],
      },
    ],
  },
  {
    slug: 'terms',
    title: 'Conditions',
    sections: [
      {
        heading: 'Ce que c\'est',
        items: [
          'Un jeu gratuit, fait pour le plaisir, sans rien à acheter et rien à vendre.',
          'Il est proposé tel quel. Rien ne garantit qu\'il soit en ligne, qu\'il le reste, ni que ton match survive à une mise à jour, même s\'il fait tout pour.',
        ],
      },
      {
        heading: 'Ton nom n\'est pas un compte',
        items: [
          'Rien n\'est réservé. Deux personnes peuvent jouer sous le même nom, le même soir, à deux tables différentes.',
          'Un nom ne prouve rien sur qui tient les cartes. C\'est une étiquette, pas une identité.',
        ],
      },
      {
        heading: 'Les règles de la maison',
        items: [
          'Choisis un nom qui n\'insulte personne, n\'usurpe l\'identité de personne et ne fait de publicité pour rien.',
          'Joue toi-même. Pas de script, pas d\'automatisation, et pas d\'exploitation d\'un bug que tu as trouvé au lieu de le signaler.',
          'Ne martèle pas le serveur. C\'est une seule machine, et toutes les tables la partagent.',
        ],
      },
      {
        heading: 'Si tu les enfreins',
        items: [
          'Une connexion qui fait l\'une de ces choses peut être coupée ou bloquée, sans préavis.',
          'Il n\'y a aucun compte à suspendre et rien à contester, ce qui est l\'avantage de ne pas en avoir.',
        ],
      },
      {
        heading: 'Aucun argent en jeu',
        items: [
          'Rien ne coûte rien, rien ne s\'achète, il n\'y a ni monnaie ni lot.',
          'Ce n\'est pas un jeu d\'argent et ça ne le sera jamais.',
        ],
      },
      {
        heading: 'Le jeu peut changer',
        items: [
          'Les règles s\'équilibrent, les écrans se redessinent, et l\'ensemble peut être arrêté un jour.',
          'On ne te demandera pas ton avis avant, parce qu\'il n\'y a aucun compte par lequel te le demander.',
        ],
      },
      {
        heading: 'Responsabilité',
        items: [
          'Le jeu est fourni sans garantie d\'aucune sorte, dans toute la mesure permise par la loi.',
          'Sa responsabilité ne peut être engagée pour un dommage né de son utilisation ou de son indisponibilité.',
          'Rien dans ce paragraphe ne retire un droit que la loi te donne et à laquelle personne ne peut déroger.',
        ],
      },
      {
        heading: 'Quel droit s\'applique',
        items: [
          'Le droit français s\'applique.',
          'Ces conditions existent en français et en anglais. Les deux disent la même chose ; le texte français prévaut en cas de divergence.',
        ],
      },
    ],
  },
  {
    slug: 'credits',
    title: 'Crédits',
    sections: [
      {
        heading: 'Ceci n\'est pas UNO',
        items: [
          'LOCO est un jeu indépendant, sans aucun lien avec Mattel, Inc.',
          'UNO est une marque déposée de Mattel, Inc. LOCO n\'y est ni affilié, ni approuvé, ni sponsorisé par elle.',
          'Chaque face de carte, chaque nom, chaque son et chaque formulation de règle ont été faits pour ce jeu.',
        ],
      },
      {
        heading: 'Le son',
        items: [
          'Chaque note et chaque effet sont synthétisés pendant que tu joues. Aucun fichier audio n\'est livré avec ce jeu, il n\'y a donc aucune banque de sons à créditer.',
        ],
      },
    ],
  },
]

/** The three documents, per language. Same shape in both, section for section. */
export const LEGAL: Record<Lang, readonly LegalDoc[]> = { en: EN, fr: FR }
