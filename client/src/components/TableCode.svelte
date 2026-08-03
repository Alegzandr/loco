<script lang="ts">
  import { i18n } from '../i18n/i18n.svelte'
  import { watchPref } from '../hooks/prefs.svelte'
  import { streamerModePref } from '../hooks/streamerMode'

  type Props = {
    code: string
    /**
     * The host screen's own styling for the value. The blur is layered on top of
     * it rather than replacing it, so the code keeps its size and weight and the
     * layout does not move when the mode is switched mid-screen.
     */
    class?: string
  }

  let { code, class: extra = '' }: Props = $props()

  const streamer = watchPref(streamerModePref)
  const t = $derived(i18n.t)
</script>

<!--
  The table code as it is shown on screen.

  Streamer mode blurs it: six characters on a stream is an open door, and the one
  place a player is guaranteed to be showing them is the screen they are sitting
  on while they wait for friends. Nothing is masked in the DOM: the copy button
  still copies the real code, and hovering or focusing the value clears the blur
  so the owner can still read it out loud.
-->
{#if streamer.current}
  <span
    class="hidden {extra}"
    data-streamer-hidden="true"
    tabindex="0"
    title={t.prefsCodeHidden}
    aria-label="{t.prefsCodeHidden} {code}"
  >
    {code}
  </span>
{:else}
  <span class={extra}>{code}</span>
{/if}

<style>
  /* Blur strong enough that a 720p capture gives nothing away, and no letter
     shape survives it. The value stays selectable and copyable underneath. */
  .hidden {
    filter: blur(9px);
    transition: filter 0.18s ease;
    cursor: pointer;
    outline: none;
    /* The blur bleeds past the glyphs; a hair of padding keeps it off whatever
       sits beside the code. */
    padding-inline: 4px;
    border-radius: var(--radius-sm);
  }

  /* Reading it out loud is a normal thing to want to do, so it is one hover away.
     Focus works the same for a keyboard, and the enclosing control counts too:
     in the waiting room the value lives inside the copy button. */
  .hidden:hover,
  .hidden:focus,
  /* `:global` on the ancestor only, and this is the case the no-`:global` rule
     names as the exception: the enclosing control is the waiting room's copy
     button, which is another component's markup, so Svelte cannot see it and
     prunes the selector as unused. It did — silently — and the code stopped
     revealing itself when the button was hovered or focused. */
  :global(:hover) > .hidden,
  :global(:focus-visible) > .hidden {
    filter: none;
    background: var(--color-surface-strong);
  }

  /* A blur is not motion, so reduced-motion keeps it; only the fade goes. */
  :root[data-motion="reduce"] .hidden {
    transition: none;
  }
</style>
