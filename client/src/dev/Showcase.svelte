<script lang="ts">
  /**
   * Visual showcase — dev-only gallery of every screen/state.
   *
   * `?showcase` lists the scenes; `?showcase=<id>` renders one full-screen with no
   * server, no WebSocket and no second player. Used by `tools/visual/shoot.mjs` to
   * capture the entire UI in one pass, and by hand during design work.
   *
   * Tree-shaken from production builds: the only import site is guarded by
   * `import.meta.env.DEV` in entry.ts.
   */
  import { gameStore } from '../hooks/gameStore'
  import { game } from '../hooks/gameStore.svelte'
  import { setStreamerMode } from '../hooks/streamerMode'
  import { setColorAssist } from '../hooks/colorAssist'
  import Lobby from '../components/Lobby.svelte'
  import Searching from '../components/Searching.svelte'
  import MatchFound from '../components/MatchFound.svelte'
  import WaitingRoom from '../components/WaitingRoom.svelte'
  import GameView from '../components/GameView.svelte'
  import GameOver from '../components/GameOver.svelte'
  import Reconnecting from '../components/Reconnecting.svelte'
  import TabTaken from '../components/TabTaken.svelte'
  import RulesModal from '../components/RulesModal.svelte'
  import ColorPicker from '../components/ColorPicker.svelte'
  import PlayerPicker from '../components/PlayerPicker.svelte'
  import ScoreTable from '../components/ScoreTable.svelte'
  import { i18n } from '../i18n/i18n.svelte'
  import CardSheet from './CardSheet.svelte'
  import OgCard from './OgCard.svelte'
  import CoverCard from './CoverCard.svelte'
  import { SCENES, type Scene } from './scenes'

  const noop = () => {}

  const t = $derived(i18n.t)
  const g = $derived(game.current)

  const params = new URLSearchParams(window.location.search)
  const id = params.get('showcase')
  const scene = SCENES.find((s) => s.id === id)
  let ready = $state(false)

  /** Applies a scene's store patch. Relative timers become absolute at apply time. */
  function applyScene(s: Scene) {
    const patch: Record<string, unknown> = {
      // Reset everything a previous scene could have left behind.
      screen: s.screen,
      roomCode: '',
      myIndex: 0,
      myHand: [],
      players: [],
      discard: null,
      activeColor: 'red',
      currentTurn: 0,
      direction: 1,
      pendingDraw: 0,
      hasDrawn: false,
      errorMsg: '',
      unoDeclared: false,
      unoDeclaredByIndex: -1,
      catchTarget: null,
      // The centre button is latched: once awake it stays awake until a card is
      // played, so without this a scene inherits the previous scene's live
      // button and shoots a table nobody is near the finish at with a pressable
      // Catch. Put down here; the store raises it again off this scene's roster.
      catchLive: false,
      unoTimerEnd: null,
      turnDeadline: null,
      showRoundSummary: false,
      roundScores: [],
      roundHistory: [],
      latencies: [],
      swapNotice: null,
      lastPlay: null,
      interruptFlash: null,
      isReconnecting: false,
      matchWinner: '',
      matchOver: false,
      isMatchmade: false,
      forfeitBy: null,
      forfeitedByMe: false,
      opponentAway: null,
      rematchOffers: [],
      rematchNeeded: 0,
      // A scene names its room explicitly; anything else falls back to the
      // built-in felt rather than inheriting the previous scene's map.
      mapId: '',
      mapLoading: null,
      ...(s.state ?? {}),
    }
    // Module state, not store state: reset explicitly so a streamer scene does not
    // leak its blur into every scene captured after it.
    setStreamerMode(s.streamerMode ?? false)
    setColorAssist(s.colorAssist ?? false)
    if (s.deadlineIn !== undefined) patch.turnDeadline = Date.now() + s.deadlineIn * 1000
    if (s.unoIn !== undefined) patch.unoTimerEnd = Date.now() + s.unoIn * 1000
    // Same relative-to-now rule as the two above: an emote carries the instant
    // it arrived, which is the key its pop animation is armed on. Restated from
    // now so the shot catches the bubbles settled rather than mid-flight. The
    // order in the scene is the order they were said in.
    if (Array.isArray(patch.emotes)) {
      const said = patch.emotes as { seat: number; emote: string; at: number }[]
      patch.emotes = said.map((e, i) => ({ ...e, at: Date.now() - (said.length - 1 - i) * 300 }))
    }
    gameStore.setState(patch as never)
  }

  $effect(() => {
    if (scene) applyScene(scene)

    // What App.svelte does for every screen but the lobby, and the showcase does
    // not mount App. Without it `GamePage.astro`'s footer stays up in every
    // captured scene, and its burger — positioned top left, z-index 61 — lands on
    // the round indicator in every board screenshot. The contact sheets are the
    // review tool, so a scene that lies about its own chrome is worse than no
    // scene at all.
    const root = document.documentElement
    if (scene && scene.screen !== 'lobby') root.setAttribute('data-seated', '1')
    else root.removeAttribute('data-seated')

    ready = true
    // Signal to the capture script that the scene is mounted and painted.
    requestAnimationFrame(() => {
      requestAnimationFrame(() =>
        document.documentElement.setAttribute('data-showcase-ready', '1'),
      )
    })
  })
</script>

