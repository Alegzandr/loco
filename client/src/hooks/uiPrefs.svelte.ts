import { createSubscriber } from 'svelte/reactivity'
import { getTheme, setTheme, subscribeTheme, type Theme } from '../theme'
import { prefersReducedMotion, subscribeMotion } from './motionPref'

const themeSub = createSubscriber((update) => subscribeTheme(update))
const motionSub = createSubscriber((update) => subscribeMotion(update))

/**
 * The two preferences that are not simple on/off stores, read the way a rune is
 * read. `watchPref` covers the booleans; these two have their own modules
 * because one is a pair of named values and the other folds an OS setting in.
 */
export const themePref: { readonly current: Theme; set: (t: Theme) => void } = {
  get current() {
    themeSub()
    return getTheme()
  },
  set: setTheme,
}

export const reducedMotion: { readonly current: boolean } = {
  get current() {
    motionSub()
    return prefersReducedMotion()
  },
}
