<script lang="ts">
  import { i18n } from '../i18n/i18n.svelte'
  import type { Lang } from '../lang'
  // Where the game lives in each language, defined once in `src/lang.ts` — the
  // content pages' globe and the boot-time redirect both need it, and neither can
  // import a component. `seo.test.ts` pins it against `HOME.path`.
  import { HOME_PATH } from '../lang'

  // Autonyms, deliberately untranslated: a chooser is read by the person who
  // cannot read the language currently on screen, so "Français" is the only
  // label that works from either side. "EN"/"FR" was a code, not a name.
  const LANGS: { code: Lang; label: string }[] = [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
  ]

  const t = $derived(i18n.t)
  const lang = $derived(i18n.lang)

  // Read at setup, which is when the panel opens: a seat is taken by a whole
  // screen change, never while this control is on screen. Same for the query
  // string, which the invite link needs carried across the navigation.
  const seated =
    typeof document !== 'undefined' && document.documentElement.hasAttribute('data-seated')
  const search = typeof location === 'undefined' ? '' : location.search

  // The panel is mounted with `{#if open}`, so this starts at the live language
  // every time it is opened. Nothing else in the game changes the language, so
  // there is nothing to sync back from.
  let choice = $state(i18n.lang)
  const pending = $derived(choice !== lang)

  function pick() {
    // Past a taken seat the choice *is* the application: `setLang` swaps the
    // strings where they stand, so there is no page to leave and nothing for a
    // second press to protect. Only the entry screen gets a button.
    if (seated) i18n.setLang(choice)
  }

  function keepChoice(e: MouseEvent) {
    // Pressing "Apply" on the language already showing would navigate to the
    // page we are on: a reload that changes nothing, on a control that says it
    // is off.
    if (!pending) {
      e.preventDefault()
      return
    }
    i18n.setLang(choice)
  }
</script>

<!--
  The language chooser, inside the preferences panel.

  It has two shapes, because the page has two halves. Half of `/` is markup Astro
  rendered — the footer row, the burger's drawer, the sheet of prose — and that
  half is built per URL: `/` is English, `/fr/` is French, and no amount of in-app
  state changes a word of it. A switch that only called `setLang` left the game in
  French under a menu still reading "With friends", which is the bug this shape
  exists to make impossible.

  So at the entry screen the dropdown chooses and an Apply button spends the
  choice, as a real link to the same game in the other language. Following it is
  what makes the whole document agree: the menu, the footer, the prose, the
  <title> and the link-preview tags all come from the page that gets served.
  `setLang` still runs on the way out so the choice survives the navigation and
  is what a later visit to a language-less URL uses. **The button exists because
  that press reloads the page**: a control that costs the page must not fire on
  the press that was aiming for it, and a thumb sliding across a segmented pair
  is exactly how it did.

  Past the entry screen there is nothing to agree with — `data-seated` has taken
  the footer and the drawer off the page — and a navigation would drop the match.
  `setLang` swaps the strings where they stand, the board never blinks, so there
  is nothing left for a button to protect: the pick applies itself, and Apply is
  not rendered at all. A button that costs nothing is a step asked for nothing.
-->
<div class="lang">
  <div class="row">
    <div class="pick">
      <select class="select" bind:value={choice} onchange={pick} aria-label={t.prefsLanguage}>
        {#each LANGS as { code, label } (code)}
          <option value={code}>{label}</option>
        {/each}
      </select>
      <!-- Drawn, never a font character: same rule as the gear and the rules
           button. `appearance: none` took the native arrow with it. -->
      <svg class="chev" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
        <path
          d="M6 9.5L12 15.5L18 9.5"
          fill="none"
          stroke="currentColor"
          stroke-width="2.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    {#if !seated}
      <a
        class="apply"
        class:applyOff={!pending}
        href={HOME_PATH[choice] + search}
        hreflang={choice}
        {...{ lang: choice }}
        aria-disabled={pending ? undefined : 'true'}
        onclick={keepChoice}
      >
        {t.prefsApply}
      </a>
    {/if}
  </div>

  <!-- Only where it is true. Past a taken seat applying a language changes the
       strings in place, and promising a reload that never comes is worse than
       saying nothing. -->
  {#if !seated}
    <p class="hint">{t.prefsLanguageHint}</p>
  {/if}
</div>

<style>
  .lang {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
  }

  .row {
    display: flex;
    align-items: stretch;
    gap: 8px;
    width: 100%;
  }

  /* The chevron is positioned against this, not against the select: a select
     cannot carry a child. */
  .pick {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
  }

  .select {
    width: 100%;
    appearance: none;
    -webkit-appearance: none;
    padding: 6px 30px 6px 12px;
    min-height: 36px;
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-md);
    background: var(--color-surface-strong);
    color: var(--color-ink);
    font: 700 13px/1.2 var(--font-display);
    cursor: pointer;
    touch-action: manipulation;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
  }

  .chev {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-muted);
    /* The whole control is the select underneath, arrow included. */
    pointer-events: none;
  }

  .apply {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    text-decoration: none;
    padding: 6px 14px;
    min-height: 36px;
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-md);
    /* Not the brand red: white on LOCO Red is 3.43:1, which needs 1.2rem type,
       and a 19px "Apply" next to a 13px dropdown is a different control
       entirely. Same raised chip as the gear that opened the panel. */
    background: var(--color-surface-card);
    color: var(--color-ink);
    font: 700 13px/1.2 var(--font-display);
    cursor: pointer;
    touch-action: manipulation;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out);
  }

  .apply:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 0 var(--color-stroke-soft);
  }

  .apply:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--color-stroke-soft);
  }

  /* Off means the language on screen is the one selected. A class rather than
     `:disabled`, which cannot reach an <a>, and quiet is a hue, never an
     opacity. */
  .applyOff {
    background: var(--color-surface-strong);
    color: var(--color-muted);
    cursor: default;
  }

  .applyOff:hover {
    transform: none;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
  }

  .hint {
    margin: 0;
    font: 500 11px/1.35 var(--font-body);
    color: var(--color-muted);
  }

  :root[data-motion="reduce"] .apply {
    transition: none;
  }

  /* The phone, where the panel around this is a full-screen sheet and not a
     250px dropdown: a 36px select and a 13px "Apply" were sized for the pointer
     that opened the dropdown, and this one is opened by a thumb. Same breakpoint
     as `Preferences.svelte`, because it is the same surface changing shape. */
  @media (max-width: 46rem) {
    .select,
    .apply {
      min-height: 46px;
      font-size: 15px;
    }

    .select {
      padding: 8px 34px 8px 14px;
    }

    .apply {
      padding: 8px 18px;
    }

    .hint {
      font: 500 13px/1.4 var(--font-body);
    }
  }
</style>
