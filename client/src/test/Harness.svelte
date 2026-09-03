<script lang="ts">
  import { untrack } from 'svelte'
  /**
   * A component whose only job is to be a component.
   *
   * Several of the modules under `hooks/` are `$effect` and nothing else — the
   * held key, the countdown, the drain bar, the reconnect overlay — and an effect
   * only runs inside a component. The React suite spelled that as a throwaway
   * function component per test file; this is the one Svelte equivalent, so a test
   * about a countdown is about the countdown rather than about the four lines of
   * scaffolding around it.
   *
   * `setup` runs during initialisation, which is where an effect may be created.
   * Whatever it returns is exposed as `value` and rendered as text, so a test can
   * read the result out of the DOM the way it read it out of a render before.
   */
  type Props = {
    setup: (props: () => unknown) => unknown
    /**
     * The one prop a test can change while the hook is mounted.
     *
     * `setup` is handed an accessor for it rather than its value, because that
     * is what makes it live: read inside the hook's own effect, the accessor
     * tracks this prop and the effect re-runs when a `rerender` moves it. It is
     * also exactly the `Live<T>` shape the hooks already accept, so a test hands
     * the accessor straight through — see `renderHook`.
     */
    hookProps?: unknown
    /** Optional: rendered instead of the returned value. */
    children?: import('svelte').Snippet
  }

  let { setup, hookProps, children }: Props = $props()

  const value = untrack(() => setup)(() => hookProps)
</script>

<div data-testid="harness">
  {#if children}{@render children()}{:else if value && typeof value === 'object' && 'current' in value}{String(
      (value as { current: unknown }).current,
    )}{:else}{String(value)}{/if}
</div>
