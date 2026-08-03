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
  still copies the real code, and hovering it with a mouse or reaching it with
  the keyboard clears the blur so the owner can still read it out loud.

  What must never clear it is a click or a tap, because that is the copy gesture
  and it happens on camera. On a touch screen the blur therefore stays put: the
  code copies, it does not show.
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

  /* Reading it out loud is a normal thing to want to do, so it is one hover away,
     and the enclosing control counts too: in the waiting room the value lives
     inside the copy button.

     `@media (hover: hover)` is load-bearing, not tidiness. A touch screen has no
     hover, so it emulates one on tap and leaves it stuck on the element until
     something else is tapped: the copy gesture uncovered the code and left it
     uncovered, which is the one outcome this mode exists to prevent. */
  @media (hover: hover) and (pointer: fine) {
    .hidden:hover,
    /* `:global` on the ancestor only, and this is the case the no-`:global` rule
       names as the exception: the enclosing control is the waiting room's copy
       button, which is another component's markup, so Svelte cannot see it and
       prunes the selector as unused. It did — silently — and the code stopped
       revealing itself when the button was hovered. */
    :global(:hover) > .hidden {
      filter: none;
      background: var(--color-surface-strong);
    }
  }

  /* Keyboard focus reveals; a mouse click must not. `:focus` matched the click
     that copies the code and held the reveal after the pointer had left, so a
     stream showed the six characters until the next click landed elsewhere.
     `:focus-visible` is the same door for the keyboard without that. */
  .hidden:focus-visible,
  :global(:focus-visible) > .hidden {
    filter: none;
    background: var(--color-surface-strong);
  }

  /* A blur is not motion, so reduced-motion keeps it; only the fade goes. */
  :root[data-motion="reduce"] .hidden {
    transition: none;
  }
</style>
