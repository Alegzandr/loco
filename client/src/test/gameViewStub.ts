import type { ClientMsg } from '../types/protocol'

/**
 * What the stubbed `<GameView />` saw.
 *
 * `instances` counts how many times the component was *set up*, which under
 * Svelte is the number that matters: a component's script body runs once per
 * instantiation and never again, so a store write that leaves this number alone
 * is a store write that did not tear the match screen down and rebuild it.
 *
 * The React suite counted renders here, because React's contract was a
 * `memo` that had to survive referentially stable props. Svelte has no render
 * to count — but it has the same bug available: keying the board on something
 * derived from state, or putting it inside a `{#key}`, rebuilds it on every
 * change. That is what this number catches.
 */
export const gameViewStub = {
  instances: 0,
  onSend: null as ((msg: ClientMsg) => void) | null,
  reset() {
    gameViewStub.instances = 0
    gameViewStub.onSend = null
  },
}
