import { describe, it, expect, beforeEach } from 'vitest'
import { gameStore } from '../hooks/gameStore'
import { soundsForTransition } from '../audio/gameSounds'
import { audio, DEFAULT_SETTINGS } from '../audio/engine'

type State = ReturnType<typeof gameStore.getState>

const PLAYERS = [
  { index: 0, nickname: 'Nova', hand_size: 5, connected: true },
  { index: 1, nickname: 'Kiwi', hand_size: 3, connected: true },
]

function state(patch: Partial<State> = {}): State {
  return {
    ...gameStore.getState(),
    screen: 'game',
    myIndex: 0,
    players: PLAYERS,
    ...patch,
  } as State
}

describe('soundsForTransition', () => {
  it('is silent when nothing changed', () => {
    const s = state()
    expect(soundsForTransition(s, s)).toEqual([])
  })

  it('plays the card swish plus a sting for a special card', () => {
    const prev = state()
    const next = state({
      lastPlay: { actorIndex: 1, card: { color: 'red', kind: 'skip' }, at: 1 },
    })
    expect(soundsForTransition(prev, next)).toEqual(['cardPlay', 'skip'])
  })

  it('plays only the swish for a plain number card', () => {
    const prev = state()
    const next = state({
      lastPlay: { actorIndex: 1, card: { color: 'red', kind: 'number', value: 5 }, at: 1 },
    })
    expect(soundsForTransition(prev, next)).toEqual(['cardPlay'])
  })

  it('leads with the slam when an interception happens', () => {
    const prev = state()
    const next = state({
      interruptFlash: { actorIndex: 1, count: 2, at: 7 },
      lastPlay: { actorIndex: 1, card: { color: 'red', kind: 'number', value: 5 }, at: 7 },
    })
    // The steal must be heard before the card it stole with.
    expect(soundsForTransition(prev, next)).toEqual(['interrupt', 'cardPlay'])
  })

  // The `unoCaught` voice shipped in sfx.ts and nothing ever played it: the
  // catch had no sound of its own, only the two cards the victim drew, which is
  // the sound of somebody taking an ordinary turn.
  it('stings when a Contre-LOCO! lands', () => {
    const prev = state()
    const next = state({ catchFlash: { seat: 1, at: 9 } })
    expect(soundsForTransition(prev, next)).toContain('unoCaught')
  })

  it('does not replay the catch sting while the same catch is on screen', () => {
    const flash = { seat: 1, at: 9 }
    expect(soundsForTransition(state({ catchFlash: flash }), state({ catchFlash: flash }))).toEqual([])
  })

  it('does not replay a card sound when only the timestamp is unchanged', () => {
    const play = { actorIndex: 1, card: { color: 'red' as const, kind: 'skip' as const }, at: 4 }
    expect(soundsForTransition(state({ lastPlay: play }), state({ lastPlay: play }))).toEqual([])
  })

  it('reports a draw when any hand grows', () => {
    const prev = state()
    const next = state({
      players: [PLAYERS[0], { ...PLAYERS[1], hand_size: 5 }],
    })
    expect(soundsForTransition(prev, next)).toContain('cardDraw')
  })

  it('announces a growing stack once, not twice', () => {
    const prev = state({ pendingDraw: 2 })
    const next = state({
      pendingDraw: 4,
      lastPlay: { actorIndex: 1, card: { color: 'blue', kind: 'draw_two' }, at: 2 },
    })
    const out = soundsForTransition(prev, next)
    expect(out.filter((n) => n === 'drawStack')).toHaveLength(1)
  })

  it('plays the penalty when a stack is finally eaten', () => {
    const out = soundsForTransition(state({ pendingDraw: 6 }), state({ pendingDraw: 0 }))
    expect(out).toContain('penalty')
  })

  it('chimes when the turn comes back to us, not when it leaves', () => {
    expect(soundsForTransition(state({ currentTurn: 1 }), state({ currentTurn: 0 }))).toContain('yourTurn')
    expect(soundsForTransition(state({ currentTurn: 0 }), state({ currentTurn: 1 }))).not.toContain('yourTurn')
  })

  it('distinguishes winning a round from losing one', () => {
    const prev = state()
    const win = state({ showRoundSummary: true, roundWinner: 'Nova' })
    const lose = state({ showRoundSummary: true, roundWinner: 'Kiwi' })
    expect(soundsForTransition(prev, win)).toContain('roundWin')
    expect(soundsForTransition(prev, lose)).toContain('roundLose')
  })

  it('distinguishes winning the match from losing it', () => {
    const prev = state()
    const win = state({ screen: 'gameover', matchWinner: 'Nova' })
    const lose = state({ screen: 'gameover', matchWinner: 'Kiwi' })
    expect(soundsForTransition(prev, win)).toContain('matchWin')
    expect(soundsForTransition(prev, lose)).toContain('matchLose')
  })

  it('greets a player joining the lobby', () => {
    const prev = state({ screen: 'waiting', players: [PLAYERS[0]] })
    const next = state({ screen: 'waiting', players: PLAYERS })
    expect(soundsForTransition(prev, next)).toContain('playerJoin')
  })

  it('buzzes on a rejected move', () => {
    expect(soundsForTransition(state(), state({ errorMsg: 'not your turn' }))).toContain('error')
  })

  // The end of the one wait in the game somebody spends minutes on, and it used
  // to be the only screen change in the whole app that made no sound at all.
  it('announces the opponent the queue just found', () => {
    const prev = state({ screen: 'searching' })
    const next = state({ screen: 'matchfound' })
    expect(soundsForTransition(prev, next)).toContain('matchFound')
    // And exactly once: the reveal counts down for several seconds, and every
    // store tick through it is another transition into the same screen.
    expect(soundsForTransition(next, next)).not.toContain('matchFound')
  })
})

describe('audio settings', () => {
  beforeEach(() => {
    window.localStorage.clear()
    audio.setSettings(DEFAULT_SETTINGS)
  })

  it('clamps volumes into 0..1', () => {
    audio.setSettings({ master: 5, sfx: -3 })
    expect(audio.getSettings().master).toBe(1)
    expect(audio.getSettings().sfx).toBe(0)
  })

  it('persists across engine reads', () => {
    audio.setSettings({ music: 0.5, muted: true })
    expect(JSON.parse(window.localStorage.getItem('loco_audio')!)).toMatchObject({
      music: 0.5,
      muted: true,
    })
  })

  it('toggles mute both ways', () => {
    audio.setSettings({ muted: false })
    audio.toggleMute()
    expect(audio.getSettings().muted).toBe(true)
    audio.toggleMute()
    expect(audio.getSettings().muted).toBe(false)
  })

  it('defaults music below effects so the bed never covers the game', () => {
    expect(DEFAULT_SETTINGS.music).toBeLessThan(DEFAULT_SETTINGS.sfx)
  })
})
