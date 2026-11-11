import { createSubscriber } from 'svelte/reactivity'
import { isTabActive, otherTabSeated, subscribeTabLock } from './tabLock'

const subscribe = createSubscriber((update) => subscribeTabLock(update))

/**
 * Svelte's window onto `tabLock.ts`, the same shape as `i18n.svelte.ts` and for
 * the same reason: the lock is a module rather than a tree, so a content page
 * could import the plain half without pulling a framework in behind it, and the
 * one component that reads it reactively reads it here.
 *
 * `Root.svelte` is the only caller. Nothing under it needs to know: a blocked
 * tab does not mount the app at all.
 */
export const tabLock: { readonly active: boolean; readonly otherSeated: boolean } = {
  get active() {
    subscribe()
    return isTabActive()
  },
  get otherSeated() {
    subscribe()
    return otherTabSeated()
  },
}
