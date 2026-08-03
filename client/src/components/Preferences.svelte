<script lang="ts">
  import { i18n } from '../i18n/i18n.svelte'
  import { playSfx } from '../audio/sfx'
  import { streamerModePref, setStreamerMode } from '../hooks/streamerMode'
  import { colorAssistPref, setColorAssist } from '../hooks/colorAssist'
  import { setMotionPref } from '../hooks/motionPref'
  import { watchPref } from '../hooks/prefs.svelte'
  import { themePref, reducedMotion } from '../hooks/uiPrefs.svelte'
  import type { Theme } from '../theme'
  import LanguageSwitcher from './LanguageSwitcher.svelte'

  type Props = {
    /**
     * Showcase only: mounts with the panel open, which is otherwise
     * component-local state no scene could reach.
     */
    defaultOpen?: boolean
    /**
     * Hides the gear below 46rem, where the burger's drawer offers these settings
     * as a row and two entry points to one panel would be one too many.
     *
     * Only the lobby passes it, and only the lobby may: the drawer lives in the
     * footer `data-seated` hides, so from the waiting room onwards this button is
     * the sole way in at every width. The component still mounts — it is what
     * listens for the drawer's event and renders the panel.
     */
    triggerBelowPhone?: boolean
  }

  let { defaultOpen = false, triggerBelowPhone = true }: Props = $props()

  const t = $derived(i18n.t)
  const streamer = watchPref(streamerModePref)
  const colorAssist = watchPref(colorAssistPref)

  let open = $state(defaultOpen)
  let wrap = $state<HTMLDivElement | null>(null)
  // Where the focus goes on the way out. The gear normally, but the panel can be
  // opened from the home page's drawer, whose button is not in this tree and is
  // not on screen either by the time we render.
  let opener: HTMLElement | null = null

  const themeOptions: [Theme, string][] = $derived([
    ['light', t.prefsThemeLight],
    ['dark', t.prefsThemeDark],
  ])

  // The drawer in `layouts/GamePage.astro` is markup Astro rendered, outside
  // `#root`, so it asks for this panel by event rather than by calling into it.
  // Only one screen is mounted at a time, so only one listener ever answers.
  $effect(() => {
    const onAsk = () => {
      opener = document.activeElement as HTMLElement | null
      open = true
    }
    window.addEventListener('loco:preferences', onAsk)
    return () => window.removeEventListener('loco:preferences', onAsk)
  })

  function close() {
    open = false
    opener?.focus()
    opener = null
  }

  $effect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrap && !wrap.contains(e.target as Node)) open = false
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  })

  function toggle(next: boolean, apply: (v: boolean) => void) {
    apply(next)
    playSfx('uiTap')
  }
</script>

<!--
  Gear button opening the player's own settings.

  The language used to sit bare in the top bar, and so did the theme, which
  worked exactly as long as there were one or two preferences. They share a panel
  now, next to the settings that have no business being a chip: the streamer's
  blurred table code and the motion setting.
