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

  type Props = {
    /**
     * Showcase only: mounts with the list open, which is otherwise
     * component-local state no scene could reach.
     */
    defaultOpen?: boolean
  }

  let { defaultOpen = false }: Props = $props()

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

  // One id per instance: the option the keyboard is on is named by
  // `aria-activedescendant`, which is a document-wide reference.
  const uid = $props.id()
  const listId = `${uid}-list`
  const optionId = (i: number) => `${uid}-opt-${i}`

  let open = $state(defaultOpen)
  const indexOf = (code: Lang) => Math.max(0, LANGS.findIndex((l) => l.code === code))

  // Where the keyboard is, which is not the choice: arrowing through the list
  // moves this and picks nothing until Enter. Reset from the choice on every
  // opening — including the first, which a scene mounts already open — so the
  // list always opens on the language showing.
  let active = $state(indexOf(i18n.lang))
  let button = $state<HTMLButtonElement | null>(null)
  let pick = $state<HTMLDivElement | null>(null)

  const current = $derived(LANGS.find((l) => l.code === choice)?.label ?? choice)

  function openList() {
    active = indexOf(choice)
    open = true
  }

  function closeList(focus = true) {
    open = false
    if (focus) button?.focus()
  }

  function choose(code: Lang) {
    choice = code
    closeList()
    // Past a taken seat the choice *is* the application: `setLang` swaps the
    // strings where they stand, so there is no page to leave and nothing for a
    // second press to protect. Only the entry screen gets a button.
    if (seated) i18n.setLang(code)
  }

  // The list is not a modal and it is anchored to the control that opened it, so
  // a press anywhere else simply puts it away. The preferences panel runs the
  // same listener one level up for itself; neither cancels the other.
  $effect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (pick && !pick.contains(e.target as Node)) open = false
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  })

  function onKeyDown(e: KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openList()
      }
      // Escape while shut belongs to the panel around this one, which is what
      // the player means by it: the list is not on screen to be dismissed.
      return
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        // The panel listens for Escape on `document` too, and one press must
        // close one thing: the list is what the player is looking at.
        e.stopPropagation()
        closeList()
        break
      case 'ArrowDown':
        e.preventDefault()
        active = (active + 1) % LANGS.length
        break
      case 'ArrowUp':
        e.preventDefault()
        active = (active - 1 + LANGS.length) % LANGS.length
        break
      case 'Home':
        e.preventDefault()
        active = 0
        break
      case 'End':
        e.preventDefault()
        active = LANGS.length - 1
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(LANGS[active].code)
        break
      case 'Tab':
        // Moving on is an answer too, and leaving an open list behind the next
        // control is how a dropdown ends up floating over the panel.
        closeList(false)
        break
    }
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

  **The list is ours, and it has to be.** This was a `<select>`, and a `<select>`
  is two objects: the closed control, which is ours to draw, and the open list,
  which the OS paints. `appearance: none` only ever reached the first one — so a
  panel of ink outlines and hard shadows dropped a white system menu with a blue
  system highlight over the board, in dark theme, on the one screen a streamer is
  guaranteed to open. A button plus a `role="listbox"` is the whole fix: the
  keyboard contract is the one a select had (arrows move, Enter picks, Escape
  backs out, the choice is announced), and the list is finally drawn in the same
  language as everything around it.