{#if !scene}
  <!-- Gallery index — deliberately plain: it is a tool, not a screen. -->
  <div class="index">
    <h1>LOCO! · galerie visuelle</h1>
    <p>{SCENES.length} scènes. Chaque lien rend un écran isolé, sans serveur.</p>
    <ul class="list">
      {#each SCENES as s (s.id)}
        <li>
          <a href="?showcase={s.id}">
            <code>{s.id}</code>
            <span>{s.title}</span>
          </a>
        </li>
      {/each}
    </ul>
  </div>
{:else if ready}
  {#if scene.screen === 'cards'}
    <CardSheet />
  {:else if scene.screen === 'og'}
    <OgCard variant={scene.ogVariant ?? 'default'} />
  {:else if scene.screen === 'cover'}
    <CoverCard variant={scene.coverVariant ?? 'duck'} />
  {:else if scene.screen === 'lobby'}
    <Lobby
      onSend={noop}
      onFindMatch={noop}
      onPlayBot={noop}
      error={g.errorMsg}
      playersOnline={g.playersOnline}
      liveStreams={g.liveStreams}
      onClearError={noop}
      initialMode={scene.lobbyMode}
      initialCode={scene.lobbyCode}
      initialPrefsOpen={scene.prefsOpen}
      initialLangOpen={scene.langOpen}
      initialAudioOpen={scene.audioOpen}
    />
  {:else if scene.screen === 'searching'}
    <Searching
      startedAt={Date.now() - (scene.searchingFor ?? 0) * 1000}
      nickname="Nova"
      onCancel={noop}
      onCreateTable={noop}
      playersOnline={g.playersOnline}
    />
  {:else if scene.screen === 'matchfound'}
    <MatchFound
      myNickname="Nova"
      opponentNickname="Kiwi"
      mySeat={0}
      startsAt={Date.now() + 2500}
      format="BO1"
    />
  {:else if scene.screen === 'restoring'}
    <Reconnecting roomCode={g.roomCode} target={g.restoreTarget ?? 'game'} onCancel={noop} />
  {:else if scene.screen === 'tabtaken'}
    <TabTaken seated={scene.otherTabSeated ?? false} onTake={noop} />
  {:else if scene.screen === 'waiting'}
    <WaitingRoom
      roomCode={g.roomCode}
      players={g.players}
      myIndex={g.myIndex}
      matchFormat={g.matchFormat}
      maxPlayers={g.maxPlayers}
      onSend={noop}
      onLeave={noop}
      initialConfirmLeave={scene.confirmLeave}
      initialMenuSeat={scene.rowMenuSeat ?? null}
      initialMenuAsk={scene.rowMenuAsk ?? null}
    />
  {:else if scene.screen === 'game'}
    <GameView
      onSend={noop}
      wsStatus={scene.wsStatus ?? 'open'}
      onLeave={noop}
      initialConfirmLeave={scene.confirmLeave}
    />
  {:else if scene.screen === 'gameover'}
    <GameOver
      winner={g.matchWinner}
      myNickname={g.players.find((p) => p.index === g.myIndex)?.nickname ?? ''}
      scoreboard={g.scoreboard}
      players={g.players}
      matchHistory={g.matchHistory}
      matchOver={g.matchOver}
      isMatchmade={g.isMatchmade}
      isSolo={g.isSolo}
      forfeitBy={g.forfeitBy}
      forfeitedByMe={g.forfeitedByMe}
      mySeat={g.myIndex}
      rematchOffers={g.rematchOffers}
      rematchNeeded={g.rematchNeeded}
      hasTablemates={g.players.some((p) => p.index !== g.myIndex)}
      onRematch={noop}
      onFindMatch={noop}
      onPlayBot={noop}
      onEmote={noop}
      onLeave={noop}
    />
  {/if}

  <!-- The overlays a screen gates behind component-local state, which no scene
       could reach from outside. -->
  {#if scene.overlay === 'rules'}
    <RulesModal onClose={noop} />
  {:else if scene.overlay === 'rules-cards'}
    <RulesModal onClose={noop} tab="cards" />
  {:else if scene.overlay === 'color-picker'}
    <ColorPicker label={t.chooseColor} cancelLabel={t.pickerCancel} onChoose={noop} onCancel={noop} />
  {:else if scene.overlay === 'player-picker'}
    <PlayerPicker
      label={t.choosePlayer}
      cancelLabel={t.pickerCancel}
      cardsLabel={(n) => (n === 1 ? t.swapTargetCardOne : t.swapTargetCards.replace('%n', String(n)))}
      players={g.players.filter((p) => p.index !== g.myIndex)}
      onChoose={noop}
      onCancel={noop}
    />
  {:else if scene.overlay === 'scores' || scene.overlay === 'scores-pinned'}
    <ScoreTable
      players={g.players}
      scoreboard={g.scoreboard}
      roundHistory={g.roundHistory}
      latencies={g.latencies}
      myIndex={g.myIndex}
      {t}
      onDismiss={scene.overlay === 'scores-pinned' ? noop : undefined}
    />
  {/if}
{/if}

<style>
  /* Gallery index — dev-only, deliberately plain: it is a tool, not a screen. */
  .index {
    height: 100%;
    overflow: auto;
    padding: 32px;
    background: var(--color-canvas);
    color: var(--color-ink);
    font-family: var(--font-body);
  }

  .index h1 {
    font-size: 24px;
    margin-bottom: 4px;
  }

  .index p {
    color: var(--color-muted);
    margin-bottom: 20px;
    font-size: 14px;
  }

  .list {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 8px;
  }

  .list a {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--color-hairline);
    border-radius: 10px;
    text-decoration: none;
    color: inherit;
  }

  .list a:hover {
    border-color: var(--color-primary);
  }

  .list code {
    font-size: 12px;
    color: var(--color-primary);
  }

  .list span {
    font-size: 14px;
  }
</style>
