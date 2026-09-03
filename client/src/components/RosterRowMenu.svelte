<script lang="ts">
  import { untrack } from 'svelte'
  import { i18n } from '../i18n/i18n.svelte'
  import { escapeKey } from '../hooks/escapeKey.svelte'

  type Props = {
    nickname: string
    /** A bot can never host the table, so the server refuses it. See hub/rooms.go. */
    canMakeHost: boolean
    onmakehost: () => void
    onkick: () => void
    onclose: () => void
    /** Showcase only: mounts straight into one of the two questions. */
    initialAsking?: 'host' | 'kick' | null
  }

  let { nickname, canMakeHost, onmakehost, onkick, onclose, initialAsking = null }: Props = $props()

  const t = $derived(i18n.t)

  /**
   * The panel is a list until an action is picked, then the question in its
   * place — the same move the quit link makes below the roster, and for the
   * same reason: the answer lands where the finger already is and nothing else
   * on the screen shifts under it.
   *
   * Both actions ask. They are the two presses on this screen that act on
   * another person, neither is undone by pressing again, and on a phone the
   * menu opens under a thumb that was aiming at the row.
   */
  let asking = $state<'host' | 'kick' | null>(untrack(() => initialAsking))

  let panel = $state<HTMLElement | null>(null)

  // Escape backs out one step at a time: the question first, then the menu.
  // Same key, same hook as every other dismissible surface in the game.
  escapeKey(
    () => true,
    () => {
      if (asking) asking = null
      else onclose()
    },
  )

  // A press anywhere else shuts it. `pointerdown` rather than `click` so the
  // menu is gone before the thing underneath reacts, and scoped to the row
  // wrapper so the ⋯ button itself keeps working as a toggle.
  $effect(() => {
    const el = panel
    if (!el) return
    const row = el.closest('.rosterRow')
    const onDown = (e: PointerEvent) => {
      if (row && !row.contains(e.target as Node)) onclose()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  })

  // Opening with the keyboard has to land somewhere. The first item, not the
  // panel: a menu whose focus sits on its own container answers no arrow key
  // and reads as empty.
  $effect(() => {
    if (asking) return
    panel?.querySelector('button')?.focus({ preventScroll: true })
  })
</script>

<!-- Below 46rem the panel is a sheet at the bottom of the screen and this is
     what it sits on. Above it there is no scrim at all: the menu is a dropdown
     anchored to the ⋯ it came out of, and a full-screen veil over a two-item
     list would be the heaviest thing on the page. -->
<div class="scrim" onpointerdown={onclose} aria-hidden="true"></div>

<div class="panel" bind:this={panel}>
  <p class="who">{nickname}</p>

  {#if asking === null}
    <div class="items" role="menu" aria-label="{t.rowActions}: {nickname}">
      {#if canMakeHost}
        <button class="item" role="menuitem" onclick={() => (asking = 'host')}>
          <!-- Drawn, never a glyph: a crown character is a different object on
               every platform, and half of them paint it in colour. Same rule as
               the preference icons. -->
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
            <path
              d="M4 17 L4 8 L9 12 L12 6 L15 12 L20 8 L20 17 Z"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linejoin="round"
            />
          </svg>
          {t.makeHost}
        </button>
      {/if}
      <button class="item danger" role="menuitem" onclick={() => (asking = 'kick')}>
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
          <path
            d="M6 6 L18 18 M18 6 L6 18"
            fill="none"
            stroke="currentColor"
            stroke-width="2.6"
            stroke-linecap="round"
          />
        </svg>
        {t.kickPlayer}
      </button>
    </div>
  {:else}
    <div class="ask">
      <p class="askMsg">
        {asking === 'host' ? t.makeHostConfirm(nickname) : t.kickConfirm(nickname)}
      </p>
      <div class="askBtns">
        <!-- Backing out comes first and is the solid one: the safe answer should
             be the easy one to hit. Same shape as the quit question. -->
        <!-- svelte-ignore a11y_autofocus -->
        <button class="askNo" onclick={() => (asking = null)} autofocus>
          {t.rowActionCancel}
        </button>
        <button class="askYes" onclick={asking === 'host' ? onmakehost : onkick}>
          {asking === 'host' ? t.makeHost : t.kickPlayer}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  /* The dropdown, above 46rem. Anchored to the row it belongs to, which carries
     the `position: relative`. */
  .panel {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 20;
    width: 244px;
    max-width: calc(100vw - 2 * var(--space-base));
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    background: var(--color-surface-card);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-hard-lg);
    animation: menuIn 0.16s var(--ease-bounce) both;
    text-align: left;
  }

  @keyframes menuIn {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* Which row this opened from. The menu can cover the roster on a phone, so
     the name has to be inside it — a question naming somebody you can no longer
     see is a question you cannot answer. */
  .who {
    font: 700 11px/1.2 var(--font-display);
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 2px 8px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .items {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 0 12px;
    min-height: 46px;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-ink);
    font: 600 15px/1.2 var(--font-display);
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
    transition: background 0.12s var(--ease-out);
  }

  .item:hover,
  .item:focus-visible {
    background: var(--color-surface-strong);
  }

  /* Quiet is a hue, never an opacity — and the press that costs something wears
     the one hue on this panel that means it. */
  .danger {
    color: var(--color-primary);
  }

  .ask {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: 4px 8px 6px;
  }

  .askMsg {
    font: 700 15px/1.35 var(--font-display);
    color: var(--color-ink);
  }

  .askBtns {
    display: flex;
    gap: 8px;
  }

  .askNo,
  .askYes {
    flex: 1;
    padding: 8px 12px;
    min-height: 44px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    font: 700 14px/1.2 var(--font-display);
    cursor: pointer;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    touch-action: manipulation;
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out);
  }

  .askNo {
    background: var(--gradient-tertiary);
    color: var(--color-on-dark);
    text-shadow: 0 1px 0 rgba(30, 10, 90, 0.4);
  }

  /* The answer that costs something stays plain: it does not get the colour
     that reads as "press me". Same rule as the quit question. */
  .askYes {
    background: var(--color-surface-strong);
    color: var(--color-body);
  }

  .askNo:hover,
  .askYes:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 0 var(--color-stroke-soft);
  }
  .askNo:active,
  .askYes:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--color-stroke-soft);
  }

  .scrim {
    display: none;
  }

  /* Below 46rem the dropdown becomes a sheet, at the same width and on the same
     row heights as the preferences and audio sheets: same thumb, same reach.
     A 244px panel hanging off a roster row is a desktop object — on a phone it
     lands under the finger that opened it and half of it is off the side. */
  @media (max-width: 46rem) {
    .scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 30;
      background: rgba(20, 8, 45, 0.62);
      animation: scrimIn 0.16s var(--ease-out) both;
    }

    @keyframes scrimIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .panel {
      position: fixed;
      z-index: 31;
      inset: auto 0 0 0;
      top: auto;
      width: 100%;
      max-width: 100%;
      gap: var(--space-xs);
      padding: var(--space-base) var(--space-base)
        calc(var(--space-base) + var(--safe-bottom));
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      border-bottom: none;
      animation: sheetIn 0.2s var(--ease-bounce) both;
    }

    @keyframes sheetIn {
      from {
        transform: translateY(100%);
      }
      to {
        transform: translateY(0);
      }
    }

    .who {
      font-size: 13px;
      padding-bottom: 2px;
    }

    .item {
      min-height: 56px;
      font-size: 15px;
      gap: 12px;
    }

    .askMsg {
      font-size: 17px;
    }

    .askNo,
    .askYes {
      min-height: 50px;
      font-size: 15px;
    }
  }

  :root[data-motion="reduce"] .panel,
  :root[data-motion="reduce"] .scrim {
    animation: none;
  }
</style>
