/**
 * One language per document, across both halves of the site.
 *
 * The bug this pins: `/` is markup Astro built in English, and a stored French
 * choice outranks the URL when the app picks its language. So the game rendered
 * in French under a footer reading "With friends", on an `<html lang="fr">` — a
 * document half of which was English, which is a lie to a screen reader before
 * it is a mess to look at. The answer is a navigation, not a translation: the
 * document goes to the URL that is already in the language the player chose.
 *
 * The decision is pure so it can be tested without navigating; `initLangUrl` is
 * the two lines that apply it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  HOME_PATH,
  LANGS,
  LANG_STORAGE_KEY,
  isLang,
  langRedirect,
  readStoredLang,
  rememberLang,
} from '../lang'

const CLIENT = path.resolve(__dirname, '..', '..')

describe('the language of a document', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('sends a stored choice to the URL that is already in that language', () => {
    expect(langRedirect('en', 'fr')).toBe('/fr/')
    expect(langRedirect('fr', 'en')).toBe('/')
  })

  it('stays put when the URL already agrees', () => {
    for (const lang of LANGS) expect(langRedirect(lang, lang)).toBeNull()
  })

  it('never redirects twice', () => {
    // The guarantee that matters: whatever it sends a document to, that
    // document must agree on arrival. A target that disagreed would redirect
    // again, and the browser would spin between two URLs forever.
    for (const served of LANGS) {
      for (const stored of LANGS) {
        const target = langRedirect(served, stored)
        if (target === null) continue
        expect(target, `${served} → ${stored}`).toBe(HOME_PATH[stored])
        // Arriving there, the page is served as `stored`, which is what is
        // stored: nothing left to disagree about.
        expect(langRedirect(stored, stored)).toBeNull()
      }
    }
  })

  it('carries the query string and the fragment across', () => {
    // `?t=CODE` is a table invitation. Dropping it would land a guest who
    // followed a link at a home page with no table in it — and the redirect
    // runs before `initTableInvite()` precisely so the code is still there.
    // `?showcase=` is how the visual harness drives this page.
    expect(langRedirect('en', 'fr', '?t=ABC42')).toBe('/fr/?t=ABC42')
    expect(langRedirect('fr', 'en', '?showcase=lobby', '#top')).toBe('/?showcase=lobby#top')
  })

  it('does nothing without an explicit choice', () => {
    // Landing on a French page from a search result is not a choice, and
    // nothing writes one down for it. Only the two switches do.
    expect(langRedirect('en', null)).toBeNull()
    expect(langRedirect('fr', null)).toBeNull()
  })

  it('ignores a stored value that is not a language', () => {
    expect(langRedirect('en', 'de')).toBeNull()
    expect(langRedirect('en', '')).toBeNull()
    expect(isLang('de')).toBe(false)
  })

  it('stays put when the document does not say what it was served as', () => {
    // With no `data-served-lang` there is nothing to disagree with, and
    // redirecting on an unknown would send every load to the same place it
    // already is — forever.
    expect(langRedirect(undefined, 'fr')).toBeNull()
    expect(langRedirect('', 'fr')).toBeNull()
  })

  it('reads back only what it wrote', () => {
    expect(readStoredLang()).toBeNull()
    rememberLang('fr')
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('fr')
    expect(readStoredLang()).toBe('fr')
    localStorage.setItem(LANG_STORAGE_KEY, 'klingon')
    expect(readStoredLang()).toBeNull()
  })

  it('replaces the history entry rather than adding one', () => {
    // `assign` would leave Back pointing at a URL that redirects straight back
    // here, so the way out of the game would be a trap.
    const src = readFileSync(path.join(CLIENT, 'src', 'lang.ts'), 'utf8')
    expect(src).toMatch(/location\.replace\(/)
    expect(src, 'no history entry for a correction').not.toMatch(/location\.assign\(|location\.href =/)
  })
})

describe('both halves of the site write the choice down', () => {
  it('the game stores it, and the lobby switch navigates with it', () => {
    // `i18n/store.ts` owns the language, and the choice is written down by the
    // one thing that owns the value: there is no second copy to keep in step.
    const store = readFileSync(path.join(CLIENT, 'src', 'i18n', 'store.ts'), 'utf8')
    expect(store, 'one definition of the key').not.toMatch(/'loco_lang'/)
    expect(store).toMatch(/rememberLang\(/)
    const switcher = readFileSync(
      path.join(CLIENT, 'src', 'components', 'LanguageSwitcher.svelte'),
      'utf8',
    )
    expect(switcher, 'the entry screen follows a real link').toMatch(/href=\{HOME_PATH\[choice\]/)
    expect(switcher, 'and records the choice on the way out').toMatch(/i18n\.setLang\(choice\)/)
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

  it('runs the redirect before the invitation is spent', () => {
    // `initTableInvite()` takes `?t=CODE` out of the address bar. Spending it
    // and then navigating would drop the table on the floor.
    const entry = readFileSync(path.join(CLIENT, 'src', 'entry.ts'), 'utf8')
    const redirect = entry.indexOf('initLangUrl()')
    const invite = entry.indexOf('initTableInvite()')
    expect(redirect, 'entry.ts must ask the question').toBeGreaterThan(-1)
    expect(entry, 'and boot nothing when the answer is yes').toMatch(/if \(!initLangUrl\(\)\) boot\(\)/)
    expect(invite).toBeGreaterThan(-1)
  })
})
