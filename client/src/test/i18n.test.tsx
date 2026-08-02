import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider, useI18n } from '../i18n'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'

// Simple component to expose i18n state for testing
function Inspector() {
  const { lang, t, setLang } = useI18n()
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="tagline">{t.tagline}</span>
      <button onClick={() => setLang('fr')}>fr</button>
      <button onClick={() => setLang('en')}>en</button>
    </div>
  )
}

describe('i18n translations', () => {
  it('en and fr have identical key sets', () => {
    const enKeys = Object.keys(en).sort()
    const frKeys = Object.keys(fr).sort()
    expect(enKeys).toEqual(frKeys)
  })

  it('en rules sections match fr rules sections count', () => {
    expect(en.rules.length).toBe(fr.rules.length)
  })

  it('every en rules section has an fr equivalent with the same number of items', () => {
    en.rules.forEach((section, i) => {
      expect(fr.rules[i].items.length).toBe(section.items.length)
    })
  })

  it('no en or fr string is empty', () => {
    const strValues = (obj: Record<string, unknown>): string[] =>
      Object.values(obj).flatMap((v) =>
        typeof v === 'string' ? [v] : Array.isArray(v) ? [] : []
      )
    strValues(en as unknown as Record<string, unknown>).forEach((s) =>
      expect(s.trim().length).toBeGreaterThan(0)
    )
    strValues(fr as unknown as Record<string, unknown>).forEach((s) =>
      expect(s.trim().length).toBeGreaterThan(0)
    )
  })
})

describe('I18nProvider', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    document.documentElement.lang = ''
  })

  it('defaults to en when no stored preference', () => {
    render(
      <I18nProvider>
        <Inspector />
      </I18nProvider>
    )
    expect(screen.getByTestId('lang').textContent).toBe('en')
  })

  it('loads stored lang preference from localStorage', () => {
    localStorage.setItem('loco_lang', 'fr')
    render(
      <I18nProvider>
        <Inspector />
      </I18nProvider>
    )
    expect(screen.getByTestId('lang').textContent).toBe('fr')
  })

  it('setLang switches language and persists to localStorage', () => {
    render(
      <I18nProvider>
        <Inspector />
      </I18nProvider>
    )
    expect(screen.getByTestId('lang').textContent).toBe('en')

    fireEvent.click(screen.getByText('fr'))
    expect(screen.getByTestId('lang').textContent).toBe('fr')
    expect(localStorage.getItem('loco_lang')).toBe('fr')
  })

  it('tagline changes when language switches', () => {
    render(
      <I18nProvider>
        <Inspector />
      </I18nProvider>
    )
    const enTagline = en.tagline
    const frTagline = fr.tagline
    expect(screen.getByTestId('tagline').textContent).toBe(enTagline)

    fireEvent.click(screen.getByText('fr'))
    expect(screen.getByTestId('tagline').textContent).toBe(frTagline)
  })

  it('sets document.documentElement.lang', () => {
    render(
      <I18nProvider>
        <Inspector />
      </I18nProvider>
    )
    expect(document.documentElement.lang).toBe('en')
    fireEvent.click(screen.getByText('fr'))
    expect(document.documentElement.lang).toBe('fr')
  })

  describe('the language the page was served as', () => {
    afterEach(() => {
      delete document.documentElement.dataset.servedLang
    })

    it('opens in the language of the URL, whatever the browser asks for', () => {
      // `/fr/` is a real, indexable URL: it can rank, be clicked from a French
      // search result, and be shared. Rendering it in English because the
      // browser happens to be English would waste the click and contradict the
      // `lang="fr"` the document declares.
      document.documentElement.dataset.servedLang = 'fr'
      render(
        <I18nProvider>
          <Inspector />
        </I18nProvider>
      )
      expect(screen.getByTestId('lang').textContent).toBe('fr')
    })

    it('still loses to a choice the player made', () => {
      // Someone who switched to English and then followed a French link meant
      // the switch. The effect above rewrites <html lang> to match, so the
      // document stops disagreeing with what is on screen.
      localStorage.setItem('loco_lang', 'en')
      document.documentElement.dataset.servedLang = 'fr'
      render(
        <I18nProvider>
          <Inspector />
        </I18nProvider>
      )
      expect(screen.getByTestId('lang').textContent).toBe('en')
    })

    it('is not read back from <html lang>, which the provider itself writes', () => {
      // The circularity this guards: `lang` is an output of the provider, so
      // detecting from it would make the app read its own last render. Only
      // `data-served-lang`, which nothing in the app writes, is an input.
      document.documentElement.lang = 'fr'
      render(
        <I18nProvider>
          <Inspector />
        </I18nProvider>
      )
      expect(screen.getByTestId('lang').textContent).toBe('en')
    })
  })
})
