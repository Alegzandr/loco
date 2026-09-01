import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from './render'
import { gameStore } from '../hooks/gameStore'
import { dealFor, soundsForTransition } from '../audio/gameSounds'
import { audio, DEFAULT_SETTINGS } from '../audio/engine'
import { playVolumeAudition } from '../audio/sfx'
import AudioSettings from '../components/AudioSettings.svelte'
import { en } from '../i18n/en'

vi.mock('../audio/sfx', () => ({ playSfx: vi.fn(), playVolumeAudition: vi.fn() }))

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

  // The next round is dealt behind the summary card and the turn clock starts
  // with it, so the turn can become ours over a board nobody can see. The cue
  // waits for the card to come down, or it fires into eight seconds of scores.
  it('holds the turn chime behind the round summary and plays it on dismissal', () => {
    const held = soundsForTransition(
      state({ showRoundSummary: true, currentTurn: 1 }),
      state({ showRoundSummary: true, currentTurn: 0 }),
    )
    expect(held).not.toContain('yourTurn')

    const lifted = soundsForTransition(
      state({ showRoundSummary: true, currentTurn: 0 }),
      state({ showRoundSummary: false, currentTurn: 0 }),
    )
    expect(lifted).toContain('yourTurn')

    const notOurs = soundsForTransition(
      state({ showRoundSummary: true, currentTurn: 1 }),
      state({ showRoundSummary: false, currentTurn: 1 }),
    )
    expect(notOurs).not.toContain('yourTurn')
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

  // `unoDeclared` is a latch that stays up under the banner, so a second seat
  // calling it — routine after a Global Switch — moved nothing the old cue
  // watched. The stamp is what changes.
  it('sounds every declaration, not only the first under a banner', () => {
    const first = state({ unoDeclared: true, unoDeclaredByIndex: 1, unoDeclaredAt: 10 })
    const second = state({ unoDeclared: true, unoDeclaredByIndex: 2, unoDeclaredAt: 11 })
    expect(soundsForTransition(state(), first)).toContain('unoDeclare')
    expect(soundsForTransition(first, second)).toContain('unoDeclare')
    expect(soundsForTransition(second, second)).not.toContain('unoDeclare')
  })

  // The deal puts the turn on a seat while the room is still loading, and the
  // number never moves when the table opens: the seat that opens the match
  // still has to hear it.
  it('chimes for the seat that opens the match when the table opens', () => {
    const loading = state({ mapLoading: { ready: [0] }, currentTurn: 0 })
    const open = state({ mapLoading: null, currentTurn: 0 })
    expect(soundsForTransition(loading, open)).toContain('yourTurn')
    expect(soundsForTransition(loading, state({ mapLoading: null, currentTurn: 1 }))).not.toContain('yourTurn')
  })

  it('marks an opponent going quiet, and their return', () => {
    const away = state({ opponentAway: { seat: 1, deadline: 99 } })
    expect(soundsForTransition(state(), away)).toContain('playerAway')
    expect(soundsForTransition(away, away)).not.toContain('playerAway')
    expect(soundsForTransition(away, state({ opponentAway: null }))).toContain('playerJoin')
    const gone = state({ departureNotice: { nickname: 'Kiwi', at: 5 } })
    expect(soundsForTransition(state(), gone)).toContain('playerAway')
  })

  it('never lists the same cue twice in one transition', () => {
    const prev = state({ pendingDraw: 4 })
    const next = state({ pendingDraw: 0, catchFailed: { seat: 0, at: 3 } })
    const out = soundsForTransition(prev, next)
    expect(out.filter((n) => n === 'penalty')).toHaveLength(1)
  })

  it('greets a player joining the lobby', () => {
    const prev = state({ screen: 'waiting', players: [PLAYERS[0]] })
    const next = state({ screen: 'waiting', players: PLAYERS })
    expect(soundsForTransition(prev, next)).toContain('playerJoin')
  })

  it('buzzes on a rejected move', () => {
    expect(soundsForTransition(state(), state({ errorMsg: 'not your turn', errorAt: 1 }))).toContain('error')
  })

  // The toast is already up, so the buzz is the only feedback a second identical
  // refusal gets. Keyed on the stamp, never on the string.
  it('buzzes again on the same refusal repeated', () => {
    const first = state({ errorMsg: 'not your turn', errorAt: 1 })
    const again = state({ errorMsg: 'not your turn', errorAt: 2 })
    expect(soundsForTransition(first, again)).toContain('error')
    expect(soundsForTransition(first, state({ errorMsg: 'not your turn', errorAt: 1 }))).toEqual([])
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

describe('dealFor', () => {
  const hand = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ color: 'red', kind: 'number', value: i }) as const)

  it('counts the first hand of the match', () => {
    expect(dealFor(state({ screen: 'waiting', myHand: [] }), state({ myHand: hand(8) }))).toBe(8)
  })

  // The next round's deal lands under the round summary as a new round number
  // and a hand grown from the one card the last round ended on.
  it('counts every later round too, and drops the draw swish for it', () => {
    const prev = state({ roundNumber: 1, myHand: hand(1) })
    const next = state({ roundNumber: 2, myHand: hand(8) })
    expect(dealFor(prev, next)).toBe(8)
    expect(soundsForTransition(prev, next)).not.toContain('cardDraw')
  })

  it('is not a draw', () => {
    const prev = state({ roundNumber: 1, myHand: hand(3) })
    const next = state({ roundNumber: 1, myHand: hand(4) })
    expect(dealFor(prev, next)).toBe(0)
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
    audio.persistNow()
    expect(JSON.parse(window.localStorage.getItem('loco_audio')!)).toMatchObject({
      music: 0.5,
      muted: true,
    })
  })

  // A slider fires `input` dozens of times a second and `setItem` is
  // synchronous: the write waits for the drag to settle, and the last value is
  // the one that lands. `pagehide` flushes whatever is still pending.
  it('debounces the write to storage and flushes it on pagehide', () => {
    vi.useFakeTimers()
    try {
      audio.persistNow()
      audio.setSettings({ music: 0.1 })
      audio.setSettings({ music: 0.2 })
      audio.setSettings({ music: 0.3 })
      expect(JSON.parse(window.localStorage.getItem('loco_audio')!).music).not.toBe(0.3)
      vi.advanceTimersByTime(300)
      expect(JSON.parse(window.localStorage.getItem('loco_audio')!).music).toBe(0.3)

      audio.setSettings({ music: 0.4 })
      window.dispatchEvent(new Event('pagehide'))
      expect(JSON.parse(window.localStorage.getItem('loco_audio')!).music).toBe(0.4)
    } finally {
      vi.useRealTimers()
    }
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

/**
 * Moving a volume slider auditions the bus, and a drag is not one gesture as
 * far as the DOM is concerned: `input` fires on every step crossed. Played one
 * per event, a 100ms sample overlaps itself several deep and the panel answers
 * with a shrill continuous buzz — the engine's voice budget lets six through a
 * frame, which is well over what it takes to build one.
 *
 * The floor between samples is only bearable because each one carries the level
 * it was taken at, so the drag still reads as a run. Both halves are pinned
 * here; the sound those levels turn into is `make audio-verify`'s.
 */
describe('Auditioning a volume', () => {
  const audition = vi.mocked(playVolumeAudition)

  function slider(label: string) {
    render(AudioSettings)
    fireEvent.click(screen.getByRole('button', { name: en.audioTitle }))
    audition.mockClear()
    return screen.getByRole('slider', { name: label })
  }

  beforeEach(() => {
    audition.mockClear()
  })

  it('plays one sample for a whole drag, not one per step', () => {
    const el = slider(en.audioSfx)
    for (let v = 40; v < 70; v++) fireEvent.input(el, { target: { value: String(v) } })
    // Thirty steps inside the throttle window: the drag is heard, once.
    expect(audition).toHaveBeenCalledTimes(1)
  })

  it('carries the level, so a drag is heard going somewhere', () => {
    fireEvent.input(slider(en.audioMaster), { target: { value: '30' } })
    expect(audition).toHaveBeenCalledWith(0.3)
  })

  it('says nothing on the music bus, which is already audible', () => {
    fireEvent.input(slider(en.audioMusic), { target: { value: '30' } })
    expect(audition).not.toHaveBeenCalled()
  })
})
