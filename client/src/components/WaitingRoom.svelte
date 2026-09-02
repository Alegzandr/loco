<script lang="ts">
  import type { PlayerDTO, ClientMsg, MatchFormat } from '../types/protocol'
  import Backdrop from './Backdrop.svelte'
  import { i18n } from '../i18n/i18n.svelte'
  import RulesButton from './RulesButton.svelte'
  import RulesModal from './RulesModal.svelte'
  import Preferences from './Preferences.svelte'
  import TableCode from './TableCode.svelte'
  import { tableInviteUrl } from '../hooks/tableInvite'
  import AudioSettings from './AudioSettings.svelte'
  import RosterRowMenu from './RosterRowMenu.svelte'
  import { matchLengthLabel } from './matchLengthModel'
  import ServerUpdating from './ServerUpdating.svelte'
  import { game } from '../hooks/gameStore.svelte'
  import { seatColor, seatInitial } from './playerColors'

  type Props = {
    roomCode: string
    players: PlayerDTO[]
    myIndex: number
    matchFormat: MatchFormat
    maxPlayers: number
    onSend: (msg: ClientMsg) => void
    onLeave: () => void
    /**
     * Showcase only: mounts straight into the confirmation, which is otherwise
     * component-local state no scene could reach. Same trick as Lobby's
     * `initialMode`.
     */
    initialConfirmLeave?: boolean
    /**
     * Showcase only, same trick: which row's ⋯ menu is open. The panel is
     * otherwise component-local state, so no scene could photograph it — and it
     * is the one thing on this screen that changes shape between a dropdown and
     * a sheet.
     */
    initialMenuSeat?: number | null
    /** Showcase only: mounts that menu straight into one of its two questions. */
    initialMenuAsk?: 'host' | 'kick' | null
  }

  let {
    roomCode,
    players,
    myIndex,
    matchFormat,
    maxPlayers,
    onSend,
    onLeave,
    initialConfirmLeave = false,
    initialMenuSeat = null,
    initialMenuAsk = null,
  }: Props = $props()

  const MATCH_FORMATS: MatchFormat[] = ['BO1', 'BO3', 'BO5', 'BO7']

  // What each format costs, at this table as it currently stands. Read off the
  // roster rather than off the seat cap: the cap is what the table *could* hold,
  // and the question the host is asking is how long the evening is going to be
  // with the people who are here.
  const formatLength = $derived((f: MatchFormat) =>
    matchLengthLabel(f, players.length, t.matchLengthUnit),
  )

  // Mirrors the server's serverMinPlayers / serverMaxPlayers (game/room.go). A cap
  // of 1 is a room that can never start, so the field must not even offer it.
  const MIN_PLAYERS = 2
  const MAX_PLAYERS = 10

  const t = $derived(i18n.t)
  const isOwner = $derived(myIndex === 0)
  const canStart = $derived(players.length >= 2)

  // Which row's menu is open, by seat. One at a time and held here rather than
  // in the row, because opening a second has to shut the first — two panels
  // over one roster is two answers to a question that has one.
  let openMenu = $state<number | null>(initialMenuSeat)

  // A seat the server plays. It rides the roster because the nickname cannot
  // say it: "Bot1" is a name a player is allowed to take, and the menu offers a
  // control the server refuses on a bot.
  const isBotSeat = (p: PlayerDTO) => p.is_bot === true

  let maxInput = $state(String(maxPlayers))
  let showRules = $state(false)
  let copied = $state(false)
  let confirmLeave = $state(initialConfirmLeave)

  // Escape backs out of the question, like every other dismissible thing here.
  // Bound while the question is up and only then: a listener that outlives it
  // would swallow the key from whatever comes next.
  $effect(() => {
    if (!confirmLeave) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') confirmLeave = false
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // What the press copies is the link, not the six characters. A code has to be
  // read, retyped without a slip and typed into a screen the other person has to
  // find first; a link is a tap. The code itself stays on screen, because it is
  // what gets read out loud on a stream and what somebody already sitting in the
  // lobby types.
  //
  // The link carries no language. It gets forwarded, and the sender does not know
  // who ends up pressing it; the language is whoever opens it to choose.
  //
  // Clipboard is unavailable on insecure origins and in some embedded views;
  // failing silently is correct here — the code stays visible either way.
  let copiedTimer: ReturnType<typeof setTimeout> | null = null
  $effect(() => () => {
    if (copiedTimer !== null) clearTimeout(copiedTimer)
  })
  function copyCode() {
    navigator.clipboard?.writeText(tableInviteUrl(roomCode)).then(
      () => {
        copied = true
        if (copiedTimer !== null) clearTimeout(copiedTimer)
        copiedTimer = setTimeout(() => (copied = false), 1600)
      },
      () => {},
    )
  }

  const FORMAT_LABEL: Record<MatchFormat, string> = $derived({
    BO1: t.bestOf1,
    BO3: t.bestOf3,
    BO5: t.bestOf5,
    BO7: t.bestOf7,
  })

  const minAllowed = $derived(Math.max(MIN_PLAYERS, players.length))

  function handleMaxPlayersChange(val: string) {
    maxInput = val
    const n = parseInt(val, 10)
    if (!isNaN(n) && n >= minAllowed && n <= MAX_PLAYERS) {
      onSend({ type: 'set_max_players', max_players: n })
    }
  }

  // Typing an out-of-range value leaves the field showing something the server
  // never accepted; snapping back on blur is what tells the host the change did
  // not take.
  function handleMaxPlayersBlur() {
    const n = parseInt(maxInput, 10)
    if (isNaN(n) || n < minAllowed || n > MAX_PLAYERS) maxInput = String(maxPlayers)
  }

  // Read through a $derived rather than out of the snapshot inside the markup:
  // `game.current` is replaced whole on every message. See hooks/live.svelte.ts.
  const serverUpdating = $derived(game.current.serverUpdating)
</script>

<div class="container">
  <!-- The room the screen sits in; behind everything, pressable nowhere. -->
  <Backdrop />
  <div class="topBar">
    <Preferences />
    <AudioSettings />
    <RulesButton label={t.rulesHowBtn} variant="text" onclick={() => (showRules = true)} />
  </div>

  <h2 class="heading">{t.waitingRoom}</h2>
  <!-- Tap-to-copy, and what lands in the clipboard is the link. The code is still
       what a stream reads out, so it stays the thing on screen; the press is for
       the other way in, the one nobody has to type. -->
  <button
    class="code"
    onclick={copyCode}
    title={t.copyLink}
    aria-label="{t.roomCode} {roomCode}. {t.copyLink}"
  >
    <span class={copied ? 'copied' : undefined}>{copied ? t.copyCode : t.roomCode}</span>
    <TableCode code={roomCode} class="codeVal" link />
  </button>
  <p class="hint">{t.shareCode}</p>

  <!-- A deploy is under way, so the deal below is going to be refused. Said
       before the host presses it: the alternative is a start button that answers
       "server updating" to a table that was never told a deploy was happening. -->
  {#if serverUpdating}
    <ServerUpdating variant="card" />
  {/if}

  <ul class="playerList">
    {#each players as p (p.index)}
      <!-- The right-click is a shortcut onto the same menu the ⋯ opens, and it
           only exists on a row the host has controls over. `preventDefault` is
           what makes it one: the browser's own menu over a roster row offers
           "copy image address" and nothing this screen means. -->
      <li
        class="player rosterRow"
        oncontextmenu={(e) => {
          if (!isOwner || p.index === myIndex) return
          e.preventDefault()
          openMenu = p.index
        }}
      >
        <span class="playerMain">
          <span class="avatar" style="background: {seatColor(p.index)}" aria-hidden="true">
            {seatInitial(p.nickname)}
          </span>
          <span class="playerName" class:you={p.index === myIndex}>{p.nickname}</span>
        </span>
        {#if p.index === 0}
          <span class="owner">{t.hostBadge}</span>
        {/if}
        <!-- The host's controls over one row, behind one ⋯. Never on their own
             row: giving up the seat you are sitting in is the link at the
             bottom, and neither of these may be able to do it silently.

             One button rather than two icons, because the two are not the same
             kind of press — handing the table over is routine, taking a seat is
             not — and a roster row that carries both in the open is a dense row
             with a destructive target on it. The right-click below opens the
             same menu: a shortcut for whoever looks for one, never the only way
             in. -->
        {#if isOwner && p.index !== myIndex}
          <button
            class="rowMenuBtn"
            aria-label="{t.rowActions}: {p.nickname}"
            aria-haspopup="menu"
            aria-expanded={openMenu === p.index}
            title={t.rowActions}
            onclick={() => (openMenu = openMenu === p.index ? null : p.index)}
          >
            <!-- Drawn, not a glyph: an ellipsis character is a single piece of
                 type that lands on the baseline, where this has to sit on the
                 row's middle. Same rule as the preference icons. -->
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <circle cx="5" cy="12" r="1.9" fill="currentColor" />
              <circle cx="12" cy="12" r="1.9" fill="currentColor" />
              <circle cx="19" cy="12" r="1.9" fill="currentColor" />
            </svg>
          </button>
        {/if}
        {#if openMenu === p.index}
          <RosterRowMenu
            nickname={p.nickname}
            canMakeHost={!isBotSeat(p)}
            initialAsking={initialMenuAsk}
            onmakehost={() => {
              onSend({ type: 'transfer_host', target_index: p.index })
              openMenu = null
            }}
            onkick={() => {
              onSend({ type: 'kick_player', target_index: p.index })
              openMenu = null
            }}
            onclose={() => (openMenu = null)}
          />
        {/if}
      </li>
    {/each}
  </ul>

  {#if isOwner}
    <div class="hostConfig">
      <div class="configRow">
        <label class="configLabel" for="loco-format">{t.matchFormat}</label>
        <div class="formatBtns" id="loco-format">
          {#each MATCH_FORMATS as f (f)}
            <button
              class="formatBtn"
              class:formatBtnActive={matchFormat === f}
              onclick={() => onSend({ type: 'set_match_format', match_format: f })}
            >
              <span>{FORMAT_LABEL[f]}</span>
              <!-- The estimate is inside the button, so the whole promise is the
                   thing being pressed rather than a note beside it. It is a
                   range because the match stops the moment the lead cannot be
                   caught: a best of 7 is four rounds or seven, and a single
                   figure would be wrong at both ends. -->
              <span class="formatLen">{formatLength(f)}</span>
            </button>
          {/each}
        </div>
      </div>
      <div class="configRow">
        <label class="configLabel" for="loco-max-players">{t.maxPlayersLabel}</label>
        <input
          id="loco-max-players"
          type="number"
          min={minAllowed}
          max={MAX_PLAYERS}
          value={maxInput}
          oninput={(e) => handleMaxPlayersChange(e.currentTarget.value)}
          onblur={handleMaxPlayersBlur}
          class="maxInput"
        />
        <!-- The advice existed, in the FAQ and in the rules — which is to say
             nowhere near the control it is about. Quiet is a hue here as
             everywhere else, never an opacity on the ink. -->
        <p class="configHint">{t.maxPlayersHint}</p>
      </div>
    </div>
  {:else}
    <div class="configDisplay">
      <span>{t.matchFormat}: <strong>{FORMAT_LABEL[matchFormat]}</strong></span>
      <span>{t.maxPlayersLabel}: <strong>{maxPlayers}</strong></span>
    </div>
  {/if}

  {#if isOwner}
    <div class="hostActions">
      <button
        class="btnSecondary"
        disabled={players.length >= maxPlayers}
        onclick={() => onSend({ type: 'add_bot' })}
      >
        {t.addBot}
      </button>
      <button class="btn" class:btnArmed={canStart} disabled={!canStart} onclick={() => onSend({ type: 'start_game' })}>
        {canStart ? t.startGame : t.waitingForPlayers}
      </button>
    </div>
  {:else}
    <p class="waitingMsg">{t.waitingForHost}</p>
  {/if}

  <!-- Nothing has been dealt yet, so leaving is free: the server frees the seat on
       the spot instead of holding it 60s the way a closed tab would. Kept quiet on
       purpose — it must never compete with Start.

       It still asks first: the press is one-way, and on this screen it also costs
       the table code, which a guest has no way to get back. The question takes the
       link's place rather than opening over it, so the answer is where the finger
       already is and nothing else on the screen moves. -->
  {#if confirmLeave}
    <div class="leaveConfirm">
      <p class="leaveConfirmMsg">{t.leaveConfirm}</p>
      <div class="leaveConfirmBtns">
        <!-- Staying comes first and is the solid one: the safe answer should be
             the easy one to hit. -->
        <!-- svelte-ignore a11y_autofocus -->
        <button class="leaveStay" onclick={() => (confirmLeave = false)} autofocus>
          {t.leaveConfirmStay}
        </button>
        <button class="leaveGo" onclick={onLeave}>{t.leaveConfirmYes}</button>
      </div>
    </div>
  {:else}
    <button class="leaveBtn" onclick={() => (confirmLeave = true)}>{t.leaveRoom}</button>
  {/if}

  {#if showRules}
    <RulesModal onClose={() => (showRules = false)} />
  {/if}
</div>

<style>
  /* Pre-game room. The room code is the single most-read thing on this screen —
     people say it out loud on stream — so it gets plaque treatment. */

  .container {
    /* A stacking context, so the room behind (Backdrop, z-index -1) paints
       above the canvas and below everything this screen draws. */
    isolation: isolate;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    /* See Lobby.svelte — `safe` prevents the heading being clipped above the
       scroll area once the roster and host panel exceed the viewport. */
    justify-content: safe center;
    height: 100%;
    gap: var(--space-md);
    /* The chip row is absolute, so it reserves no space of its own: the top
       padding is what keeps the heading off it. It has to clear the bottom of a
       40px chip sitting at --space-base, not just look roomy — once the roster
       and the host panel overflow, `safe center` parks the heading against this
       padding and anything shorter puts "The table" under the gear. */
    padding: calc(var(--space-base) + var(--topbar-h) + var(--space-sm) + var(--safe-top))
      calc(var(--space-base) + var(--safe-right)) calc(var(--space-lg) + var(--safe-bottom))
      calc(var(--space-base) + var(--safe-left));
    overflow-y: auto;
    position: relative;
    background: transparent;
    color: var(--color-ink);
    font-family: var(--font-body);
  }

  .topBar {
    position: absolute;
    top: calc(var(--space-base) + var(--safe-top));
    right: calc(var(--space-base) + var(--safe-right));
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    z-index: 5;
  }

  /* The rules opener is <RulesButton />, which carries its own styling: the
     "How to play" pill here, the question-mark chip at the table. */

  .heading {
    font: 700 26px/1.15 var(--font-display);
    color: var(--color-ink);
  }

  /* Room-code plaque */
  .code {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 10px 30px 14px;
    background: var(--color-surface-card);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-hard-lg);
    font: 700 12px/1.3 var(--font-display);
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    text-align: center;
    cursor: pointer;
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out);
  }

  .code:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 0 var(--color-stroke-soft);
  }
  .code:active {
    transform: translateY(3px);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  /* Global because the element wearing it is rendered by <TableCode />, the one
     component allowed to print a table code. */
  .code :global(.codeVal) {
    font: 700 clamp(34px, 8vw, 46px) / 1.1 var(--font-display);
    color: var(--color-primary);
    letter-spacing: 0.14em;
    display: block;
    text-align: center;
    -webkit-text-stroke: 2px var(--color-stroke);
    paint-order: stroke fill;
  }

  .copied {
    color: var(--color-mint);
  }

  .hint {
    font: 500 14px/1.4 var(--font-body);
    color: var(--color-muted);
  }

  .playerList {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 340px;
    max-width: 100%;
  }

  .player {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-md);
    padding: 8px 14px;
    background: var(--color-surface-card);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-full);
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    font: 600 16px/1.3 var(--font-display);
    color: var(--color-ink);
    animation: playerIn 0.32s var(--ease-bounce) both;
  }

  .playerMain {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  /* Initial-letter avatar. Hue is derived from the seat index in the component, so
     the same player keeps the same colour for the whole match. */
  .avatar {
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    display: flex;
    align-items: center;
    justify-content: center;
    font: 700 16px/1 var(--font-display);
    color: var(--color-on-dark);
    text-shadow: 0 1px 2px rgba(20, 8, 45, 0.5);
  }

  .playerName {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @keyframes playerIn {
    from {
      opacity: 0;
      transform: translateY(-8px) scale(0.94);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .you {
    color: var(--color-primary);
    font-weight: 700;
  }

  .owner {
    font: 700 11px/1.2 var(--font-display);
    background: var(--gradient-secondary);
    color: var(--color-on-secondary);
    padding: 4px 10px;
    border-radius: var(--radius-full);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    border: var(--stroke-thin) solid var(--color-stroke);
    flex-shrink: 0;
  }

  /* The row is what the menu is anchored to, so it owns the coordinate space.
     `position: relative` and nothing else — the panel is absolute above 46rem
     and a fixed sheet below it. */
  .rosterRow {
    position: relative;
  }

  /* The host's per-row control. Quiet until it is looked at: it sits on every row
     but one and must never compete with the roster it is attached to. The touch
     target is a full 44px while the ink stays small. */
  .rowMenuBtn {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    margin: -5px -8px -5px 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    border-radius: var(--radius-full);
    color: var(--color-muted);
    cursor: pointer;
    touch-action: manipulation;
    transition:
      color 0.12s var(--ease-out),
      background 0.12s var(--ease-out);
  }

  .rowMenuBtn:hover,
  .rowMenuBtn:focus-visible {
    color: var(--color-primary);
    background: var(--color-surface-strong);
  }

  .btn {
    padding: 14px 30px;
    min-height: 54px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--gradient-primary);
    color: var(--color-on-primary);
    text-shadow: 0 2px 0 rgba(120, 10, 40, 0.4);
    font: 700 19px/1.2 var(--font-display);
    cursor: pointer;
    box-shadow: 0 5px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out),
      filter 0.12s ease;
    touch-action: manipulation;
  }

  .btn:hover:not(:disabled) {
    transform: translateY(-3px);
    box-shadow: 0 8px 0 var(--color-stroke-soft);
    filter: brightness(1.06);
  }
  .btn:active:not(:disabled) {
    transform: translateY(3px);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  .btn:disabled {
    background: var(--color-surface-strong);
    color: var(--color-muted);
    cursor: not-allowed;
    box-shadow: none;
    text-shadow: none;
  }

  .waitingMsg {
    color: var(--color-muted);
    font: 600 15px/1.4 var(--font-body);
  }

  .hostActions {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    align-items: center;
  }

  .btnSecondary {
    padding: 12px 24px;
    min-height: 48px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--color-surface-card);
    color: var(--color-ink);
    font: 600 15px/1.2 var(--font-display);
    cursor: pointer;
    box-shadow: 0 4px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out);
    touch-action: manipulation;
  }

  .btnSecondary:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 6px 0 var(--color-stroke-soft);
  }
  .btnSecondary:active:not(:disabled) {
    transform: translateY(2px);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  /* The same recipe as `.btn:disabled` twenty lines up: a fill swap, a muted
     label and no ledge. It was an opacity, which made the two disabled buttons on
     this one screen two different objects. */
  .btnSecondary:disabled {
    background: var(--color-surface-strong);
    color: var(--color-muted);
    cursor: not-allowed;
    box-shadow: none;
  }

  /* The way out. Underlined text rather than a plaque: it is always available and
     never the thing to press, so it carries no raised-object treatment. */
  .leaveBtn {
    margin-top: var(--space-xs);
    padding: 8px 14px;
    min-height: 40px;
    border: none;
    background: none;
    color: var(--color-muted);
    font: 600 14px/1.2 var(--font-display);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
    touch-action: manipulation;
    transition: color 0.12s var(--ease-out);
  }

  .leaveBtn:hover {
    color: var(--color-ink);
  }

  /* The question, in the link's place. It is allowed to be louder than the link
     was: at this point it is the only thing being asked. */
  .leaveConfirm {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-sm);
    margin-top: var(--space-xs);
    padding: var(--space-sm) var(--space-base);
    background: var(--color-surface-card);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-hard-lg);
    animation: confirmIn 0.18s var(--ease-bounce) both;
  }

  @keyframes confirmIn {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .leaveConfirmMsg {
    font: 700 16px/1.3 var(--font-display);
    color: var(--color-ink);
    text-align: center;
  }

  .leaveConfirmBtns {
    display: flex;
    gap: var(--space-sm);
  }

  .leaveStay,
  .leaveGo {
    padding: 10px 20px;
    min-height: 44px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    font: 700 15px/1.2 var(--font-display);
    cursor: pointer;
    box-shadow: 0 4px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out);
    touch-action: manipulation;
  }

  .leaveStay {
    background: var(--gradient-tertiary);
    color: var(--color-on-dark);
    text-shadow: 0 1px 0 rgba(30, 10, 90, 0.4);
  }

  /* Leaving stays plain: it is the answer that costs something, so it does not get
     the colour that reads as "press me". */
  .leaveGo {
    background: var(--color-surface-strong);
    color: var(--color-body);
  }

  .leaveStay:hover,
  .leaveGo:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 0 var(--color-stroke-soft);
  }
  .leaveStay:active,
  .leaveGo:active {
    transform: translateY(2px);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  :root[data-motion="reduce"] .leaveConfirm {
    animation: none;
  }

  /* Host config panel */
  .hostConfig {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    width: 340px;
    max-width: 100%;
    background: var(--color-surface-card);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-lg);
    padding: var(--space-base) var(--space-lg);
    box-shadow: var(--shadow-hard-lg);
  }

  .configRow {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .configLabel {
    font: 700 12px/1.2 var(--font-display);
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .formatBtns {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .formatBtn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 8px 14px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-strong);
    color: var(--color-ink);
    font: 600 14px/1.2 var(--font-display);
    cursor: pointer;
    min-height: 42px;
    touch-action: manipulation;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out),
      background 0.15s;
  }

  .formatBtn:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 0 var(--color-stroke-soft);
  }
  .formatBtn:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--color-stroke-soft);
  }

  /* The estimate under the label. Never the same weight as the format itself:
     the format is the choice, the minutes are what it costs. */
  .formatLen {
    /* 12px is the floor for anything a spectator has to read, and this was 10.
       The weight already separates it from the format above it. */
    font: 700 12px/1.2 var(--font-display);
    letter-spacing: 0.04em;
    color: var(--color-muted);
  }

  /* Quiet is a hue, never an opacity: the active pill's minutes wore its white
     at 0.75, which on the indigo is a third of the way back to invisible. */
  .formatBtnActive .formatLen {
    color: var(--color-on-dark);
  }

  /* A note under a control, not a label over one. */
  .configHint {
    margin: 0;
    font: 600 12px/1.35 var(--font-body);
    color: var(--color-muted);
  }

  .formatBtnActive {
    background: var(--gradient-tertiary);
    color: var(--color-on-dark);
    text-shadow: 0 1px 0 rgba(30, 10, 90, 0.4);
  }

  .maxInput {
    padding: 10px 14px;
    border-radius: var(--radius-md);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--color-surface-strong);
    color: var(--color-ink);
    font: 700 17px/1.3 var(--font-display);
    width: 90px;
    min-height: 46px;
    box-shadow: inset 0 3px 0 rgba(36, 21, 70, 0.08);
  }

  /* The solid token ring — the same one `Lobby.svelte`'s field wears and the
     reason is written there: with `outline: none` this shadow is the whole
     focus indicator, and the indigo at 0.35 measured 1.5:1. */
  .maxInput:focus {
    outline: none;
    box-shadow:
      inset 0 3px 0 rgba(36, 21, 70, 0.08),
      0 0 0 3px var(--color-tertiary);
  }

  .configDisplay {
    display: flex;
    gap: var(--space-md);
    flex-wrap: wrap;
    justify-content: center;
    color: var(--color-body);
    font: 500 14px/1.4 var(--font-body);
  }

  .configDisplay span {
    padding: 6px 14px;
    background: var(--color-surface-card);
    border: var(--stroke-thin) solid var(--color-stroke);
    border-radius: var(--radius-full);
  }

  @media (max-width: 480px) {
    .hostConfig,
    .playerList {
      width: 100%;
      max-width: 340px;
    }

    .formatBtn {
      flex: 1;
      min-width: 0;
      text-align: center;
      padding: 10px 6px;
    }
  }

  :root[data-motion="reduce"] .player {
    animation: none;
  }

  /* The moment the table can start, the button says so once: a sweep of light
     across it, transform only, and then it waits like any other button. A host
     who looked away from the roster is told by the control they will press. */
  .btnArmed {
    position: relative;
    overflow: hidden;
  }
  .btnArmed::after {
    content: '';
    position: absolute;
    inset: -40% 0;
    width: 36%;
    background: linear-gradient(105deg, transparent 0%, rgba(255, 255, 255, 0.5) 50%, transparent 100%);
    transform: translateX(-180%) skewX(-18deg);
    pointer-events: none;
    animation: startShine 1.1s ease-in-out 0.2s 2 both;
  }
  @keyframes startShine {
    to {
      transform: translateX(380%) skewX(-18deg);
    }
  }
  :root[data-motion='reduce'] .btnArmed::after {
    animation: none;
  }
</style>