-->
<div class="wrap" class:wrapNoTrigger={!triggerBelowPhone} bind:this={wrap}>
  <button
    class="toggle hit-target"
    onclick={() => (open = !open)}
    aria-label={t.prefsBtn}
    title={t.prefsBtn}
    aria-expanded={open}
  >
    <!-- A gear, not a sun: the teeth are short thick stubs sitting right on the
         ring. Long thin spokes off a small circle read as a sun at 20px, which in
         a row that also toggles the theme is the wrong word entirely. Drawn,
         never a font character: same rule as RulesButton. -->
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4.6" stroke-width="2.2" />
        <circle cx="12" cy="12" r="1.5" stroke-width="1.6" />
        <path
          stroke-width="3"
          d="M17.6 12L19.4 12M16 16L17.2 17.2M12 17.6L12 19.4M8 16L6.8 17.2M6.4 12L4.6 12M8 8L6.8 6.8M12 6.4L12 4.6M16 8L17.2 6.8"
        />
      </g>
    </svg>
  </button>

  <!--
    Below 46rem the panel is a sheet over the whole screen rather than a dropdown
    hanging off the gear, so it gets what any such surface gets: something behind
    it, and a control on it. Above that width the scrim is `display: contents` and
    the panel is the dropdown it always was.

    The scrim *wraps* the panel rather than sitting beside it, which is what
    RulesModal does and for the reason it does: as a sibling, "click outside" is a
    z-index argument, and the first version of this lost it — every press inside
    the sheet reached the scrim underneath and shut the panel, so not one setting
    could be changed on a phone. Nested, the panel is not the scrim, and
    `target === currentTarget` is a fact about the DOM rather than about stacking.
  -->
  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="scrim"
      onmousedown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div class="panel" role="dialog" aria-label={t.prefsTitle}>
        <div class="head">
          <div class="title">{t.prefsTitle}</div>
          <button class="close hit-target" onclick={close} aria-label={t.prefsClose} title={t.prefsClose}>
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>

        <!-- Its own scroller, so the title and the way out stay put while the
             settings move under them. As a dropdown it never fills the screen and
             this is simply the group that holds them. -->
        <div class="body">
          <div class="group">
            <span class="label">{t.prefsLanguage}</span>
            <LanguageSwitcher />
          </div>

          <!-- The theme was a bare chip in the top bar, which is right for one
               preference and wrong for four. Two options, applied on the press:
               a segmented control is exactly that, which is also why the
               language above it stopped being one. -->
          <div class="group">
            <span class="label">{t.prefsTheme}</span>
            <div class="seg" role="group" aria-label={t.prefsTheme}>
              {#each themeOptions as [value, label] (value)}
                <button
                  class="segBtn"
                  class:segBtnActive={themePref.current === value}
                  onclick={() => themePref.set(value)}
                  aria-pressed={themePref.current === value}
                >
                  {label}
                </button>
              {/each}
            </div>
          </div>

          <!-- The one preference that changes what is drawn on another screen.
               Stated as what it does to the code, not as a mode name a player
               would have to guess the effect of. -->
          <div class="group">
            <button
              class="switchRow"
              onclick={() => toggle(!streamer.current, setStreamerMode)}
              role="switch"
              aria-checked={streamer.current}
            >
              <span class="label">{t.prefsStreamer}</span>
              <span class="track" class:trackOn={streamer.current} aria-hidden="true">
                <span class="knob"></span>
              </span>
            </button>
            <p class="hint">{t.prefsStreamerHint}</p>
          </div>

          <!-- The only preference here that changes whether somebody can play at
               all, so it is stated as the game rule it serves. -->
          <div class="group">
            <button
              class="switchRow"
              onclick={() => toggle(!colorAssist.current, setColorAssist)}
              role="switch"
              aria-checked={colorAssist.current}
            >
              <span class="label">{t.prefsColorAssist}</span>
              <span class="track" class:trackOn={colorAssist.current} aria-hidden="true">
                <span class="knob"></span>
              </span>
            </button>
            <p class="hint">{t.prefsColorAssistHint}</p>
          </div>

          <!-- Reachable in-game on purpose: the players who need this are not
               always the ones who thought to look for it before the deal. -->
          <div class="group">
            <button
              class="switchRow"
              onclick={() =>
                // An explicit answer, in both directions: from here on the
                // player's choice wins over the system setting rather than
                // tracking it.
                toggle(!reducedMotion.current, (v) => setMotionPref(v ? 'reduce' : 'full'))}
              role="switch"
              aria-checked={reducedMotion.current}
            >
              <span class="label">{t.prefsMotion}</span>
              <span class="track" class:trackOn={reducedMotion.current} aria-hidden="true">
                <span class="knob"></span>
              </span>
            </button>
            <p class="hint">{t.prefsMotionHint}</p>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    display: flex;
  }

  /* Same chip as the sound and theme buttons: this row is one object. */
  .toggle {
    /* Same chip, same reason: the target grows, the picture does not. */
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--color-surface-card);
    color: var(--color-ink);
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out);
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    line-height: 1;
    flex-shrink: 0;
  }

  .toggle:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 0 var(--color-stroke-soft);
  }
  .toggle:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--color-stroke-soft);
  }

  .panel {
    position: absolute;
    top: calc(100% + 10px);
    /* Anchored on the right, like the sound panel: the cluster sits at the top
       right of every screen, so a left-anchored panel hangs off the page. */
    right: 0;
    width: 250px;
    max-width: calc(100vw - 24px);
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--color-surface-card);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    z-index: 200;
    animation: panelIn 0.22s var(--ease-bounce) both;
    text-align: left;
  }

  @keyframes panelIn {
    from {
      opacity: 0;
      transform: translateY(-8px) scale(0.94);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* What the sheet needs and the dropdown does not. `display: contents` on the
     scrim and the head, so above the phone breakpoint the panel is the anchored
     dropdown it has always been, with the settings as its own children and its own
     `gap` spacing them. Never `display: none` on the scrim — it holds the panel. */
  .scrim,
  .head {
    display: contents;
  }

  .close {
    display: none;
  }

  .title {
    font: 700 12px/1.2 var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--color-muted);
  }

  /* `display: contents` above means the settings are the panel's own children in
     the dropdown, which is what keeps its `gap` doing the spacing. */
  .body {
    display: contents;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }

  .label {
    font: 600 13px/1.2 var(--font-display);
    color: var(--color-ink);
  }

  .hint {
    margin: 0;
    font: 500 11px/1.35 var(--font-body);
    color: var(--color-muted);
  }

  /* A pill of pills: two options, applied on the press, nothing reloaded. The
     language above it is a dropdown and a button precisely because it is *not*
     that kind of choice — it leaves the page. Kept local rather than shared:
     LanguageSwitcher owns its own control and the list of languages with it. */
  .seg {
    display: flex;
    gap: 3px;
    background: var(--color-surface-strong);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-full);
    padding: 3px;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
  }

  .segBtn {
    padding: 5px 12px;
    min-height: 30px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-muted);
    font: 700 13px/1.2 var(--font-display);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
    touch-action: manipulation;
  }

  .segBtn:hover {
    color: var(--color-ink);
  }

  .segBtnActive {
    background: var(--color-surface-card);
    color: var(--color-ink);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  .switchRow {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    /* 44px touch target, like every other control in the game. */
    min-height: 44px;
    padding: 6px 10px;
    border-radius: var(--radius-md);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-strong);
    cursor: pointer;
    touch-action: manipulation;
  }

  .track {
    position: relative;
    width: 42px;
    height: 24px;
    flex-shrink: 0;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-card);
    transition: background 0.15s var(--ease-out);
  }

  .trackOn {
    background: var(--color-primary);
  }

  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: var(--radius-full);
    background: var(--color-surface-card);
    border: var(--stroke-thin) solid var(--color-stroke);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
    transition: transform 0.15s var(--ease-bounce);
  }

  .trackOn .knob {
    transform: translateX(18px);
  }

  /*
   * The phone. A 250px dropdown hanging off a 40px chip is a desktop object: four
   * settings, two of them with a sentence under them, in a column narrower than
   * the thumb opening it — and on the home page the chip is not even there any
   * more, since the drawer's Preferences row is the way in below this width.
   *
   * So it becomes what the rules already are here: a sheet up from the bottom
   * edge, scrim behind it, title and ✕ pinned while the settings scroll. The
   * breakpoint is `content.css`'s, because that is where the drawer takes over.
   */
  @media (max-width: 46rem) {
    /* The panel's parent, not its neighbour: a press inside the sheet cannot
       reach this element at all, which is what makes "click outside" a question
       about the DOM instead of about z-index. See the comment above. */
    .scrim {
      display: flex;
      align-items: flex-end;
      position: fixed;
      inset: 0;
      z-index: 200;
      background: var(--color-scrim);
      backdrop-filter: blur(5px);
    }

    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-base);
      flex-shrink: 0;
      padding: var(--space-base) var(--space-lg);
      border-bottom: var(--stroke-thin) solid var(--color-hairline);
    }

    .title {
      font: 700 20px/1.2 var(--font-display);
      text-transform: none;
      letter-spacing: 0;
      color: var(--color-ink);
    }

    /*
     * A dropdown's sizes on a sheet the height of a phone read as a dropdown
     * that grew a scrim: 13px labels, 11px hints and a 24px switch, all of it
     * aimed at a mouse. This is a full-screen surface driven by a thumb, so the
     * type steps up with it and every switch is a target rather than a detail.
     */
    .label {
      font-size: 15px;
    }

    .hint {
      font: 500 13px/1.4 var(--font-body);
    }

    .seg {
      gap: 4px;
      padding: 4px;
    }

    .segBtn {
      padding: 7px 16px;
      min-height: 40px;
      font-size: 15px;
    }

    .group {
      gap: 8px;
    }

    .switchRow {
      min-height: 56px;
      padding: 10px 14px;
      border-radius: var(--radius-lg);
    }

    .track {
      width: 52px;
      height: 30px;
    }

    .knob {
      top: 3px;
      left: 3px;
      width: 22px;
      height: 22px;
    }

    .trackOn .knob {
      transform: translateX(22px);
    }

    .close {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      /* `.hit-target` positions its 44px pseudo-element absolutely and centres it
         on the nearest positioned ancestor. Without this that ancestor was the
         scrim, so the ✕'s touch area sat in the middle of the screen and swallowed
         every press aimed at a setting — the panel opened and could not be used.
         tokens.css states the requirement; this is the control that forgot it. */
      position: relative;
      width: 40px;
      height: 40px;
      padding: 0;
      border: none;
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--color-ink);
      cursor: pointer;
      touch-action: manipulation;
    }

    .close:hover {
      background: var(--color-surface-strong);
    }

    /* The drawn ✕ grows with the button under it: 17px of stroke in a 40px
       target is a control a thumb has to aim at. */
    .close svg {
      width: 20px;
      height: 20px;
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: 18px;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: var(--space-base) var(--space-lg) calc(var(--space-lg) + var(--safe-bottom));
    }

    /* Static inside the scrim, which is what places it: `position: fixed` on both
       was the arrangement that made this a stacking argument in the first place. */
    .panel {
      position: static;
      width: 100%;
      max-width: none;
      max-height: 92vh;
      padding: 0;
      gap: 0;
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      border: 4px solid var(--color-stroke);
      animation: prefsSheetIn 0.26s var(--ease-bounce) both;
    }

    @keyframes prefsSheetIn {
      from {
        opacity: 0;
        transform: translateY(24px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }

    /* The lobby's gear, where the drawer below the burger already offers these.
       Everywhere else the chip is the only way in and stays at every width. */
    .wrapNoTrigger .toggle {
      display: none;
    }
  }

  :root[data-motion="reduce"] .panel {
    animation: none;
  }

  /* The knob still moves: its position is the state, not decoration. */

  :root[data-motion="reduce"] .knob {
    transition: none;
  }
</style>
