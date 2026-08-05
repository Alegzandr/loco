/**
 * The language the app renders in, with no framework in it.
 *
 * Split out of the React provider for the reason the store and `theme.ts` were
 * split out of their hooks: a component that was not React could not read a
 * React context, and during the crossing to Svelte both kinds of component
 * rendered the same screens at the same time. One of them would have had to keep
 * a second copy of the current language, and two copies of a language is how a
 * document ends up half translated.
 *
 * The crossing has landed and the reason has outlived it. The language still
 * lives here, in a module with no framework in it, and the app subscribes
 * through `i18n.svelte.ts` — which is also what lets `lang.ts` and a content
 * page read the same choice without mounting anything.
 *
 * `src/lang.ts` still owns the storage key, the two home paths and the redirect,
 * because the content pages take part in that decision and mount nothing at all.
 * This module owns what is on screen right now, which is a different question.
 */
import { en, Translations } from './en'
import { fr } from './fr'
import { chooseLang, readStoredLang, rememberLang, type Lang } from '../lang'

const translations: Record<Lang, Translations> = { en, fr }

let current: Lang = 'en'
const listeners = new Set<() => void>()

/**
 * Which language to open in. The rule itself lives in `lang.ts` — one
 * definition, because the entry point asks the same question a beat earlier in
 * order to decide whether the served markup needs translating, and two answers
 * to it would be a game and a footer in different languages.
 *
 * What this adds is where the three signals are read from. `data-served-lang`,
 * deliberately, and never `<html lang>`: `apply` below writes that attribute on
 * every language change, so reading it back here would make the app detect its
 * own last output instead of the document it was served. The swap leaves it
 * alone for the same reason — it says what the page was *built* as, which stays
 * true, and it is what a reload would hand back.
 */
export function detectLang(): Lang {
  return chooseLang(
    document.documentElement.dataset.servedLang,
    readStoredLang(),
    navigator.language,
  )
}

function apply(lang: Lang): void {
  if (lang === current) {
    // Still tell the document: `resetI18n` puts the value back to the default
    // without touching the attribute, and a detection that lands on the same
    // language must not leave `<html lang>` describing the previous one.
    if (typeof document !== 'undefined') document.documentElement.lang = lang
    return
  }
  current = lang
  // The attribute a screen reader announces the document in. Written here
  // rather than from an effect so it is never one frame behind the text.
  document.documentElement.lang = lang
  for (const fn of listeners) fn()
}

/**
 * Reads the three signals above and adopts the answer. Called once by whatever
 * mounts the app, never by a component that merely displays a string: this
 * *detects*, so it must not be mistaken for a choice and must never persist.
 */
/**
 * Forgets the detected language so the next `initI18n()` decides again.
 *
 * Detection happens once per boot, and a test file is many boots in one page:
 * `I18nProvider` used to re-run it on every mount, so a test that seeded storage
 * and rendered got a fresh answer. This is the seam that keeps that true.
 */
export function resetI18n(): void {
  detected = false
  current = 'en'
}

/**
 * Detection is lazy, and that is what makes it happen at the right moment.
 *
 * `entry.ts` calls `initI18n()` before the first render, so in the app this has
 * always already run. What it buys is the boundary a test needs: reading the
 * language for the first time after a reset decides it, which is exactly when
 * the provider used to decide it — on mount, against whatever storage says now.
 */
let detected = false
function ensureDetected(): void {
  if (detected) return
  detected = true
  // Deliberately not `apply`: this runs on the *first read*, which can be inside
  // a subscription being set up, and notifying listeners from there is a write
  // during a read — Svelte refuses it by name (`state_unsafe_mutation`). Nothing
  // is subscribed yet at the first read anyway; there is nobody to tell.
  try {
    current = detectLang()
  } catch {
    current = 'en'
  }
  if (typeof document !== 'undefined') document.documentElement.lang = current
}

export function initI18n(): Lang {
  detected = false
  ensureDetected()
  // The attribute is set by `apply` only when the language changes, and the
  // common case is that it does not: English detected on an English document.
  // A screen reader still needs to be told.
  document.documentElement.lang = current
  return current
}

export function getLang(): Lang {
  ensureDetected()
  return current
}

export function getTranslations(): Translations {
  ensureDetected()
  return translations[current]
}

/** Records a choice a player made, and renders it. */
export function setLang(lang: Lang): void {
  apply(lang)
  rememberLang(lang)
}

export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export type { Lang, Translations }