-->
<div class="lang">
  <div class="row">
    <div class="pick" bind:this={pick}>
      <button
        type="button"
        class="select"
        bind:this={button}
        role="combobox"
        aria-label={t.prefsLanguage}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        onclick={() => (open ? closeList(false) : openList())}
        onkeydown={onKeyDown}
      >
        <span class="current">{current}</span>
        <!-- Drawn, never a font character: same rule as the gear and the rules
             button. `appearance: none` took the native arrow with it. -->
        <svg
          class="chev"
          class:chevOpen={open}
          viewBox="0 0 24 24"
          width="14"
          height="14"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M6 9.5L12 15.5L18 9.5"
            fill="none"
            stroke="currentColor"
            stroke-width="2.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      {#if open}
        <!-- The keyboard lives on the button, which keeps the focus: every key
             is handled there and the active option is named by
             `aria-activedescendant`, so these rows never take focus and never
             need to give it back. So the compiler's "this row has a click and no
             keydown" is true of the row and wrong about the control: making each
             one a <button> would put two tab stops inside a listbox. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <ul class="menu" id={listId} role="listbox" aria-label={t.prefsLanguage} tabindex="-1">
          {#each LANGS as { code, label }, i (code)}
            <li
              id={optionId(i)}
              class="opt"
              class:optActive={i === active}
              role="option"
              aria-selected={code === choice}
              onclick={() => choose(code)}
              onmousemove={() => (active = i)}
            >
              <span>{label}</span>
              <!-- The chosen one carries a mark, not just a tint: a highlight
                   under the pointer and a highlight meaning "this is the
                   language you are reading" cannot be the same picture. -->
              {#if code === choice}
                <svg class="check" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
                  <path
                    d="M5 12.5L10 17.5L19 7"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
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
    gap: 8px;
    width: 100%;
  }

  .row {
    display: flex;
    align-items: stretch;
    gap: 8px;
    width: 100%;
  }

  /* The list is positioned against this, not against the button: the button is
     what the pointer presses and what shrinks under it. */
  .pick {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
  }

  .select {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    text-align: left;
    padding: 8px 12px 8px 14px;
    min-height: 42px;
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-md);
    background: var(--color-surface-strong);
    color: var(--color-ink);
    font: 700 14px/1.2 var(--font-display);
    cursor: pointer;
    touch-action: manipulation;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
  }

  .current {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chev {
    flex: none;
    color: var(--color-muted);
    transition: transform 0.15s var(--ease-out);
  }

  /* The arrow says which way the list went, the way a native one did. */
  .chevOpen {
    transform: rotate(180deg);
  }

  .menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    /* Above the panel's own settings, never above the sheet's head: this is a
       child of the panel, so it needs no more than the row under it. */
    z-index: 5;
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--color-surface-card);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-pop);
    animation: menuIn 0.16s var(--ease-bounce) both;
  }

  @keyframes menuIn {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 12px;
    min-height: 40px;
    border-radius: calc(var(--radius-md) - 3px);
    color: var(--color-ink);
    font: 700 14px/1.2 var(--font-display);
    cursor: pointer;
    touch-action: manipulation;
  }

  /* One highlight, moved by the pointer and by the arrows alike: two ways of
     saying "here" is two cursors on one list. */
  .optActive {
    background: var(--color-surface-strong);
  }

  .check {
    flex: none;
    color: var(--color-primary);
  }

  .apply {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    text-decoration: none;
    padding: 8px 16px;
    min-height: 42px;
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-md);
    /* Not the brand red: white on LOCO Red is 3.43:1, which needs 1.2rem type,
       and a 19px "Apply" next to a 14px dropdown is a different control
       entirely. Same raised chip as the gear that opened the panel. */
    background: var(--color-surface-card);
    color: var(--color-ink);
    font: 700 14px/1.2 var(--font-display);
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
    font: 500 12px/1.45 var(--font-body);
    color: var(--color-muted);
  }

  :root[data-motion="reduce"] .apply,
  :root[data-motion="reduce"] .chev {
    transition: none;
  }

  /* The list still arrives, it just stops sliding: where it is *is* the
     information. */
  :root[data-motion="reduce"] .menu {
    animation: none;
  }

  /* The phone, where the panel around this is a full-screen sheet and not a
     292px dropdown: a 42px control and a 14px "Apply" are sized for the pointer
     that opened the dropdown, and this one is opened by a thumb. Same breakpoint
     as `Preferences.svelte`, because it is the same surface changing shape. */
  @media (max-width: 46rem) {
    .select,
    .apply {
      min-height: 46px;
      font-size: 15px;
    }

    .select {
      padding: 8px 12px 8px 14px;
    }

    .apply {
      padding: 8px 18px;
    }

    .opt {
      min-height: 46px;
      padding: 10px 12px;
      font-size: 15px;
    }

    .hint {
      font: 500 13px/1.4 var(--font-body);
    }
  }
</style>
