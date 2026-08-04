<script lang="ts">
  import { i18n } from '../i18n/i18n.svelte'
  import { escapeKey } from '../hooks/escapeKey.svelte'
  import Card from './cards/Card.svelte'
  import { CARD_CATALOGUE } from './cardCatalogue'

  type Tab = 'rules' | 'cards'
  /** `tab` is the tab it opens on, which only the dev gallery ever sets. */
  type Props = { onClose: () => void; tab?: Tab }
  let { onClose, tab: initialTab = 'rules' }: Props = $props()

  const t = $derived(i18n.t)

  const TABS: readonly Tab[] = ['rules', 'cards']
  // Read once on purpose: which tab it opens on is a starting position, and a
  // gallery scene changing it under a player mid-read would be the bug.
  // svelte-ignore state_referenced_locally
  let tab = $state<Tab>(initialTab)
  let body = $state<HTMLDivElement | null>(null)
  let tabEls = $state<(HTMLButtonElement | null)[]>([])

  const label = (id: Tab) => (id === 'rules' ? t.rulesTabRules : t.rulesTabCards)

  // The two panels share one scroller, so a player who read the rules to the
  // bottom and then asked for the cards would land halfway down a grid they had
  // never seen. The jump is instant — the scroller carries no `scroll-behavior`
  // for that reason: animating it scrolls the outgoing panel up the card while
  // the new one is arriving, which is two movements for one press.
  function select(next: Tab) {
    if (next === tab) return
    tab = next
    if (body) body.scrollTop = 0
  }

  // Arrows on the tab row, which is the focused-control path the accessibility
  // rule keeps: you have to have got here first. Nothing global, nothing that
  // plays a card — see `noKeyboardShortcuts.test.ts`.
  function onTabKey(e: KeyboardEvent) {
    const from = TABS.indexOf(tab)
    let to = from
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (from + 1) % TABS.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (from - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = TABS.length - 1
    else return
    e.preventDefault()
    select(TABS[to])
    tabEls[to]?.focus()
  }

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

    <!--
      Two halves, because this modal answers two questions and only one of them
      is the rulebook. "What happens now" is read mid-round; "what is this card"
      is read before the first deal by somebody who knows a card game of colours
      and symbols and has never seen a Swap or a Global Switch. A bullet naming
      one asks them to picture it; the face lets them recognise it in their hand.
    -->
    <div class="tabs" role="tablist" aria-label={t.rulesTitle}>
      {#each TABS as id, i (id)}
        <button
          class="tab"
          class:on={tab === id}
          role="tab"
          id="rulesTab-{id}"
          aria-selected={tab === id}
          aria-controls="rulesPanel-{id}"
          tabindex={tab === id ? 0 : -1}
          bind:this={tabEls[i]}
          onclick={() => select(id)}
          onkeydown={onTabKey}
        >
          {label(id)}
        </button>
      {/each}
    </div>

    <!-- One scroller for both panels: the card is a fixed height and a second
         scrolling box inside it would be a scrollbar over a scrollbar. -->
    <div
      class="body"
      bind:this={body}
      role="tabpanel"
      id="rulesPanel-{tab}"
      aria-labelledby="rulesTab-{tab}"
      tabindex="0"
    >
      <!-- The panel arrives, it does not cut. The wrapper is mounted fresh on
           every switch, so the fade is one CSS animation and no state: opacity
           only, because the card is already the size it will stay and anything
           that slides would move the copy a player is reading towards. -->
      {#if tab === 'rules'}
        <div class="panel">
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
      {:else}
        <div class="panel">
          <p class="lede">{t.rulesCardsLede}</p>
          <ul class="deck">
            {#each CARD_CATALOGUE as card (card.kind)}
              <li class="entry">
                <!-- The game's own card, at the size a hand is read at. Nothing
                     here is a picture of a card: it is the card. -->
                <div class="face"><Card {card} shadow style="width:72px;height:108px" /></div>
                <div class="entryText">
                  <h3 class="cardName">{t.cardNames[card.kind]}</h3>
                  <p class="cardBrief">{t.cardBriefs[card.kind]}</p>
                </div>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>

    <div class="footer">
      <!--
        No way out to the deck page from here. This modal opens mid-match and a
        link, even in a new tab, is an invitation to leave the table: the one
        thing to press here is Close. The deck is why the Cards tab draws the
        faces in place rather than pointing at `/cards/`, which is the long
        catalogue and not what somebody standing at a table came for.
      -->
      <button class="footerClose" onclick={onClose}>{t.rulesClose}</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    /* This opens over whatever screen asked for it, and `text-align` inherits
       straight through a fixed child: the searching screen centres its column,
       so the whole rulebook arrived centred there and nowhere else. An overlay
       reads the same from every screen or it is a different panel each time. */
    text-align: left;
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
    /* A height, not just a ceiling. The two panels are nothing like the same
       length, so a card sized to its contents resized under the tab row on
       every press: the header, the tabs and the footer all jumped, and the
       control that had just been pressed moved out from under the pointer. A
       fixed box makes the switch a change of contents and nothing else. */
    height: min(88vh, 640px);
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

  /* Grouped by space, like every other panel in the game: the header's hairline
     is already there and a second rule under the tabs would cut the card in
     three. The selected tab says so with ink and a bar of its own. */
  .tabs {
    display: flex;
    gap: var(--space-sm);
    padding: var(--space-base) var(--space-lg) 0;
    flex-shrink: 0;
  }

  .tab {
    position: relative;
    min-height: var(--touch-target);
    padding: 0 var(--space-base) 10px;
    background: transparent;
    border: none;
    color: var(--color-muted);
    font: 700 15px/1 var(--font-display);
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .tab::after {
    content: '';
    position: absolute;
    left: var(--space-sm);
    right: var(--space-sm);
    bottom: 2px;
    height: 3px;
    border-radius: var(--radius-full);
    background: transparent;
  }

  .tab.on {
    color: var(--color-ink);
  }

  .tab.on::after {
    background: var(--color-primary);
  }

  .body {
    overflow-y: auto;
    padding: var(--space-lg);
    flex: 1;
    -webkit-overflow-scrolling: touch;
  }

  .panel {
    animation: panelIn 0.18s var(--ease-out) both;
  }

  @keyframes panelIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* The panel scrolls, so it is reachable from the keyboard and says where it
     is when it gets there. */
  .body:focus-visible {
    outline: var(--stroke) solid var(--color-primary);
    outline-offset: -4px;
  }

  .lede {
    margin: 0 0 var(--space-base);
    color: var(--color-muted);
    font: 500 14px/1.5 var(--font-body);
  }

  .deck {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
    gap: var(--space-base);
  }

  .entry {
    display: flex;
    align-items: flex-start;
    gap: var(--space-base);
  }

  .face {
    flex-shrink: 0;
  }

  .entryText {
    min-width: 0;
  }

  .cardName {
    font: 700 16px/1.2 var(--font-display);
    color: var(--color-ink);
    margin: 2px 0 4px;
  }

  .cardBrief {
    margin: 0;
    color: var(--color-body);
    font: 500 14px/1.5 var(--font-body);
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
      height: 92vh;
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    }

    .header {
      padding: var(--space-base) var(--space-lg);
    }

    .title {
      font-size: 18px;
    }

    .tabs {
      padding: var(--space-sm) var(--space-lg) 0;
    }

    .body {
      padding: var(--space-base) var(--space-lg);
    }

    /* One column, and the faces stay the size they are: a card shrunk to fit a
       phone is a card nobody would recognise back in their hand. */
    .deck {
      grid-template-columns: 1fr;
    }

    .footer {
      padding: var(--space-md) var(--space-lg);
    }

    .footerClose {
      width: 100%;
      text-align: center;
    }
  }

  :root[data-motion="reduce"] .modal,
  :root[data-motion="reduce"] .panel {
    animation: none;
  }
</style>
