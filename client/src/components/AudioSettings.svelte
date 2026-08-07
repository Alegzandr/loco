<script lang="ts">
  import { createSubscriber } from 'svelte/reactivity'
  import { audio } from '../audio/engine'
  import { getTrack, music } from '../audio/music'
  import { playSfx, playVolumeAudition } from '../audio/sfx'
  import { i18n } from '../i18n/i18n.svelte'

  // Live view of the engine's settings, without duplicating them into component
  // state: the bed writes `track` itself on every handover, so this updates when
  // a track ends on its own and not only when the button is pressed.
  const engineSub = createSubscriber((update) => audio.subscribe(update))
  const settings = $derived.by(() => {
    engineSub()
    return audio.getSettings()
  })

  const t = $derived(i18n.t)
  const lang = $derived(i18n.lang)
  const current = $derived(getTrack(settings.track))

  type Props = {
    /**
     * Showcase only: mounts with the panel open, which is otherwise
     * component-local state no scene could reach.
     */
    defaultOpen?: boolean
  }

  let { defaultOpen = false }: Props = $props()

  let open = $state(defaultOpen)
  let wrap = $state<HTMLDivElement | null>(null)

  const BUSES: ['master' | 'sfx' | 'music', () => string][] = [
    ['master', () => t.audioMaster],
    ['sfx', () => t.audioSfx],
    ['music', () => t.audioMusic],
  ]

  function close() {
    open = false
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

  /**
   * Floor between two auditions, in ms.
   *
   * A range input fires `input` on every step it crosses — dozens a second down
   * one drag — and the sample it plays lasts 100ms. One per event, they overlap
   * four and five deep and the panel answers a volume change with a continuous
   * shrill buzz instead of a sample of the bus; the engine's per-frame voice
   * budget is a clipping guard and never saw this, because six voices a frame
   * is far more than enough to build the buzz. Spaced out, the drag reads as a
   * run up or down the travel — which is `playVolumeAudition`'s half of this:
   * a floor between samples is only bearable because each one says where the
   * slider now is, instead of repeating one note until it stops.
   */
  const AUDITION_MS = 130
  let lastAudition = 0

  function setBus(key: 'master' | 'sfx' | 'music', raw: string) {
    const level = Number(raw) / 100
    audio.setSettings({ [key]: level })
    // Audition the change on the bus being moved; the music bed is already
    // audible, so only the effects bus needs a sample.
    if (key === 'music') return
    const now = performance.now()
    if (now - lastAudition < AUDITION_MS) return
    lastAudition = now
    playVolumeAudition(level)
  }
</script>

<!--
  Speaker button that opens a small mixer.

  A game that makes noise must let people turn it off in one click, from every
  screen — so this sits in the same top-right cluster as the gear, and the button
  itself opens the sliders while the panel carries the mute.
-->
<div class="wrap" bind:this={wrap}>
  <button
    class="toggle hit-target"
    onclick={() => {
      void audio.unlock()
      open = !open
    }}
    aria-label={t.audioTitle}
    aria-expanded={open}
  >
    {settings.muted ? '🔇' : '🔊'}
  </button>

  <!--
    Below 46rem this is a sheet rather than a dropdown, for the reason
    `Preferences.svelte` is one: three sliders and a track card in a 292px column
    hanging off a 40px chip is a desktop object, and a volume nobody can set is a
    game nobody can turn down. The two panels open from the same row, so they
    change shape at the same width and into the same thing.

    The scrim *wraps* the panel, never sits beside it: as a sibling, "press
    outside" is a z-index argument, and the phone loses it — every press inside
    the sheet reaches the scrim underneath and shuts the panel.
  -->
  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="scrim"
      onmousedown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div class="panel" role="dialog" aria-label={t.audioTitle}>
        <div class="head">
          <div class="title">{t.audioTitle}</div>
          <button class="close hit-target" onclick={close} aria-label={t.audioClose} title={t.audioClose}>
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

        <!-- Its own scroller on the sheet, `display: contents` in the dropdown,
             where the panel's own gap is what spaces these. -->
        <div class="body">
          {#each BUSES as [key, label] (key)}
            <label class="row">
              <span class="label">{label()}</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="100"
                value={Math.round(settings[key] * 100)}
                oninput={(e) => setBus(key, e.currentTarget.value)}
                aria-label={label()}
              />
              <span class="value">{Math.round(settings[key] * 100)}</span>
            </label>
          {/each}

          <!-- No picker: tracks shuffle and hand over on their own, and the only
               control is "not this one". Choosing from a list would mean reading
               three names to make a decision nobody opened this panel to make. -->
          <div class="tracks">
            <div class="sectionLabel">{t.audioTrack}</div>
            <div class="nowPlaying">
              <span class="trackName">{current.title}</span>
              <span class="trackBlurb">{lang === 'fr' ? current.blurb.fr : current.blurb.en}</span>
            </div>
            <button
              class="nextBtn"
              onclick={() => {
                void audio.unlock()
                music.nextTrack()
                playSfx('uiTap')
              }}
            >
              ⏭ {t.audioNextTrack}
            </button>
          </div>

          <button
            class="muteBtn"
            onclick={() => {
              void audio.unlock()
              audio.toggleMute()
            }}
          >
            {settings.muted ? t.audioUnmute : t.audioMute}
          </button>
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

  .toggle {
    /* The 40px chip is the row's decision (DESIGN.md sizes this cluster), so the
       thumb gets its 44px from `.hit-target` instead of from the paint. */
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--color-surface-card);
    color: var(--color-ink);
    font-size: 15px;
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
    right: 0;
    /* Same width as the preferences panel: the two open from the same row at the
       top right, so a player switching between them must not see the cluster
       change shape. 230px also priced the sliders down to a hairline. */
    width: 292px;
    padding: var(--space-base);
    display: flex;
    flex-direction: column;
    gap: 16px;
    background: var(--color-surface-card);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    z-index: 200;
    animation: panelIn 0.22s var(--ease-bounce) both;
    /* Same reason as the preferences panel: `text-align` inherits from the
       screen this opens over, and the searching screen centres its column. */
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

  /* What the sheet needs and the dropdown does not: above the phone breakpoint
     the scrim, the head and the body are `display: contents`, so the panel keeps
     the anchored dropdown's own children and its own `gap`. Never
     `display: none` on the scrim — it holds the panel. */
  .scrim,
  .head,
  .body {
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

  /* The whole line drives the slider on it, so the line carries the height: a
     10px track between two 8px gaps was a thread to aim at with a mouse and a
     miss with a thumb. */
  .row {
    display: grid;
    grid-template-columns: 74px 1fr 30px;
    align-items: center;
    gap: 10px;
    min-height: 40px;
  }

  .label {
    font: 600 14px/1.2 var(--font-display);
    color: var(--color-ink);
  }

  .value {
    font: 700 13px/1.2 var(--font-display);
    color: var(--color-muted);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* Chunky slider so it matches the rest of the UI in both engines. */
  .slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 14px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-strong);
    cursor: pointer;
    touch-action: manipulation;
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-full);
    background: var(--gradient-primary);
    border: var(--stroke-thin) solid var(--color-stroke);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  .slider::-moz-range-thumb {
    width: 26px;
    height: 26px;
    border-radius: var(--radius-full);
    background: var(--color-primary);
    border: var(--stroke-thin) solid var(--color-stroke);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  /* Two sections, not one list with a line drawn across it. A 2px ink rule inside
     a card that already has a 3px ink outline reads as the panel having been cut
     in half, and it was doing a job space does better: the sliders and the bed are
     told apart by the gap above this block and by the card the track sits in. */
  .tracks {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 2px;
  }

  /* The section's own heading, in the same micro-caps as the panel title: a
     grouping that names itself needs no rule above it. */
  .sectionLabel {
    font: 700 11px/1.2 var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--color-muted);
  }

  .nowPlaying {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-strong);
  }

  .trackName {
    font: 700 14px/1.2 var(--font-display);
    color: var(--color-ink);
  }
  .trackBlurb {
    font: 500 12px/1.4 var(--font-body);
    color: var(--color-muted);
  }

  .nextBtn {
    padding: 10px 14px;
    /* 44px minimum touch target, like every other action in the game. */
    min-height: 46px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-card);
    color: var(--color-ink);
    font: 600 13px/1.2 var(--font-display);
    cursor: pointer;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out);
    touch-action: manipulation;
  }

  .nextBtn:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 0 var(--color-stroke-soft);
  }
  .nextBtn:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--color-stroke-soft);
  }

  .muteBtn {
    padding: 11px 16px;
    min-height: 46px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-strong);
    color: var(--color-ink);
    font: 600 14px/1.2 var(--font-display);
    cursor: pointer;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out);
    touch-action: manipulation;
  }

  .muteBtn:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 0 var(--color-stroke-soft);
  }
  .muteBtn:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--color-stroke-soft);
  }

  /*
   * The phone. Same breakpoint, same sheet and the same reasoning as
   * `Preferences.svelte`: the two panels sit in one row at the top right, so
   * they may not become two different objects when the screen narrows.
   *
   * The sizes go up with the shape. A 14px slider with a 26px thumb is set by a
   * pointer; a thumb needs the track it is dragging to be something it can land
   * on, and the label beside it to be readable while it does.
   */
  @media (max-width: 46rem) {
    /* The panel's parent, not its neighbour: a press inside the sheet cannot
       reach this element at all, which is what makes "press outside" a question
       about the DOM instead of about z-index. */
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

    .close {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      /* `.hit-target` centres its 44px pseudo-element on the nearest positioned
         ancestor. Without this that ancestor is the scrim, and the ✕'s touch area
         sits in the middle of the screen swallowing every press aimed at a
         slider — the same failure `Preferences.svelte` documents. */
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

    .close svg {
      width: 20px;
      height: 20px;
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: 22px;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: var(--space-base) var(--space-lg) calc(var(--space-lg) + var(--safe-bottom));
    }

    /* Static inside the scrim, which is what places it. */
    .panel {
      position: static;
      width: 100%;
      max-width: none;
      max-height: 92vh;
      padding: 0;
      gap: 0;
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      border: 4px solid var(--color-stroke);
      animation: audioSheetIn 0.26s var(--ease-bounce) both;
    }

    @keyframes audioSheetIn {
      from {
        opacity: 0;
        transform: translateY(24px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }

    .row {
      grid-template-columns: 84px 1fr 34px;
      gap: 12px;
      /* The whole line is the label of the slider on it, so it is the line that
         has to be worth aiming at. */
      min-height: 48px;
    }

    .label {
      font-size: 15px;
    }

    .value {
      font-size: 15px;
    }

    .slider {
      height: 16px;
    }

    .slider::-webkit-slider-thumb {
      width: 30px;
      height: 30px;
    }

    .slider::-moz-range-thumb {
      width: 30px;
      height: 30px;
    }

    .tracks {
      gap: 12px;
      margin-top: 6px;
    }

    .sectionLabel {
      font-size: 13px;
    }

    .nowPlaying {
      padding: 12px 16px;
    }

    .trackName {
      font-size: 15px;
    }

    .trackBlurb {
      font-size: 13px;
    }

    .nextBtn,
    .muteBtn {
      min-height: 52px;
      font-size: 15px;
    }
  }

  :root[data-motion="reduce"] .panel {
    animation: none;
  }
</style>
