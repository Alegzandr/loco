import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from './render'
import { act } from './renderHook'
import GameView from '../components/GameView.svelte'
import { gameStore } from '../hooks/gameStore'
import type { CardDTO } from '../types/protocol'

const gs: CardDTO = { color: 'wild', kind: 'global_switch' }
const red3: CardDTO = { color: 'red', kind: 'number', value: 3 }

function seat(index: number, nickname: string, handSize: number) {
  return { index, nickname, hand_size: handSize, connected: true }
}

function renderGame(onSend = vi.fn()) {
  render(GameView, { onSend: onSend, wsStatus: "open" },
  )
  return onSend
}

function seedBoard() {
  // jsdom measures everything as 0×0; the board renders nothing (and so does
  // the hand) until elementSize sees a real box.
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 1240, height: 790, top: 0, left: 0, right: 1240, bottom: 790, x: 0, y: 0 }) as DOMRect

  gameStore.setState({
    myIndex: 0,
    myHand: [gs, red3],
    players: [seat(0, 'Alice', 2), seat(1, 'Bob', 3)],
    discard: red3,
    activeColor: 'red',
    currentTurn: 0,
    direction: 1,
    pendingDraw: 0,
    hasDrawn: false,
    lastPlay: null,
    showRoundSummary: false,
  })
}

// The ring around the felt is the only thing on screen that says which way play
// is moving — a Reverse otherwise only announces itself for the length of one
// callout, and a spectator joining afterwards has no way to know.
describe('GameView — play direction ring', () => {
  beforeEach(seedBoard)

  it('names the clockwise direction on the board', () => {
    renderGame()
    const ring = screen.getByTestId('direction-ring')
    expect(ring).toHaveAttribute('data-direction', 'cw')
    expect(ring).toHaveAccessibleName('Play order: clockwise')
  })

  it('flips with the game direction', () => {
    renderGame()
    act(() => { gameStore.setState({ direction: -1 }) })
    const ring = screen.getByTestId('direction-ring')
    expect(ring).toHaveAttribute('data-direction', 'ccw')
    expect(ring).toHaveAccessibleName('Play order: counter-clockwise')
  })
})

describe('GameView — GlobalSwitch colour choice', () => {
  beforeEach(() => {
    // jsdom measures everything as 0×0; the board renders nothing (and so does
    // the hand) until elementSize sees a real box.
    Element.prototype.getBoundingClientRect = () =>
      ({ width: 1240, height: 790, top: 0, left: 0, right: 1240, bottom: 790, x: 0, y: 0 }) as DOMRect

    gameStore.setState({
      myIndex: 0,
      myHand: [gs, red3],
      players: [seat(0, 'Alice', 2), seat(1, 'Bob', 3)],
      discard: red3,
      activeColor: 'red',
      currentTurn: 0,
      direction: 1,
      pendingDraw: 0,
      hasDrawn: false,
      lastPlay: null,
      showRoundSummary: false,
    })
  })

  // GlobalSwitch is a wild: it rotates the hands *and* sets the colour, so it
  // must prompt exactly like the other two wilds instead of flying out silently.
  it('opens the colour picker instead of playing straight away', () => {
    const onSend = renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'wild global_switch' }))
    expect(screen.getByRole('button', { name: 'green' })).toBeInTheDocument()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('sends the chosen colour with the play', () => {
    const onSend = renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'wild global_switch' }))
    fireEvent.click(screen.getByRole('button', { name: 'green' }))
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'play_card', card: gs, chosen_color: 'green' }),
    )
  })

  // A card landing while the picker is open invalidates the choice: the classic
  // case is somebody interjecting a second GlobalSwitch, which takes the lead
  // and the colour with it. The prompt must close rather than send a play the
  // server is going to refuse.
  it('closes the picker when another card lands', () => {
    renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'wild global_switch' }))
    expect(screen.getByRole('button', { name: 'green' })).toBeInTheDocument()

    act(() => {
      gameStore
        .getState()
        .applyCardPlayed(1, gs, 0, 0, 'blue', [seat(0, 'Alice', 2), seat(1, 'Bob', 2)])
    })
    expect(screen.queryByRole('button', { name: 'green' })).not.toBeInTheDocument()
  })
})
