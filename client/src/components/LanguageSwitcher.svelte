<script lang="ts">
  import { i18n } from '../i18n/i18n.svelte'
  import type { Lang } from '../lang'
  // Where the game lives in each language, defined once in `src/lang.ts` — the
  // content pages' globe and the boot-time redirect both need it, and neither can
  // import a component. `seo.test.ts` pins it against `HOME.path`.
  import { HOME_PATH } from '../lang'

  const LANGS: { code: Lang; label: string }[] = [
    { code: 'en', label: 'EN' },
    { code: 'fr', label: 'FR' },
  ]

  const lang = $derived(i18n.lang)

  // Read at setup, which is when the panel opens: a seat is taken by a whole
  // screen change, never while this control is on screen.
  const seated =
    typeof document !== 'undefined' && document.documentElement.hasAttribute('data-seated')
</script>

<!--
  The language pair, inside the preferences panel.

  It has two shapes, because the page has two halves. Half of `/` is markup Astro
  rendered — the footer row, the burger's drawer, the sheet of prose — and that
  half is built per URL: `/` is English, `/fr/` is French, and no amount of in-app
  state changes a word of it. A switch that only called `setLang` left the game in
  French under a menu still reading "With friends", which is the bug this shape
  exists to make impossible.

  So at the entry screen these are real links to the same game in the other
  language, and following one is what makes the whole document agree: the menu,
  the footer, the prose, the <title> and the link-preview tags all come from the
  page that gets served. `setLang` still runs on the way out so the choice
  survives the navigation and is what a later visit to a language-less URL uses.

  Past the entry screen there is nothing to agree with — `data-seated` has taken
  the footer and the drawer off the page — and a navigation would drop the match.
  There it is the ordinary in-app toggle it always was.
-->
<div class="switcher" role="group" aria-label="Language">
  {#each LANGS as { code, label } (code)}
    {#if seated}
      <button
        class="btn"
        class:active={lang === code}
        onclick={() => i18n.setLang(code)}
        aria-pressed={lang === code}
        aria-label="Switch language to {label}"
      >
        {label}
      </button>
    {:else}
      <a
        class="btn"
        class:active={lang === code}
        href={HOME_PATH[code] + (typeof location === 'undefined' ? '' : location.search)}
        hreflang={code}
        {...{ lang: code }}
        aria-current={lang === code ? 'true' : undefined}
        aria-label="Switch language to {label}"
        onclick={() => i18n.setLang(code)}
      >
        {label}
      </a>
    {/if}
  {/each}
</div>

<style>
  .switcher {
    display: flex;
    gap: 3px;
    background: var(--color-surface-strong);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-full);
    padding: 3px;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
  }

  /* One rule for both shapes: at the entry screen these are <a href>s to the game
     in the other language, past it they are buttons. The two must be the same
     object on screen — see the comment above — so everything an anchor brings
     with it is undone here. */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    padding: 5px 12px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-muted);
    font: 700 13px/1.2 var(--font-display);
    letter-spacing: 0.05em;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
    min-height: 30px;
    touch-action: manipulation;
  }

  .btn:hover {
    color: var(--color-ink);
  }

  .btn.active {
    background: var(--color-surface-card);
    color: var(--color-ink);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }
</style>
