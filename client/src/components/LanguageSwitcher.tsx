import { useI18n, Lang } from '../i18n'
// Where the game lives in each language, defined once in `src/lang.ts` — the
// content pages' globe and the boot-time redirect both need it, and neither can
// import a React component. `seo.test.ts` pins it against `HOME.path`.
import { HOME_PATH } from '../lang'
import styles from './LanguageSwitcher.module.css'

const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'fr', label: 'FR' },
]

/**
 * The language pair, inside the preferences panel.
 *
 * It has two shapes, because the page has two halves. Half of `/` is markup
 * Astro rendered — the footer row, the burger's drawer, the sheet of prose — and
 * that half is built per URL: `/` is English, `/fr/` is French, and no amount of
 * in-app state changes a word of it. A switch that only called `setLang` left the
 * game in French under a menu still reading "With friends", which is the bug this
 * shape exists to make impossible.
 *
 * So at the entry screen these are real links to the same game in the other
 * language, and following one is what makes the whole document agree: the menu,
 * the footer, the prose, the <title> and the link-preview tags all come from the
 * page that gets served. `setLang` still runs on the way out so the choice
 * survives the navigation and is what a later visit to a language-less URL uses.
 *
 * Past the entry screen there is nothing to agree with — `data-seated` has taken
 * the footer and the drawer off the page — and a navigation would drop the match.
 * There it is the ordinary in-app toggle it always was.
 */
export function LanguageSwitcher() {
  const { lang, setLang } = useI18n()

  // Read at render, which is when the panel opens: a seat is taken by a whole
  // screen change, never while this control is on screen.
  const seated =
    typeof document !== 'undefined' && document.documentElement.hasAttribute('data-seated')

  return (
    <div className={styles.switcher} role="group" aria-label="Language">
      {LANGS.map(({ code, label }) =>
        seated ? (
          <button
            key={code}
            className={`${styles.btn} ${lang === code ? styles.active : ''}`}
            onClick={() => setLang(code)}
            aria-pressed={lang === code}
            aria-label={`Switch language to ${label}`}
          >
            {label}
          </button>
        ) : (
          <a
            key={code}
            className={`${styles.btn} ${lang === code ? styles.active : ''}`}
            // The query string travels: `?showcase=` is how the visual harness
            // drives this page, and dropping it would land the capture on the
            // lobby instead of the scene it asked for.
            href={HOME_PATH[code] + (typeof location === 'undefined' ? '' : location.search)}
            hrefLang={code}
            lang={code}
            aria-current={lang === code ? 'true' : undefined}
            aria-label={`Switch language to ${label}`}
            onClick={() => setLang(code)}
          >
            {label}
          </a>
        ),
      )}
    </div>
  )
}
