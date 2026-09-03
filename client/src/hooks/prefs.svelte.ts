import { createSubscriber } from 'svelte/reactivity'
import type { BooleanPref } from './prefStore'

/**
 * A preference, read the way a rune is read.
 *
 * `createSubscriber` subscribes while something is reading the value and drops
 * the subscription when nothing is, so a preference costs one listener no matter
 * how many components display it. The store itself stays in `prefStore.ts`, with
 * no framework in it: that is what let a preference survive the crossing from
 * React unchanged, and it is what still lets `page-boot.ts` read the same
 * choice on a page that mounts nothing.
 */
export function watchPref(pref: BooleanPref): { readonly current: boolean } {
  const subscribe = createSubscriber((update) => pref.subscribe(update))
  return {
    get current() {
      subscribe()
      return pref.get()
    },
  }
}
