import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { en, Translations } from './en'
import { fr } from './fr'
import { readStoredLang, rememberLang, type Lang } from '../lang'

// The key, the pair of languages and the two home paths live in `src/lang.ts`,
// free of React, because the content pages take part in this decision and mount
// nothing. Re-exported here because this is where the app has always imported
// the type from.
export type { Lang }

const translations: Record<Lang, Translations> = { en, fr }

/**
 * Which language to open in, most explicit signal first.
 *
 * 1. What the player chose. A stored choice outranks everything, including the
 *    URL: someone who switched to English and then followed a French link meant
 *    the switch, and the effect below rewrites `<html lang>` to match so the
 *    document stops disagreeing with what is on screen.
 *
 *    Rewriting the attribute is all this can do about the disagreement, and on
 *    the game page it is not enough — the footer, the drawer and the sheet are
 *    markup built per URL. `initLangUrl()` in `entry.tsx` has already sent that
 *    document to the other language's URL before this runs, so by the time a
 *    stored choice wins here, it wins over a page that agrees with it.
 * 2. What the page was served as. `/fr/` carries `data-served-lang="fr"`, so a
 *    French URL opens in French even for a browser set to English. Without this
 *    the French page would rank, be clicked, and then render in English.
 *
 *    Deliberately not `<html lang>`: the effect below writes that attribute on
 *    every language change, so reading it back here would make the app detect
 *    its own last output instead of the document it was served.
 * 3. What the browser asks for.
 */
function detectLang(): Lang {
  const stored = readStoredLang()
  if (stored) return stored
  const served = (document.documentElement.dataset.servedLang ?? '').slice(0, 2).toLowerCase()
  if (served in translations) return served as Lang
  const browser = navigator.language.slice(0, 2).toLowerCase()
  if (browser === 'fr') return 'fr'
  return 'en'
}

interface I18nContextValue {
  lang: Lang
  t: Translations
  setLang: (l: Lang) => void
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'en',
  t: en,
  setLang: () => {},
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      return detectLang()
    } catch {
      return 'en'
    }
  })

  const setLang = (l: Lang) => {
    setLangState(l)
    rememberLang(l)
  }

  // Sync html lang attribute for accessibility
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  return (
    <I18nContext.Provider value={{ lang, t: translations[lang], setLang }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
