import { createSubscriber } from 'svelte/reactivity'
import { getLang, getTranslations, setLang, type Lang, type Translations } from './store'
import { subscribeLang } from './store'

const subscribe = createSubscriber((update) => subscribeLang(update))

/**
 * Svelte's window onto `i18n/store.ts`, the counterpart of `useI18n()`.
 *
 * Read it as `i18n.t.something` in markup and the component re-renders when the
 * language changes; there is no provider to sit under and nothing to pass down,
 * because the language is a module rather than a tree.
 */
export const i18n: { readonly lang: Lang; readonly t: Translations; setLang: (l: Lang) => void } = {
  get lang() {
    subscribe()
    return getLang()
  },
  get t() {
    subscribe()
    return getTranslations()
  },
  setLang,
}
