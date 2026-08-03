import '@testing-library/jest-dom'
import { flushSync } from 'svelte'
import { beforeEach } from 'vitest'
import { configure, fireEvent } from '@testing-library/dom'
import { resetI18n } from '../i18n/store'
// Imported for its side effect and its order: see the flush below.
import '../hooks/gameStore.svelte'
import { flushStoreWrites } from './storeFlush.svelte'

// jsdom doesn't ship ResizeObserver; the board's own measurement relies on it.
class ResizeObserverShim {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).ResizeObserver = ResizeObserverShim
}

/**
 * jsdom ships no Web Animations API, and a Svelte transition is `element.animate`.
 *
 * The shim finishes immediately, which is what a test wants: the assertion is
 * about the end state, and no test in this suite measures a frame.
 */
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
  Element.prototype.animate = function animate() {
    const anim = {
      currentTime: 0,
      startTime: 0,
      playbackRate: 1,
      playState: 'finished',
      finished: Promise.resolve(),
      onfinish: null as (() => void) | null,
      effect: { getComputedTiming: () => ({ duration: 0 }) },
      cancel() {},
      play() {},
      pause() {},
      finish() {},
      reverse() {},
      addEventListener() {},
      removeEventListener() {},
    }
    queueMicrotask(() => anim.onfinish?.())
    return anim as unknown as Animation
  }
}

// A store write lands on screen before the next assertion, and only when Svelte
// is not already painting one. The rule, and the crash the guard prevents, are
// in storeFlush.svelte.ts — it lives in its own module because `$effect.tracking()`
// is a rune, and a rune needs a `.svelte.ts` file to be compiled in.
flushStoreWrites()

/**
 * The language is detected once per test, the way it is detected once per boot.
 *
 * `I18nProvider` used to do this on every mount, so a test that cleared storage
 * and rendered got a fresh answer. The provider is gone and the language is a
 * module that outlives the file, so without this the second test in a file
 * inherits whatever the first one chose — and a French label under an English
 * assertion is a confusing way to find that out.
 */
beforeEach(() => {
  resetI18n()
})

/**
 * `fireEvent.change` types into a field.
 *
 * React's `onChange` was never the DOM's `change`: it is wired to `input`, and
 * Testing Library papered over the difference by dispatching `change` and letting
 * React's own plugin answer it. A Svelte component listens to the real `input`
 * event, which is the one a browser fires per keystroke — so the same call typed
 * into the same field and nothing happened.
 *
 * `onchange` on the fields themselves would fix the tests and change the game:
 * the DOM fires `change` on blur, so the lobby would clear a server error the
 * player had not touched. The seam belongs here instead.
 */
/**
 * Every event lands on screen before the next assertion.
 *
 * React Testing Library wrapped `fireEvent` in `act()`, which drained React's
 * work before the call returned — which is why hundreds of assertions in this
 * suite read the DOM on the line after a click. Svelte schedules its updates on
 * the microtask after the event, so the same assertion would read the frame
 * before the one it is about. One flush, in the seam the library provides, and
 * every test says what it always said.
 */
configure({
  eventWrapper: (cb) => {
    const result = cb()
    flushSync()
    return result
  },
})

const dispatchChange = fireEvent.change
fireEvent.change = (element: Element | Node | Document | Window, init?: object) => {
  const answered = dispatchChange(element, init)
  fireEvent.input(element, init)
  flushSync()
  return answered
}
