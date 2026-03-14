import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { en, Translations } from './en'
import { fr } from './fr'

export type Lang = 'en' | 'fr'

const STORAGE_KEY = 'loco_lang'

const translations: Record<Lang, Translations> = { en, fr }

function detectLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY) as Lang | null
  if (stored && stored in translations) return stored
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
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // ignore storage errors
    }
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
