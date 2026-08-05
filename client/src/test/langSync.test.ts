/**
 * One language per document, across both halves of the site.
 *
 * The bug this pins: `/` is markup Astro built in English, and a stored French
 * choice outranks the URL when the app picks its language. So the game rendered
 * in French under a footer reading "With friends", on an `<html lang="fr">` — a
 * document half of which was English, which is a lie to a screen reader before
 * it is a mess to look at. The answer is that both halves move together: the
 * served markup is translated in place by `langSwap.ts` and the address bar goes
 * with it, to a URL where a reload finds the real document.
 *
 * The decision is pure so it can be tested without a DOM; `initLang` is the
 * three lines that apply it, and `homeLangSwap.test.ts` owns the swap itself.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_LANG,
  HOME_PATH,
  LANGS,
  LANG_STORAGE_KEY,
  chooseLang,
  isLang,
  langUrl,
  readStoredLang,
  rememberLang,
} from '../lang'

const CLIENT = path.resolve(__dirname, '..', '..')

describe('which language a document opens in', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('gives a stored choice the last word, at either URL', () => {
    expect(chooseLang('en', 'fr', 'en-US')).toBe('fr')
    expect(chooseLang('fr', 'en', 'fr-FR')).toBe('en')
  })

  it('lets the browser decide on the default URL, where nobody has said anything', () => {
    // The whole point of the change: `/` is where a visitor lands without
    // asking for a language, so a device set to French opens the game in
    // French instead of in the language the root happens to be written in.
    expect(chooseLang(DEFAULT_LANG, null, 'fr-FR')).toBe('fr')
    expect(chooseLang(DEFAULT_LANG, null, 'fr')).toBe('fr')
    expect(chooseLang(DEFAULT_LANG, null, 'en-GB')).toBe('en')
  })

  it('refuses the browser the last word at a URL that already asked', () => {
    // A French link, sent to somebody whose browser is in English, opens in
    // French. The URL is the request; a setting they never touched does not get
    // to overrule the one they were handed.
    expect(chooseLang('fr', null, 'en-US')).toBe('fr')
    expect(chooseLang('fr', null, 'de-DE')).toBe('fr')
  })

  it('lets the browser decide where the document is in no language at all', () => {
    // `/i/`, which is one URL for both languages. There is nothing to overrule.
    expect(chooseLang(undefined, null, 'fr-FR')).toBe('fr')
    expect(chooseLang(undefined, null, 'en-US')).toBe('en')
  })

  it('falls back to the default rather than to a language we do not have', () => {
    expect(chooseLang(undefined, null, 'de-DE')).toBe(DEFAULT_LANG)
    expect(chooseLang(undefined, null, undefined)).toBe(DEFAULT_LANG)
    expect(chooseLang('de', null, 'de')).toBe(DEFAULT_LANG)
  })

  it('ignores a stored value that is not a language', () => {
    expect(chooseLang('en', 'de', 'en-US')).toBe('en')
    expect(chooseLang('en', '', 'en-US')).toBe('en')
    expect(isLang('de')).toBe(false)
  })

  it('never decides twice', () => {
    // The guarantee that matters: whatever it decides for a document, it decides
    // again for the document at the URL that answer names. Without it the swap
    // would run on arrival too, and a reload would sit between two languages.
    for (const served of LANGS) {
      for (const stored of [...LANGS, null]) {
        for (const browser of ['en-US', 'fr-FR', 'de-DE', undefined]) {
          const lang = chooseLang(served, stored, browser)
          expect(chooseLang(lang, stored, browser), `${served}/${stored}/${browser}`).toBe(lang)
        }
      }
    }
  })
})

describe('where that puts the address bar', () => {
  it('names the URL that is already in that language', () => {
    expect(langUrl('fr', 'en', 'en')).toBe('/fr/')
    expect(langUrl('en', 'fr', 'fr')).toBe('/')
    for (const lang of LANGS) expect(langUrl(lang, lang, lang)).toBeNull()
  })

  it('asks what the document shows, not what it was built as', () => {
    // The case the swap creates and a redirect never could: a page served as
    // English, showing French, at `/fr/`. Computing against `data-served-lang`
    // there decides English is already the URL's language and leaves the
    // address bar at `/fr/` over an English document — which a shared link then
    // hands over as the French page.
    expect(langUrl('en', 'en', 'fr'), 'back to the language it was built in').toBe('/')
    expect(langUrl('fr', 'en', 'fr'), 'and nothing to do when it is showing').toBeNull()
  })

  it('leaves a document that was built as no language where it is', () => {
    // The invite page: one URL for both, so there is no other address for it to
    // be at. It still opens in the reader's own language — that is `chooseLang`
    // above, and it is a different question.
    expect(langUrl('fr', undefined, 'en')).toBeNull()
    expect(langUrl('fr', '', 'en')).toBeNull()
  })

  it('carries the query string and the fragment across', () => {
    // A parameter belongs to whoever put it there: `?showcase=` is how the
    // visual harness drives this page, and dropping one on the way through
    // would be this function editing a URL it was not asked about.
    expect(langUrl('fr', 'en', 'en', '?showcase=lobby')).toBe('/fr/?showcase=lobby')
    expect(langUrl('en', 'fr', 'fr', '?showcase=lobby', '#top')).toBe('/?showcase=lobby#top')
  })

  it('lands on the home path of the language it names', () => {
    for (const lang of LANGS) {
      const other = LANGS.find((l) => l !== lang)!
      expect(langUrl(lang, other, other)).toBe(HOME_PATH[lang])
    }
  })

  it('replaces the history entry rather than adding one', () => {
    // Back must not point at a URL that would send the player straight back
    // here, or the way out of the game is a trap. `replaceState` is also what
    // keeps this from reading as a redirect: the request for `/` was answered
    // with the English page, and that is still what a crawler is holding.
    const src = readFileSync(path.join(CLIENT, 'src', 'langSwap.ts'), 'utf8')
    expect(src).toMatch(/history\.replaceState\(/)
    expect(src, 'a language is no longer a navigation').not.toMatch(
      /location\.replace\(|location\.assign\(|location\.href =/,
    )
  })
})

describe('a detection is not a choice', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('writes nothing down', () => {
    // A detection that stored itself would become a choice, and a choice
    // outranks the URL — so the next French link this player was sent would
    // open in English, for good. Only the two switches write.
    const swap = readFileSync(path.join(CLIENT, 'src', 'langSwap.ts'), 'utf8')
    expect(swap).not.toMatch(/rememberLang|setItem/)
    const lang = readFileSync(path.join(CLIENT, 'src', 'lang.ts'), 'utf8')
    // One writer in the module, and it is the one the switches call.
    expect(lang.match(/setItem/g) ?? []).toHaveLength(1)
    expect(lang).toMatch(/export function rememberLang/)
  })

  it('reads back only what it wrote', () => {
    expect(readStoredLang()).toBeNull()
    rememberLang('fr')
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('fr')
    expect(readStoredLang()).toBe('fr')
    localStorage.setItem(LANG_STORAGE_KEY, 'klingon')
    expect(readStoredLang()).toBeNull()
  })
})

describe('both halves of the site write the choice down', () => {
  it('the game stores it, and the lobby switch navigates with it', () => {
    // `i18n/store.ts` owns the language, and the choice is written down by the
    // one thing that owns the value: there is no second copy to keep in step.
    const store = readFileSync(path.join(CLIENT, 'src', 'i18n', 'store.ts'), 'utf8')
    expect(store, 'one definition of the key').not.toMatch(/'loco_lang'/)
    expect(store).toMatch(/rememberLang\(/)
    expect(store, 'and one definition of the rule').toMatch(/chooseLang\(/)
    const switcher = readFileSync(
      path.join(CLIENT, 'src', 'components', 'LanguageSwitcher.svelte'),
      'utf8',
    )
    // The pick applies itself now, on both halves of the page at once: the
    // game's strings and the choice through `setLang`, the served markup and
    // the address bar through the swap. No link, so no Apply button.
    expect(switcher, 'the pick records the choice').toMatch(/i18n\.setLang\(code\)/)
    expect(switcher, 'and carries the served half with it').toMatch(/swapServedLang\(/)
    expect(switcher, 'nothing here navigates any more').not.toMatch(/<a\b|href=/)
  })

  it('a content page stores it too, without losing the href', () => {
    // The globe used to navigate and record nothing, so a reader who chose
    // French, read the rules and pressed "Jouer" reached `/fr/` with English
    // stored — and a stored choice outranks the URL, so the game opened in
    // English at a French address.
    const boot = readFileSync(path.join(CLIENT, 'src', 'content', 'theme-boot.ts'), 'utf8')
    expect(boot).toMatch(/rememberLang\(/)
    expect(boot, 'delegated, because two globes open one panel').toMatch(/#langPop a\[lang\]/)

    // The links themselves stay real: the href is what makes an hreflang pair
    // navigable, and a crawler follows nothing else.
    const layout = readFileSync(path.join(CLIENT, 'src', 'layouts', 'ContentPage.astro'), 'utf8')
    expect(layout).toMatch(/<a\s+href=\{page\.path\[l\]\}/)
  })

  it('settles the language before anything one-shot is spent', () => {
    // `initTableInvite()` takes the table code back out of the address bar, and
    // `initLang()` rewrites the address bar. In this order neither loses
    // anything to the other.
    // Anchored on the indentation, because both names are also written in the
    // comments explaining why they sit in this order, and `indexOf` would find
    // the prose first.
    const entry = readFileSync(path.join(CLIENT, 'src', 'entry.ts'), 'utf8')
    const decided = entry.match(/^ {2}initLang\(\)$/m)
    const invite = entry.match(/^ {2}initTableInvite\(\)$/m)
    expect(decided?.index, 'entry.ts must ask the question').toBeGreaterThan(-1)
    expect(invite?.index).toBeGreaterThan(decided!.index!)
    expect(entry, 'and there is one boot now, not a conditional one').toMatch(/^boot\(\)$/m)
  })
})
