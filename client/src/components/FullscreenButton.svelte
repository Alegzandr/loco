<script lang="ts">
  import { i18n } from '../i18n/i18n.svelte'
  import { playSfx } from '../audio/sfx'

  const t = $derived(i18n.t)

  // Whether this document can go fullscreen at all. Read once, at mount: it is
  // a property of the browser and the embedding, not of anything that moves.
  // jsdom has no such property, and a WebView or an iframe without
  // `allowfullscreen` answers false — in both cases the chip is simply absent,
  // which is the honest answer, rather than a button that throws on press.
  const supported =
    typeof document !== 'undefined' && document.fullscreenEnabled === true

  let isFull = $state(
    typeof document !== 'undefined' && document.fullscreenElement !== null,
  )

  // The browser owns the state: Escape leaves fullscreen without asking us, and
  // F11 on some desktops does not touch the API at all. So the icon follows the
  // document's own event rather than remembering what the button last did.
  // Not a key listener — `noKeyboardShortcuts.test.ts` is about keys, and this
  // reads none.
  $effect(() => {
    if (!supported) return
    const sync = () => (isFull = document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  })

  function toggle() {
    playSfx('uiTap')
    // Both return a promise that rejects when the browser refuses (a request
    // outside a user gesture, a permissions policy). Nothing to do about a
    // refusal but not crash: the chip stays, the icon follows the real state.
    const p = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen()
    p?.catch?.(() => {})
  }
</script>

<!--
  The desktop's way to give the table the whole screen.

  A phone is already the whole screen and the API is patchy there (iOS Safari
  answers only for video), so below 46rem the chip is gone with the rest of the
  desktop row — the burger owns that width. It is a chip in the top-right row
  exactly like the gear and the speaker: same outline, same ledge, same 40px
  drawn over a 44px target, and a drawn glyph rather than a font character. Two
  drawings, never one rotated: four brackets pointing out to enter, pointing in
  to leave, because the icon is read at a glance beside two other chips and a
  rotation is not a word.

  It is not a preference and nothing about it is stored: the browser drops
  fullscreen on its own terms (Escape, a tab switch, a reload) and the chip
  follows it through `fullscreenchange`.
-->
{#if supported}
  <button
    class="toggle hit-target"
    onclick={toggle}
    aria-label={isFull ? t.fullscreenExitBtn : t.fullscreenBtn}
    title={isFull ? t.fullscreenExitBtn : t.fullscreenBtn}
    aria-pressed={isFull}
    data-testid="fullscreen-toggle"
  >
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        {#if isFull}
          <path d="M9.5 4.5v5h-5M14.5 4.5v5h5M9.5 19.5v-5h-5M14.5 19.5v-5h5" />
        {:else}
          <path d="M4.5 9.5v-5h5M19.5 9.5v-5h-5M4.5 14.5v5h5M19.5 14.5v5h-5" />
        {/if}
      </g>
    </svg>
  </button>
{/if}

<style>
  /* The chip, drawn exactly like the gear beside it. `position: relative` is
     what `.hit-target` centres its 44px pseudo-element on. */
  .toggle {
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

  .toggle:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 0 var(--color-stroke-soft);
  }
  .toggle:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--color-stroke-soft);
  }

  /* Desktop only. 46rem is the width everywhere in this product: below it the
     row this chip sits in has already handed the screen to the burger, and a
     phone has nothing to gain from an API half its browsers refuse. */
  @media (max-width: 46rem) {
    .toggle {
      display: none;
    }
  }
</style>
