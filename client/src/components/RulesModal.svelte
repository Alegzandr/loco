<script lang="ts">
  import { i18n } from '../i18n/i18n.svelte'
  import { escapeKey } from '../hooks/escapeKey.svelte'

  type Props = { onClose: () => void }
  let { onClose }: Props = $props()

  const t = $derived(i18n.t)

  escapeKey(() => true, () => onClose())

  // The board behind this is a fixed coordinate space and the modal has its own
  // scroller; letting the document scroll under it moves the table out from
  // behind the panel and leaves the player looking at felt.
  $effect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  })
</script>

<!-- The keyboard way out is the Escape above; the pressable ones are the ✕ and
     the footer button. Tapping the backdrop is the third, mouse-only route. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="backdrop"
  onclick={onClose}
  role="dialog"
  aria-modal="true"
  aria-label={t.rulesTitle}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="header">
      <h2 class="title">{t.rulesTitle}</h2>
      <button class="closeBtn" onclick={onClose} aria-label={t.rulesClose}>✕</button>
    </div>

    <div class="body">
      {#each t.rules as section (section.heading)}
        <section class="section">
          <h3 class="sectionHeading">{section.heading}</h3>
          <ul class="list">
            {#each section.items as item, i (i)}
              <li class="listItem">{item}</li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>

    <div class="footer">
      <!--
        No way out to the deck page from here. This modal opens mid-match and a
        link, even in a new tab, is an invitation to leave the table: the one
        thing to press here is Close.
      -->
      <button class="footerClose" onclick={onClose}>{t.rulesClose}</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--color-scrim);
    backdrop-filter: blur(5px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: calc(var(--space-base) + var(--safe-top)) calc(var(--space-base) + var(--safe-right))
      calc(var(--space-base) + var(--safe-bottom)) calc(var(--space-base) + var(--safe-left));
  }

  .modal {
    background: var(--color-surface-card);
    border: 4px solid var(--color-stroke);
    border-radius: var(--radius-xl);
    width: 100%;
    max-width: 680px;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-pop);
    font-family: var(--font-body);
    animation: rulesIn 0.32s var(--ease-bounce) both;
  }

  @keyframes rulesIn {
    from {
      opacity: 0;
      transform: translateY(24px) scale(0.94);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-lg) var(--space-lg) var(--space-base);
    border-bottom: var(--stroke-thin) solid var(--color-hairline);
    flex-shrink: 0;
  }

  .title {
    font: 700 24px/1.2 var(--font-display);
    color: var(--color-ink);
    margin: 0;
  }

  .closeBtn {
    background: transparent;
    border: none;
    color: var(--color-ink);
    font-size: 20px;
    cursor: pointer;
    padding: var(--space-sm);
    border-radius: var(--radius-full);
    transition: background 0.15s;
    line-height: 1;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .closeBtn:hover {
    background: var(--color-surface-strong);
  }

  .body {
    overflow-y: auto;
    padding: var(--space-lg);
    flex: 1;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
  }

  /* The scrollbar itself is styled globally in tokens.css. */

  .section {
    margin-bottom: var(--space-lg);
  }

  .section:last-child {
    margin-bottom: 0;
  }

  .sectionHeading {
    font: 700 17px/1.25 var(--font-display);
    color: var(--color-ink);
    margin: 0 0 var(--space-sm);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .listItem {
    position: relative;
    padding-left: 20px;
    color: var(--color-body);
    font: 500 15px/1.55 var(--font-body);
  }

  .listItem::before {
    content: '';
    position: absolute;
    left: 4px;
    top: 0.55em;
    width: 6px;
    height: 6px;
    background: var(--color-primary);
    border-radius: var(--radius-full);
  }

  .footer {
    padding: var(--space-base) var(--space-lg);
    border-top: var(--stroke-thin) solid var(--color-hairline);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--space-base);
    /* One control, and it sits where the eye leaves the list. */
    justify-content: flex-end;
  }

  .footerClose {
    padding: 12px 26px;
    min-height: 48px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--color-surface-strong);
    color: var(--color-ink);
    font: 600 16px/1.2 var(--font-display);
    cursor: pointer;
    box-shadow: 0 4px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out);
    touch-action: manipulation;
  }

  .footerClose:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 0 var(--color-stroke-soft);
  }
  .footerClose:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--color-stroke-soft);
  }

  @media (max-width: 480px) {
    .backdrop {
      padding: 0;
      align-items: flex-end;
    }

    .modal {
      max-height: 92vh;
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    }

    .header {
      padding: var(--space-base) var(--space-lg);
    }

    .title {
      font-size: 18px;
    }

    .body {
      padding: var(--space-base) var(--space-lg);
    }

    .footer {
      padding: var(--space-md) var(--space-lg);
    }

    .footerClose {
      width: 100%;
      text-align: center;
    }
  }

  :root[data-motion="reduce"] .modal {
    animation: none;
  }
</style>
