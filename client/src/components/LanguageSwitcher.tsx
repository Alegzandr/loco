import { useI18n, Lang } from '../i18n'
import styles from './LanguageSwitcher.module.css'

const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'fr', label: 'FR' },
]

export function LanguageSwitcher() {
  const { lang, setLang } = useI18n()

  return (
    <div className={styles.switcher} role="group" aria-label="Language">
      {LANGS.map(({ code, label }) => (
        <button
          key={code}
          className={`${styles.btn} ${lang === code ? styles.active : ''}`}
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          aria-label={`Switch language to ${label}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
