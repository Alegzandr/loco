<script lang="ts">
  import { i18n } from '../i18n/i18n.svelte'
  import { watchPref } from '../hooks/prefs.svelte'
  import { streamerModePref } from '../hooks/streamerMode'
  import { game } from '../hooks/gameStore.svelte'

  type Props = {
    code: string
    /**
     * The host screen's own styling for the value. The blur is layered on top of
     * it rather than replacing it, so the code keeps its size and weight and the
     * layout does not move when the mode is switched mid-screen.
     */
    class?: string
    /**
     * Draw the chain beside the code, for the one place the plate is pressable.
     *
     * Pressing the code copies a *link*, not the six characters, and the toast
     * says so — but only after the press. The first one surprised every tester:
     * they pressed the thing labelled "table code" and got a URL. The icon is
     * what says it beforehand.
     *
     * Off by default: `<Reconnecting />` prints the code as information, with
     * nothing to press and nothing to copy, and a chain there would promise a
     * gesture that does not exist.
     */
    link?: boolean
  }

  let { code, class: extra = '', link = false }: Props = $props()

  const streamer = watchPref(streamerModePref)

  /**
   * The two answers, and either one hides the code.
   *
   * The table's comes from the host over the wire (`streamer_mode_changed`), and
   * it is read here rather than passed in because this component is the only
   * thing allowed to print a code: a prop would have to be remembered at every
   * call site, and forgetting it is a code on a stream. The local preference is
   * this player's own, and it is never overwritten by the host's — turning the
   * panel switch off must not uncover a code somebody else is hiding, and the
   * host stopping their stream must not uncover it for a player who wanted it
   * hidden for their own.
   *
   * `game.current` is replaced whole on every message. See hooks/live.svelte.ts.
   */
  const hidden = $derived(streamer.current || game.current.tableStreamer)
  const t = $derived(i18n.t)
</script>

<!--
  The table code as it is shown on screen.

  Streamer mode blurs it: six characters on a stream is an open door, and the one
  place a player is guaranteed to be showing them is the screen they are sitting
  on while they wait for friends.

  **Nothing uncovers it. There is no reveal at all** — not a hover, not a click,
  not a tap, not keyboard focus. Every one of those was a way the six characters
  came back on screen while the capture was running, and each guard we wrote only
  narrowed which input did it. The way to share the table while the mode is on is
  the copy button: the real code is still in the DOM, so the link copies whole and
  goes out over chat, off camera. A player who wants to read the code out loud
  turns the mode off.
-->
<span class="tableCode" class:tableCodeLinked={link}>
  <!--
    The chain, and it is deliberately *outside* everything streamer mode blurs:
    what has to stay off a stream is the six characters, not the fact that the
    plate copies a link. Drawn rather than a font character, like every other
    icon in the game — a glyph lands on the baseline where this has to sit on the
    code's middle, and it would carry the code's own 2px ink stroke with it.

    `aria-hidden`: the button around it already carries the accessible name, and
    a second name for the same control is a control voice access cannot say.
  -->
  {#if link}
    <svg
      class="linkIcon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M9.5 14.5l5-5M10.8 7.2l1.6-1.6a3.7 3.7 0 015.2 5.2l-1.6 1.6M13.2 16.8l-1.6 1.6a3.7 3.7 0 01-5.2-5.2l1.6-1.6"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
      />
    </svg>
  {/if}
  {#if hidden}
    <!--
      No `tabindex`: this is a `<span>` with nothing to do, and the only reason it
      was reachable was the focus reveal that no longer exists. Leaving it in the
      tab order would be a stop that does nothing, on a screen where the next stop
      is the copy button that does everything.

      The code itself stays the element's text — the blur is a filter, so a screen
      reader still reads it out and the copy still copies it. `title` says why it
      is smeared, and it is the one thing here a pointer may surface: it prints
      "hidden", never the six characters.
    -->
    <span
      class="hidden {extra}"
      data-streamer-hidden="true"
      title={t.prefsCodeHidden}
    >
      {code}
    </span>
  {:else}
    <span class={extra}>{code}</span>
  {/if}
</span>

<style>
  /* A row only when there is an icon in it. Without one this is a plain wrapper
     and the value keeps whatever the host screen laid out for it — which is why
     `<Reconnecting />`'s code did not have to change. */
  .tableCode {
    display: contents;
  }

  .tableCodeLinked {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35em;
  }

  /* Sized off the code beside it rather than set in pixels: the value is
     `clamp(34px, 8vw, 46px)` and the chain has to shrink with it on a phone. */
  .linkIcon {
    flex: none;
    width: clamp(19px, 4.4vw, 25px);
    height: clamp(19px, 4.4vw, 25px);
    color: var(--color-muted);
  }

  /* Blur strong enough that a 720p capture gives nothing away, and no letter
     shape survives it. The value stays selectable and copyable underneath. */
  .hidden {
    filter: blur(9px);
    transition: filter 0.18s ease;
    /* No `cursor: pointer`: nothing here is pressable and nothing here uncovers.
       Where the plate *is* pressable — the waiting room's copy button — the
       button carries its own.

       There is no `:hover`, no `:focus`, no `:focus-visible` rule below this one,
       and adding one is the bug: every input we ever let through this filter put
       the six characters back on the capture. */
    /* The blur bleeds past the glyphs; a hair of padding keeps it off whatever
       sits beside the code. */
    padding-inline: 4px;
    border-radius: var(--radius-sm);
  }

  /* A blur is not motion, so reduced-motion keeps it; only the fade goes. */
  :root[data-motion="reduce"] .hidden {
    transition: none;
  }
</style>
