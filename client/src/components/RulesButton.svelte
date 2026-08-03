<script lang="ts">
  type Props = { label: string; onclick: () => void; variant?: 'icon' | 'text' }
  let { label, onclick, variant = 'icon' }: Props = $props()
</script>

<!--
  The rules opener, shared by the lobby, the waiting room, the search and the
  table. It wears two shapes, and which one is a matter of what the screen is
  asking of the player.

  At the table (`variant="icon"`) it is a question mark in a cluster of round
  chips: the row is glyphs, mid-match nobody is reading it, and a glyph is read
  faster than a word at 720p. `t.rulesBtn` names it for screen readers and for
  the tooltip.

  Ahead of the deal (`variant="text"`) the row is not the point of the screen
  and there is room to say it, so the chip becomes a pill reading "How to play"
  — the offer, not a symbol somebody has to try. The visible word IS the
  accessible name there: an aria-label over it would give the control two names
  and make it unspeakable to voice control.
-->
<button
  class="button hit-target"
  class:text={variant === 'text'}
  {onclick}
  aria-label={variant === 'icon' ? label : undefined}
  title={variant === 'icon' ? label : undefined}
>
  {#if variant === 'icon'}
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 8.8a3.1 3.1 0 1 1 4.3 2.85c-.85.42-1.3 1.1-1.3 2.05v.6" />
        <path d="M12 18h.01" />
      </g>
    </svg>
  {:else}
    {label}
  {/if}
</button>

<style>
  /* Square icon button, sized and shadowed exactly like the theme toggle and
     <AudioSettings /> so the top-right cluster reads as one row of round chips
     rather than three chips plus a word. The label survives as aria-label +
     title: an icon-only control still has to say its name. */
  .button {
    /* `.hit-target` in tokens.css centres its pseudo-element on this box, which
       needs somewhere to be positioned against. Without it the "?" was the one
       chip in the row a thumb had 40px of instead of --touch-target, and the two
       beside it hid the fact by being right. */
    position: relative;
    width: 40px;
    height: 40px;
    padding: 0;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--color-surface-card);
    color: var(--color-ink);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out);
  }

  /* The pill. Same height, same outline, same hard shadow as the chips beside
     it, so the row still reads as one row: only the width and the label change.
     `white-space: nowrap` because "Comment jouer" is two words and a pill that
     wraps is a pill that grew a second line in the corner of the screen. */
  .button.text {
    width: auto;
    padding: 0 var(--space-base);
    border-radius: var(--radius-full);
    font: 700 15px/1 var(--font-display);
    white-space: nowrap;
  }

  .button:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 0 var(--color-stroke-soft);
  }
  .button:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--color-stroke-soft);
  }
</style>
