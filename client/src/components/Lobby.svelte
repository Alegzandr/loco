<script lang="ts">
  import type { ClientMsg } from '../types/protocol'
  import { i18n } from '../i18n/i18n.svelte'
  import { resolveServerError } from '../i18n/serverErrors'
  import RulesButton from './RulesButton.svelte'
  import RulesModal from './RulesModal.svelte'
  import Preferences from './Preferences.svelte'
  import AudioSettings from './AudioSettings.svelte'
  import LocoLogo from './LocoLogo.svelte'
  import { playSfx } from '../audio/sfx'
  import { readNickname, rememberNickname } from '../hooks/nicknameMemory'
  import { canonicalNickname, isNicknameShapeValid } from './nicknameRules'
  import { TABLE_CODE_LENGTH, isTableCodeValid, sanitizeTableCode } from './tableCodeRules'

  type LobbyMode = 'home' | 'find' | 'bot' | 'create' | 'join'

  type Props = {
    onSend: (msg: ClientMsg) => void
    /**
     * Enters the 1v1 queue. Separate from onSend because the search screen is
     * entered optimistically, before the server has acknowledged anything.
     */
    onFindMatch: (nickname: string) => void
    /**
     * Deals a 1v1 against the server. Separate from onSend for the same reason
     * onFindMatch is: the caller records the nickname before anything is sent,
     * and this mode has no message in front of the deal to carry it.
     */
    onPlayBot: (nickname: string) => void
    error: string
    onClearError: () => void
    /**
     * Starting sub-screen. Set by the visual showcase, and by a table link, which
     * opens straight on the join form.
     */
    initialMode?: LobbyMode
    /**
     * The table code a shared link arrived with. A prefill for the field, not a
     * submission: the form still refuses to send without a nickname, and the
     * server still owns the verdict on the code.
     */
    initialCode?: string
    /** Showcase only: mounts with the preferences panel open. */
    initialPrefsOpen?: boolean
    /** Showcase only: mounts with the language list open inside that panel. */
    initialLangOpen?: boolean
    /** Showcase only: mounts with the sound panel open. */
    initialAudioOpen?: boolean
  }

  let {
    onSend,
    onFindMatch,
    onPlayBot,
    error,
    onClearError,
    initialMode = 'home',
    initialCode = '',
    initialPrefsOpen = false,
    initialLangOpen = false,
    initialAudioOpen = false,
  }: Props = $props()

  const t = $derived(i18n.t)

  // Read once, at setup: the field is the player's from then on, and re-reading
  // storage would fight whatever they are typing.
  let nickname = $state(readNickname())
  // Read once, like the nickname: from here on the field belongs to the player,
  // and a link that has been spent must not put its code back.
  let roomCode = $state(sanitizeTableCode(initialCode))
  let mode = $state<LobbyMode>(initialMode)
  let showRules = $state(false)
  // The shape rules the client can check itself, answered as the player types
  // rather than after a round trip. It says nothing the server would not have
  // said: the same one line, for the same reason (server/game/nickname.go).
  let nicknameRefused = $state(false)

  // Whether the field holds something that could seat a player. The rules behind
  // it are deliberately the loosest the seat label can survive (one readable
  // character, up to 20, an alphabet that renders): this greys the button, and a
  // greyed button is the one refusal a player cannot argue with, so it may only
  // ever answer shape. The word list stays on the server and comes back as an
  // error line, because shipping it here would mean downloading a few thousand
  // slurs to say the same sentence a fraction of a second earlier.
  const nicknameOk = $derived(isNicknameShapeValid(nickname))

  // The field itself, so a refusal can hand it back. Only one form is mounted at
  // a time, so one reference covers all three.
  let nicknameField = $state<HTMLInputElement | null>(null)

  /**
   * A refusal about the name puts the player back in the field, with what they
   * typed selected so the next keystroke replaces it. This is where the word
   * list lands: it is not something the button can grey out, because the client
   * does not carry the list, so the seat is refused at the moment the player
   * asks for it and the answer is "pick another name", already focused.
   */
  $effect(() => {
    if (!nicknameRejection(error)) return
    nicknameField?.focus()
    nicknameField?.select()
  })

  /** The server refusals that are about the name and nothing else. */
  function nicknameRejection(msg: string): boolean {
    return /nickname/i.test(msg)
  }

  function editNickname(value: string) {
    nickname = value
    nicknameRefused = value.trim() !== '' && !isNicknameShapeValid(value)
    onClearError()
  }

  /** Guards every entry point. Returns the form to send, or '' to refuse. */
  function acceptNickname(): string {
    if (!isNicknameShapeValid(nickname)) {
      nicknameRefused = nickname.trim() !== ''
      return ''
    }
    const value = canonicalNickname(nickname)
    rememberNickname(value)
    return value
  }

  // Leaving a sub-screen gets the descending blip; entering one is silent because
  // the screen change is already obvious.
  function goHome() {
    playSfx('uiBack')
    mode = 'home'
  }

  function handleFind(e: SubmitEvent) {
    e.preventDefault()
    const value = acceptNickname()
    if (!value) return
    onFindMatch(value)
  }

  // The same form as the queue's, and deliberately the same shape of act: a
  // name and one press. What it skips is the wait, not a step.
  function handlePlayBot(e: SubmitEvent) {
    e.preventDefault()
    const value = acceptNickname()
    if (!value) return
    onPlayBot(value)
  }

  function handleCreate(e: SubmitEvent) {
    e.preventDefault()
    const value = acceptNickname()
    if (!value) return
    onSend({ type: 'create_room', nickname: value })
  }

  function handleJoin(e: SubmitEvent) {
    e.preventDefault()
    const value = acceptNickname()
    if (!value || !isTableCodeValid(roomCode)) return
    onSend({ type: 'join_room', nickname: value, room_code: sanitizeTableCode(roomCode) })
  }
