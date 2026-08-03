/**
 * A live getter, or a value that cannot change.
 *
 * The app hands these accessors getters, because what they watch moves. A test
 * that pins one of them in isolation hands a constant, and a constant needs no
 * subscription — so both spellings are accepted and only the getter is tracked.
 */
export type Live<T> = T | (() => T)

/**
 * Narrows a `Live<T>` to the value it names, **and to changes of that value
 * alone**.
 *
 * This is the one thing the port from React lost silently. `useEffect(fn, [x])`
 * compared its dependency by value, so an effect watching one field re-ran when
 * that field changed and never otherwise. Svelte tracks the *signal* that was
 * read, and the client's whole store is a single one: `gameStore.svelte.ts`
 * holds one `$state.raw` and replaces it on every write, so an effect reading
 * `g.errorMsg` through a getter depends on the entire match. Every message the
 * server sends re-runs it.
 *
 * A re-render would have been affordable. The cleanup is not: these effects own
 * timers, and an effect that re-runs clears its timer and arms a fresh one, so
 * a window measured in seconds never reaches its own end while the table is
 * busy. That is a notice that will not go away, a reconnect curtain that
 * outlives the reconnect, a countdown bar snapping back to full on every play
 * and a colour prompt closing itself under the player's thumb.
 *
 * A `$derived` is the fix because Svelte compares its result: it re-evaluates
 * whenever the snapshot moves, and notifies nothing when the field it read came
 * back equal. So the effect sees the dependency React gave it. Constants skip
 * the derivation entirely — there is nothing to subscribe to.
 *
 * Call it during setup, once per watched value, and read the accessor it
 * returns inside the effect. `src/test/liveDeps.test.ts` is what keeps the
 * whole family honest.
 */
export function live<T>(source: Live<T>): () => T {
  if (typeof source !== 'function') return () => source
  const value = $derived.by(source as () => T)
  return () => value
}
