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
 * It is no longer what keeps a store field honest. `gameStore.svelte.ts` gives
 * every top-level field its own signal, so an effect reading
 * `game.current.errorMsg` already depends on the error and nothing else, whether
 * or not it goes through here. (It was written when the window was one
 * `$state.raw` replaced on every write, and every effect watching one field
 * re-ran on every message — which cleared and re-armed its timer, so a notice
 * never left a busy board. `docs/notes/client.md` tells it.)
 *
 * What is left is what a per-field window cannot do:
 *
 * - **a value computed from a field**: `players.length`, `myHand.some(…)`, a
 *   lookup into `catchWindows`. The field moves, the answer often does not, and
 *   an effect that read the computation directly would re-run on the field;
 * - **a nested field** of an object the store replaces whole (`lastPlay.at`,
 *   `matchFound.startsAt`);
 * - **a prop**: a child does not get the narrowing either, and a sibling prop
 *   being re-evaluated re-runs an effect reading `p.watched` even when the value
 *   came back equal.
 *
 * A `$derived` is the device in all three because Svelte compares its result:
 * it re-evaluates when what it read moves, and notifies nothing when the answer
 * came back `Object.is` equal. Constants skip the derivation entirely — there is
 * nothing to subscribe to.
 *
 * Call it during setup, once per watched value, and read the accessor it
 * returns inside the effect. The hooks that take a `Live<T>` all read it this
 * way, which is what lets them be handed a getter of any of the three kinds.
 * `src/test/liveDeps.test.ts` holds both guarantees.
 */
export function live<T>(source: Live<T>): () => T {
  if (typeof source !== 'function') return () => source
  const value = $derived.by(source as () => T)
  return () => value
}