</script>

<div class="container">
  <div class="topBar">
    <!-- The one screen where the gear stands down on a phone: this is the only
         screen the home page's burger is on, and its drawer carries a Preferences
         row already. Everywhere past a taken seat that drawer is gone with the
         footer, so the chip stays at every width there. -->
    <Preferences
      defaultOpen={initialPrefsOpen}
      defaultLangOpen={initialLangOpen}
      triggerBelowPhone={false}
    />
    <AudioSettings defaultOpen={initialAudioOpen} />
    <RulesButton label={t.rulesHowBtn} variant="text" onclick={() => (showRules = true)} />
  </div>

  <!-- The mark, not the page's heading. `GamePage.astro` serves the one top-level
       heading this document has, in text, before any of this mounts; wrapping a
       logotype in a second one gave `/` two headings that both said "LOCO" and
       neither of which said what the page was. -->
  <div class="title">
    <LocoLogo size="clamp(58px, 11vw, 128px)" animated />
  </div>
  <p class="tagline">{t.tagline}</p>

  <!-- An alert, not a control: it announces itself to assistive tech and clears
       as soon as the player edits the field it is complaining about, so it never
       needed to be clickable to be dismissible. Styling it as a filled pill the
       same size as the CTA below made it read as a third button on the screen. -->
  {#if nicknameRefused || error}
    <p class="error" role="alert">
      {nicknameRefused ? t.errors.nicknameRejected : resolveServerError(error, t.errors)}
    </p>
  {/if}

  {#if mode === 'home'}
    <div class="buttonGroup">
      <!-- One player, one button, one opponent. It leads because it is the only
           entry point that needs nobody else to be organised, and it carries the
           game's hue for that reason. The two table buttons underneath stay
           equally weighted between themselves: neither of them is a fallback for
           the other. -->
      <button class="btn" onclick={() => (mode = 'find')}>
        {t.findMatch}
        <span class="btnHint">{t.findMatchHint}</span>
      </button>
      <!-- An entry point like the other three, drawn like the other three. It
           sits under the queue because it is the same offer with the wait taken
           out — no code, no waiting room, nothing to set, a hand on the press —
           and it is the quietest fill of the four so the human queue is still
           the one being led with. Underlined text between two ledged buttons
           read as a footnote nobody pressed. -->
      <button class="btn btnBot" onclick={() => (mode = 'bot')}>{t.playBot}</button>
      <button class="btn btnAlt" onclick={() => (mode = 'create')}>{t.createRoom}</button>
      <button class="btn btnJoin" onclick={() => (mode = 'join')}>{t.joinRoom}</button>
    </div>
  {/if}

  {#if mode === 'find'}
    <form class="form" onsubmit={handleFind}>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="input"
        bind:this={nicknameField}
        placeholder={t.yourNickname}
        value={nickname}
        oninput={(e) => editNickname(e.currentTarget.value)}
        maxlength="20"
        autofocus
      />
      <!-- Nothing to send without a name on the seat. Same guard on all three
           forms: the button is off until the field holds a nickname the client
           can already see is usable. -->
      <button class="btn" type="submit" disabled={!nicknameOk}>{t.findMatchGo}</button>
      <button class="btnSecondary" type="button" onclick={goHome}>{t.back}</button>
    </form>
  {/if}

  {#if mode === 'bot'}
    <form class="form" onsubmit={handlePlayBot}>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="input"
        bind:this={nicknameField}
        placeholder={t.yourNickname}
        value={nickname}
        oninput={(e) => editNickname(e.currentTarget.value)}
        maxlength="20"
        autofocus
      />
      <button class="btn" type="submit" disabled={!nicknameOk}>{t.playBotGo}</button>
      <button class="btnSecondary" type="button" onclick={goHome}>{t.back}</button>
    </form>
  {/if}

  {#if mode === 'create'}
    <form class="form" onsubmit={handleCreate}>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="input"
        bind:this={nicknameField}
        placeholder={t.yourNickname}
        value={nickname}
        oninput={(e) => editNickname(e.currentTarget.value)}
        maxlength="20"
        autofocus
      />
      <button class="btn" type="submit" disabled={!nicknameOk}>{t.createGame}</button>
      <button class="btnSecondary" type="button" onclick={goHome}>{t.back}</button>
    </form>
  {/if}

  {#if mode === 'join'}
    <form class="form" onsubmit={handleJoin}>
      <!-- A returning player already has a name in the field, so the caret
           belongs on the one thing they still have to type. -->
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="input"
        bind:this={nicknameField}
        placeholder={t.yourNickname}
        value={nickname}
        oninput={(e) => editNickname(e.currentTarget.value)}
        maxlength="20"
        autofocus={!nickname}
      />
      <!-- The field only ever holds a possible code: the alphabet is the server's
           (tableCodeRules.ts), and anything else is dropped as it is typed or
           pasted rather than kept for the server to refuse. -->
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="input"
        placeholder={t.roomCodeLabel}
        value={roomCode}
        oninput={(e) => {
          roomCode = sanitizeTableCode(e.currentTarget.value)
          e.currentTarget.value = roomCode
          onClearError()
        }}
        maxlength={TABLE_CODE_LENGTH}
        autofocus={!!nickname && !roomCode}
        inputmode="text"
        autocapitalize="characters"
        autocorrect="off"
        spellcheck="false"
      />
      <!-- Nothing to take a seat at until the name and the code are both whole.
           The button says so instead of sending a request whose only outcome is an
           error line under a form the player has not finished filling in. -->
      <button class="btn" type="submit" disabled={!nicknameOk || !isTableCodeValid(roomCode)}>
        {t.joinGame}
      </button>
      <button class="btnSecondary" type="button" onclick={goHome}>{t.back}</button>
    </form>
  {/if}

  <!-- Privacy and terms are not here any more: they are a page, linked at the
       right-hand end of the footer this screen sits above (GamePage.astro). A
       policy has to be linkable, and the entry screen is the one screen that
       footer is visible on anyway. -->

  {#if showRules}
    <RulesModal onClose={() => (showRules = false)} />
  {/if}
</div>

<style>
  /* Entry screen. First impression of the game, so the logo is a physical object
     with depth and the two CTAs are unmistakably pressable. */

  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    /* `safe` keeps overflowing content anchored to the top instead of centring it
       out of the scroll area, where the first rows become unreachable. */
    justify-content: safe center;
    height: 100%;
    overflow-y: auto;
    padding: calc(var(--space-lg) + var(--safe-top)) calc(var(--space-base) + var(--safe-right))
      calc(var(--space-lg) + var(--safe-bottom)) calc(var(--space-base) + var(--safe-left));
    gap: var(--space-lg);
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
  }

  /* The rules opener is <RulesButton />, which carries its own styling: the
     "How to play" pill here, the question-mark chip at the table. */

  /* The wordmark and its treatment live in <LocoLogo />, which the waiting room
     and the game-over card share. All this owns is the space around it. */
  .title {
    margin-bottom: -2px;
  }

  /* The tagline belongs to the wordmark, not to the buttons. At the container's
     own gap it sat equidistant from both and read as a third floating object;
     pulling it up binds the pair into one lockup and leaves a clear step down to
     the controls. */
  .tagline {
    margin-top: -10px;
    color: var(--color-body);
    font: 700 13px/1.3 var(--font-display);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    padding: 7px 16px;
    background: var(--color-surface-card);
    border: var(--stroke-thin) solid var(--color-stroke);
    border-radius: var(--radius-full);
    box-shadow: 0 3px 0 var(--color-stroke-soft);
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    /* Grows with the room. A fixed 320px column on a 1440px monitor reads as a
       phone layout that was never given a desktop, and it is what left the entry
       screen looking mostly empty. */
    width: clamp(320px, 28vw, 400px);
  }

  .input {
    padding: 14px 18px;
    border-radius: var(--radius-md);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--color-surface-card);
    color: var(--color-ink);
    font: 600 17px/1.4 var(--font-body);
    height: 56px;
    outline: none;
    box-shadow: inset 0 3px 0 rgba(36, 21, 70, 0.08);
    transition: box-shadow 0.15s ease;
  }

  .input:focus {
    box-shadow:
      inset 0 3px 0 rgba(36, 21, 70, 0.08),
      0 0 0 4px rgba(108, 92, 255, 0.35);
  }

  /* The placeholder is the only instruction this field ever gives, so it is held
     at the same contrast as the rest of the quiet copy rather than at the next
     step down. */
  .input::placeholder {
    color: var(--color-muted);
    font-weight: 500;
  }

  .buttonGroup {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    /* Same reason as the form above. */
    width: clamp(320px, 28vw, 400px);
  }

  .btn {
    width: 100%;
    padding: 14px 24px;
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

  /* The two table entry points under the 1v1 button: equal weight between
     themselves, each with its own hue so neither reads as the other's fallback.
     Both classes are applied in the markup rather than `composes: btn`, which is
     a CSS Modules directive with no Svelte equivalent. */
  .btnAlt {
    background: var(--gradient-secondary);
    color: var(--color-on-secondary);
    text-shadow: none;
  }

  .btnJoin {
    background: var(--gradient-tertiary);
    text-shadow: 0 2px 0 rgba(30, 16, 90, 0.4);
  }

  /* The 1v1 button carries a second line: "find an opponent" says nothing about
     what a player is signing up for, and "one round against a stranger, right
     now" is the entire pitch of the mode. Stacked inside the button rather than
     set beneath it so the whole promise is the thing being pressed. */
  .btn:has(.btnHint) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding-top: 11px;
    padding-bottom: 11px;
  }

  .btnHint {
    font: 600 12px/1.2 var(--font-display);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.85;
    text-shadow: none;
  }

  /* The bot button: the same object as the three above it — same height, same
     outline, same ledge — with the only neutral fill on the screen. Hierarchy
     is carried by the hue, so the mode nobody has to be organised for is still
     the loudest and this one still stands down, without stopping being a
     button. */
  .btnBot {
    background: var(--color-surface-card);
    color: var(--color-ink);
    text-shadow: none;
  }

  /* Back / cancel — deliberately quiet so it never competes with the submit. */
  .btnSecondary {
    width: 100%;
    padding: 12px 24px;
    min-height: 48px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--color-surface-card);
    color: var(--color-ink);
    font: 600 16px/1.2 var(--font-display);
    cursor: pointer;
    box-shadow: 0 4px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out);
    touch-action: manipulation;
  }

  .btnSecondary:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 0 var(--color-stroke-soft);
  }
  .btnSecondary:active {
    transform: translateY(2px);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  /* A refusal, not an action. Every pressable object on this screen is a vertical
     gradient with a 5px ledge; the alert is deliberately *flat* with a shallower
     ledge, so it reads as a label stuck on the page rather than as a third button
     between the logo and the CTA. The glyph carries the meaning for anyone who
     cannot rely on the colour alone. */
  .error {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin: 0;
    background: var(--color-error);
    border: var(--stroke-thin) solid var(--color-stroke);
    border-radius: var(--radius-md);
    padding: 10px 18px;
    color: var(--color-on-dark);
    max-width: 340px;
    text-align: left;
    text-wrap: balance;
    font: 600 15px/1.35 var(--font-body);
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    animation: errorShake 0.4s ease-out;
  }

  .error::before {
    content: '!';
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-full);
    background: #fff;
    color: var(--color-error);
    font: 700 15px/1 var(--font-display);
  }

  @keyframes errorShake {
    0%,
    100% {
      transform: translateX(0);
    }
    20% {
      transform: translateX(-7px);
    }
    45% {
      transform: translateX(6px);
    }
    70% {
      transform: translateX(-3px);
    }
  }

  @media (max-width: 480px) {
    .form {
      width: 90vw;
      max-width: 340px;
    }

    .buttonGroup {
      width: 90vw;
      max-width: 340px;
    }
  }

  :root[data-motion="reduce"] .error {
    animation: none;
  }
</style>
