import { flushSync } from 'svelte'
import { render } from './render'
import Harness from './Harness.svelte'

/**
 * Runs a module that is nothing but `$effect`.
 *
 * An effect only exists inside a component, so this mounts one whose entire job
 * is to call the setup function during initialisation. What comes back is what
 * the module returned — and every one of them returns an object with a `current`
 * getter, so `result.current` is a live read rather than a snapshot. The name and
 * that shape are inherited: they are what several hundred assertions in this
 * suite were already written against, and keeping them is why the port of each
 * hook was a change to one line rather than to every test around it.
 *
 * The mount is flushed, so the effect has run by the time this returns: a test
 * asserting on the state a hook starts in must not read the frame before it.
 *
 * `initialProps` is the one input a test can move while the hook is mounted,
 * for the hooks that take a `Live<T>` and are meant to react to it. `setup`
 * receives an accessor rather than a value, which is that same `Live<T>`: hand
 * it straight to the hook and `rerender` reaches all the way through.
 */
export function renderHook<T, P = undefined>(
  setup: (props: () => P) => T,
  options?: { initialProps: P },
): { result: T; rerender: (next: P) => void; unmount: () => void } {
  let result!: T

  const rendered = render(Harness, {
    setup: (props: () => unknown) => {
      result = setup(props as () => P)
      return result
    },
    hookProps: options?.initialProps,
  })

  return {
    result,
    rerender(next: P) {
      rendered.rerender({ hookProps: next })
      flushSync()
    },
    unmount: rendered.unmount,
  }
}

/**
 * Does something, then lets the DOM catch up.
 *
 * The name is inherited too, kept because that is what these tests call it: the
 * shape of the assertion around it never changed, only what has to happen in
 * between.
 */
export function act<T>(fn: () => T): T {
  const out = fn()
  flushSync()
  return out
}
