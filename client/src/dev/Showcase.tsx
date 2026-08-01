/**
 * Visual showcase — dev-only gallery of every screen/state.
 *
 * `?showcase` lists the scenes; `?showcase=<id>` renders one full-screen with no
 * server, no WebSocket and no second player. Used by `tools/visual/shoot.mjs` to
 * capture the entire UI in one pass, and by hand during design work.
 *
 * Tree-shaken from production builds: the only import site is guarded by
 * `import.meta.env.DEV` in main.tsx.
 */
import { useEffect, useState } from 'react'
import { useGameStore } from '../hooks/useGameStore'
import { Lobby } from '../components/Lobby'
import { WaitingRoom } from '../components/WaitingRoom'
import { GameView } from '../components/GameView'
import { GameOver } from '../components/GameOver'
import { Reconnecting } from '../components/Reconnecting'
import { RulesModal } from '../components/RulesModal'
import { ColorPicker } from '../components/ColorPicker'
import { PlayerPicker } from '../components/PlayerPicker'
import { ScoreTable } from '../components/ScoreTable'
import { useI18n } from '../i18n'
import { CardSheet } from './CardSheet'
import { OgCard } from './OgCard'
import { SCENES, Scene } from './scenes'
import styles from './Showcase.module.css'

const noop = () => {}

/** Applies a scene's store patch. Relative timers become absolute at apply time. */
function applyScene(scene: Scene) {
  const patch: Record<string, unknown> = {
    // Reset everything a previous scene could have left behind.
    screen: scene.screen,
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
    // A scene names its room explicitly; anything else falls back to the
    // built-in felt rather than inheriting the previous scene's map.
    mapId: '',
    mapLoading: null,
    ...(scene.state ?? {}),
  }
  if (scene.deadlineIn !== undefined) patch.turnDeadline = Date.now() + scene.deadlineIn * 1000
  if (scene.unoIn !== undefined) patch.unoTimerEnd = Date.now() + scene.unoIn * 1000
  useGameStore.setState(patch as never)
}

function SceneOverlayEl({ scene }: { scene: Scene }) {
  const { t } = useI18n()
  const players = useGameStore((s) => s.players)
  const myIndex = useGameStore((s) => s.myIndex)
  switch (scene.overlay) {
    case 'rules':
      return <RulesModal onClose={noop} />
    case 'color-picker':
      return <ColorPicker label={t.chooseColor} onChoose={noop} onCancel={noop} />
    case 'player-picker':
      return (
        <PlayerPicker
          label={t.choosePlayer}
          cardsLabel={(n) =>
            n === 1 ? t.swapTargetCardOne : t.swapTargetCards.replace('%n', String(n))
          }
          players={players.filter((p) => p.index !== myIndex)}
          onChoose={noop}
          onCancel={noop}
        />
      )
    case 'scores':
      return <ScoresOverlay />
    default:
      return null
  }
}

/** The TAB standings, which GameView gates behind component-local state. */
function ScoresOverlay() {
  const { t } = useI18n()
  const players = useGameStore((s) => s.players)
  const myIndex = useGameStore((s) => s.myIndex)
  const scoreboard = useGameStore((s) => s.scoreboard)
  const roundHistory = useGameStore((s) => s.roundHistory)
  const latencies = useGameStore((s) => s.latencies)
  return (
    <ScoreTable
      players={players}
      scoreboard={scoreboard}
      roundHistory={roundHistory}
      latencies={latencies}
      myIndex={myIndex}
      t={t}
    />
  )
}

function SceneScreen({ scene }: { scene: Scene }) {
  const players = useGameStore((s) => s.players)
  const myIndex = useGameStore((s) => s.myIndex)
  const roomCode = useGameStore((s) => s.roomCode)
  const matchFormat = useGameStore((s) => s.matchFormat)
  const maxPlayers = useGameStore((s) => s.maxPlayers)
  const errorMsg = useGameStore((s) => s.errorMsg)
  const matchWinner = useGameStore((s) => s.matchWinner)
  const matchOver = useGameStore((s) => s.matchOver)
  const restoreTarget = useGameStore((s) => s.restoreTarget)
  const scoreboard = useGameStore((s) => s.scoreboard)

  switch (scene.screen) {
    case 'cards':
      return <CardSheet />
    case 'og':
      return <OgCard />
    case 'lobby':
      return <Lobby onSend={noop} error={errorMsg} onClearError={noop} initialMode={scene.lobbyMode} />
    case 'restoring':
      return <Reconnecting roomCode={roomCode} target={restoreTarget ?? 'game'} onCancel={noop} />
    case 'waiting':
      return (
        <WaitingRoom
          roomCode={roomCode}
          players={players}
          myIndex={myIndex}
          matchFormat={matchFormat}
          maxPlayers={maxPlayers}
          onSend={noop}
        />
      )
    case 'game':
      return <GameView onSend={noop} wsStatus={scene.wsStatus ?? 'open'} />
    case 'gameover':
      return (
        <GameOver
          winner={matchWinner}
          myNickname={players.find((p) => p.index === myIndex)?.nickname ?? ''}
          scoreboard={scoreboard}
          matchOver={matchOver}
          isHost={myIndex === 0}
          onSend={noop}
        />
      )
  }
}

function SceneIndex() {
  return (
    <div className={styles.index}>
      <h1>LOCO · galerie visuelle</h1>
      <p>
        {SCENES.length} scènes. Chaque lien rend un écran isolé, sans serveur.
      </p>
      <ul className={styles.list}>
        {SCENES.map((s) => (
          <li key={s.id}>
            <a href={`?showcase=${s.id}`}>
              <code>{s.id}</code>
              <span>{s.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Showcase() {
  const params = new URLSearchParams(window.location.search)
  const id = params.get('showcase')
  const scene = SCENES.find((s) => s.id === id)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (scene) applyScene(scene)
    setReady(true)
    // Signal to the capture script that the scene is mounted and painted.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => document.documentElement.setAttribute('data-showcase-ready', '1'))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!scene) return <SceneIndex />
  if (!ready) return null

  return (
    <>
      <SceneScreen scene={scene} />
      <SceneOverlayEl scene={scene} />
    </>
  )
}
