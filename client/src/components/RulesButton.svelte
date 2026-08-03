<script lang="ts">
  type Props = { label: string; onclick: () => void }
  let { label, onclick }: Props = $props()
</script>

<!--
  The rules opener, shared by the lobby, the waiting room and the table.
  Icon-only: the button sits in a cluster of round chips, and a question mark is
  read faster than a word at 720p. `t.rulesBtn` still names it for screen readers
  and for the tooltip.
-->
<button class="button hit-target" {onclick} aria-label={label} title={label}>
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 8.8a3.1 3.1 0 1 1 4.3 2.85c-.85.42-1.3 1.1-1.3 2.05v.6" />
      <path d="M12 18h.01" />
    </g>
  </svg>
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

  .button:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 0 var(--color-stroke-soft);
  }
  .button:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--color-stroke-soft);
  }
</style>
