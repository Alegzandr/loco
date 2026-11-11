/**
 * An effect that does nothing but read, and counts its runs.
 *
 * The bare shape every timing effect in `state/` has underneath its timer: what
 * it reads is what it depends on, and a run it did not need is a timer cleared
 * and armed again. Mounted through `renderHook`, which is how a test gets an
 * effect a component to live in.
 */
export function watchEffect(read: () => unknown): { readonly runs: number } {
  let runs = 0
  $effect(() => {
    read()
    runs++
  })
  return {
    get runs() {
      return runs
    },
  }
}
