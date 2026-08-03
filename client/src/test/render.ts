import { render as renderWithOptions } from '@testing-library/svelte'
// The library's own idea of "a component", so the constraint below is the one it
// checks its argument against rather than a lookalike written from Svelte's
// types — those differ in their third parameter and the mismatch surfaces as an
// inference failure at every call site, not here.
//
// `svelte-core` is `@testing-library/svelte`'s own dependency rather than ours,
// which npm's flat `node_modules` makes resolvable. Types only, test-only, and
// the whole cost of it going away is writing these four aliases out by hand.
import type {
  Component,
  ComponentImport,
  ComponentOptions,
  Props,
} from '@testing-library/svelte-core/types'

export * from '@testing-library/svelte'

/**
 * Renders a component with props, and only ever with props.
 *
 * The library's own `render` accepts either props or mount options in that
 * second argument, and tells them apart by name: `target`, `anchor`, `props`,
 * `events`, `context` and `intro` are options, everything else is a prop. Those
 * are ordinary English words, and the game already uses one of them —
 * `<Reconnecting target="waiting" />` distinguishes coming back to a table from
 * coming back to a match.
 *
 * That collision has two shapes and the quiet one is the problem. A component
 * with a colliding prop *and* an ordinary one throws `UnknownSvelteOptionsError`,
 * which is loud and points at the fix. A component whose only prop is a
 * colliding one mounts happily into the wrong DOM node, or with a prop the
 * library swallowed, and the test fails somewhere else entirely — or worse,
 * still passes.
 *
 * So the choice is not made per test. Everything goes under `props`, no test
 * has to know the reserved list, and a component that gains a prop named
 * `context` next month breaks nothing. No test in this suite has ever wanted a
 * real mount option; the day one does, it can call the library directly and say
 * why.
 */
export function render<C extends Component>(component: C, props?: Props<C>) {
  // Both parameter types are conditionals on C, so they stay unresolved while C
  // is a type parameter and nothing can be proved to fit them. The two casts are
  // that gap and nothing more: a Svelte 5 component *is* its own import, and
  // `{ props }` *is* one of the two shapes the options union allows.
  return renderWithOptions(component as ComponentImport<C>, {
    props: props ?? ({} as Props<C>),
  } as ComponentOptions<C>)
}
