<script lang="ts">
  import { createSubscriber } from 'svelte/reactivity'
  import { audio } from '../audio/engine'
  import { getTrack, music } from '../audio/music'
  import { playSfx } from '../audio/sfx'
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

  let open = $state(false)
  let wrap = $state<HTMLDivElement | null>(null)

  const BUSES: ['master' | 'sfx' | 'music', () => string][] = [
    ['master', () => t.audioMaster],
    ['sfx', () => t.audioSfx],
    ['music', () => t.audioMusic],
  ]

  $effect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrap && !wrap.contains(e.target as Node)) open = false
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open = false
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  })

  function setBus(key: 'master' | 'sfx' | 'music', raw: string) {
    audio.setSettings({ [key]: Number(raw) / 100 })
    // Audition the change on the bus being moved; the music bed is already
    // audible, so only the effects bus needs a sample.
    if (key !== 'music') playSfx('uiTap')
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

  {#if open}
    <div class="panel" role="dialog" aria-label={t.audioTitle}>
      <div class="title">{t.audioTitle}</div>

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
        <div class="label">{t.audioTrack}</div>
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
    width: 230px;
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--color-surface-card);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    z-index: 200;
    animation: panelIn 0.22s var(--ease-bounce) both;
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

  .title {
    font: 700 12px/1.2 var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--color-muted);
  }

  .row {
    display: grid;
    grid-template-columns: 62px 1fr 26px;
    align-items: center;
    gap: 8px;
  }

  .label {
    font: 600 13px/1.2 var(--font-display);
    color: var(--color-ink);
  }

  .value {
    font: 700 12px/1.2 var(--font-display);
    color: var(--color-muted);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* Chunky slider so it matches the rest of the UI in both engines. */
  .slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 10px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-strong);
    cursor: pointer;
    touch-action: manipulation;
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-full);
    background: var(--gradient-primary);
    border: var(--stroke-thin) solid var(--color-stroke);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  .slider::-moz-range-thumb {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-full);
    background: var(--color-primary);
    border: var(--stroke-thin) solid var(--color-stroke);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  .tracks {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 4px;
    border-top: var(--stroke-thin) solid var(--color-stroke-soft);
  }

  .nowPlaying {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 10px;
    border-radius: var(--radius-md);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-strong);
  }

  .trackName {
    font: 700 13px/1.2 var(--font-display);
    color: var(--color-ink);
  }
  .trackBlurb {
    font: 500 11px/1.3 var(--font-body);
    color: var(--color-muted);
  }

  .nextBtn {
    padding: 8px 12px;
    /* 44px minimum touch target, like every other action in the game. */
    min-height: 44px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-card);
    color: var(--color-ink);
    font: 600 12px/1.2 var(--font-display);
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
    padding: 9px 14px;
    min-height: 40px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-strong);
    color: var(--color-ink);
    font: 600 13px/1.2 var(--font-display);
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

  :root[data-motion="reduce"] .panel {
    animation: none;
  }
</style>
