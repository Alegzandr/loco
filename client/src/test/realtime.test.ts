import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from './render'
import { act } from './renderHook'
import GameView from '../components/GameView.svelte'
import { gameStore } from '../hooks/gameStore'
import { reconnectDelay } from '../hooks/webSocketPolicy'
import type { CardDTO } from '../types/protocol'

// LOCO is decided on windows measured in seconds, so anything that silently
// delays or swallows a deliberate input is a rules problem, not a polish one.
// These lock the three places that used to do exactly that.

const red3: CardDTO = { color: 'red', kind: 'number', value: 3 }
const blue7: CardDTO = { color: 'blue', kind: 'number', value: 7 }
const wild: CardDTO = { color: 'wild', kind: 'wild' }
const blueSwap: CardDTO = { color: 'blue', kind: 'swap' }

function seat(index: number, nickname: string, handSize: number) {
  return { index, nickname, hand_size: handSize, connected: true }
}

function renderGame(onSend = vi.fn()) {
  const view = render(GameView, { onSend: onSend, wsStatus: "open" },
  )
  return { onSend, ...view }
}

beforeEach(() => {
  // jsdom measures everything as 0×0; the board (and the hand) renders nothing
  // until elementSize sees a real box.
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 1240, height: 790, top: 0, left: 0, right: 1240, bottom: 790, x: 0, y: 0 }) as DOMRect

  gameStore.setState({
    myIndex: 0,
    myHand: [red3, blue7, wild],
    players: [seat(0, 'Alice', 3), seat(1, 'Bob', 3)],
    discard: red3,
    activeColor: 'red',
    currentTurn: 0,
    direction: 1,
    pendingDraw: 0,
    hasDrawn: false,
    lastPlay: null,
    showRoundSummary: false,
    catchWindows: [],
    // Stated, not assumed: the wager is rationed per board, so a test that left
    // it spent would silently be testing the guard instead of the press.
    catchSpent: false,
  })
})

describe('double-tap guard is per control', () => {
  // Draw, then pass is the single most common sequence in the game, and a
  // player who has just drawn a dead card passes immediately. One shared 400ms
  // lockout swallowed that pass with no feedback at all.
  it('lets a pass through immediately after a draw', () => {
    const { onSend } = renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    // The server's card_drawn is what unlocks Pass; flush it the way React would.
    act(() => gameStore.setState({ hasDrawn: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }))

    const types = onSend.mock.calls.map((c) => c[0].type)
    expect(types).toContain('draw_card')
    expect(types).toContain('pass_turn')
  })

  // The guard still has to do its job: a genuine double-tap on one control is
  // one action, not two.
  it('still swallows a double-tap on the same control', () => {
    const { onSend } = renderGame()
    const draw = screen.getByRole('button', { name: 'Draw' })
    fireEvent.click(draw)
    fireEvent.click(draw)
    expect(onSend.mock.calls.filter((c) => c[0].type === 'draw_card')).toHaveLength(1)
  })

  // A Swap can put two seats on one card at once, so catching the second one
  // right after the first is a legal, deliberate double action.
  it('lets a catch on a second seat through right after the first', () => {
    const now = Date.now()
    gameStore.setState({
      players: [seat(0, 'Alice', 3), seat(1, 'Bob', 1), seat(2, 'Cara', 1)],
      catchWindows: [
        { seat: 1, endsAt: now + 5000 },
        { seat: 2, endsAt: now + 6000 },
      ],
      // The clock the centre button runs on, which card_played would have
      // written from the same list.
      onHookUntil: { 1: now + 5000, 2: now + 6000 },
      // catchTarget / unoTimerEnd are derived from catchWindows by the store's
      // own actions; seeding state directly has to seed the derivation too.
      catchTarget: 1,
      unoTimerEnd: now + 5000,
    })
    const { onSend } = renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'Catch!' }))
    // The first window is retired the way uno_caught would retire it; the
    // button now offers the other seat.
    act(() => gameStore.getState().applyUnoCaught(1))
    fireEvent.click(screen.getByRole('button', { name: 'Catch!' }))

    const targets = onSend.mock.calls
      .filter((c) => c[0].type === 'catch_uno')
      .map((c) => c[0].target_index)
    expect(targets).toEqual([1, 2])
  })

  // A missed Contre-LOCO! costs a card, and the server answers a round trip
  // later. The press is therefore spent on the click, not on the reply: the
  // second tap sends nothing at all, or it would go out naming no seat and the
  // server would read it as a fresh bet against a window that has just shut —
  // a card, charged in the same breath as the catch that landed.
  //
  // And once it is spent with nothing left to aim at, the button says so. The
  // bar must never grey out because the *table* moved — that is the press the
  // price exists to charge for, and hiding it makes the read for the player —
  // but a button that is live over a send the store suppresses is telling the
  // same lie in the other direction. Bob's window is still running here; what
  // is over is our turn at it.
  it('spends the catch wager on press, and goes dead with nothing left to aim at', () => {
    const now = Date.now()
    gameStore.setState({
      players: [seat(0, 'Alice', 3), seat(1, 'Bob', 1)],
      catchWindows: [{ seat: 1, endsAt: now + 5000 }],
      onHookUntil: { 1: now + 5000 },
      catchTarget: 1,
      unoTimerEnd: now + 5000,
    })
    const { onSend } = renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'Catch!' }))
    // The offer itself is untouched: the store still says a seat is near the
    // finish, because it is.
    expect(gameStore.getState().catchLive).toBe(true)
    const catchBtn = screen.getByRole('button', { name: 'Catch!' })
    expect(catchBtn).toBeDisabled()
    fireEvent.click(catchBtn)
    expect(onSend.mock.calls.filter((c) => c[0].type === 'catch_uno')).toHaveLength(1)
  })

  // The other half of the same rule. The button is live from two cards, so a
  // press can still be made on a read rather than on a window — and that read
  // costs a card when it is wrong. Leaning on the button must cost one card,
  // not one per press, which is what the server's "once per offer" says and
  // what this stops us from testing the server's patience about.
  it('sends one blind catch per board, and names no seat when doing it', () => {
    gameStore.setState({
      players: [seat(0, 'Alice', 5), seat(1, 'Bob', 2)],
      catchWindows: [],
    })
    const { onSend } = renderGame()
    const catchBtn = screen.getByRole('button', { name: 'Catch!' })
    expect(catchBtn).toBeEnabled()

    fireEvent.click(catchBtn)
    fireEvent.click(catchBtn)
    fireEvent.click(catchBtn)

    const blind = onSend.mock.calls.filter((c) => c[0].type === 'catch_uno')
    expect(blind).toHaveLength(1)
    expect(blind[0][0].target_index).toBeUndefined()
  })
})

describe('the board animates only a committed play', () => {
  // Flying the card out and snapping it back reads as a bug rather than as
  // "you can't play that", and it costs the player a beat working out which.
  it('does not fly a card the client refuses', () => {
    const { onSend, container } = renderGame()
    act(() => gameStore.setState({ discard: red3, activeColor: 'red' }))
    fireEvent.click(screen.getByRole('button', { name: 'blue number 7' }))
    expect(onSend).not.toHaveBeenCalled()
    expect(container.querySelector('[data-flier-face="face"]')).toBeNull()
  })

  // Tapping a wild only opens the colour prompt: the card has not left the
  // hand, and a cancelled prompt must leave the fan exactly as it was.
  it('does not fly a wild until its colour is named', () => {
    const { container } = renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'wild' }))
    expect(container.querySelector('[data-flier-face="face"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'green' }))
    expect(container.querySelector('[data-flier-face="face"]')).toBeInTheDocument()
  })

  // Swap is a *coloured* card, so it obeys the ordinary matching rules — unlike
  // the three wilds, which always match. Opening its target prompt before
  // checking that made it the one card in the deck whose refusal arrived from
  // the server, after a choice had been made: an off-colour Swap prompted for a
  // seat, flew nothing, and answered with "illegal card play". Every other
  // unplayable card simply ignores the tap.
  it('does not open the swap prompt for an off-colour swap', () => {
    const { onSend } = renderGame()
    act(() =>
      gameStore.setState({ myHand: [blueSwap], discard: red3, activeColor: 'red' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'blue swap' }))
    expect(screen.queryByRole('button', { name: /Bob/ })).toBeNull()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('still opens the swap prompt when the swap is playable', () => {
    const { onSend } = renderGame()
    act(() =>
      gameStore.setState({ myHand: [blueSwap], discard: blue7, activeColor: 'blue' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'blue swap' }))
    expect(screen.getByRole('button', { name: /Bob/ })).toBeInTheDocument()
    expect(onSend).not.toHaveBeenCalled()
  })

  // A prompt is a promise about a board, and it was opened because the card was
  // legal on that board. Only a card landing used to retire it (the lastPlay
  // effect), so every other way the board moves left the prompt up over a table
  // that had gone: the choice then went out against a state the server had
  // already replaced, and came back "illegal card play" after the player had
  // answered a question nobody should have asked.
  it('closes the swap prompt when the turn moves without a card being played', () => {
    const { onSend } = renderGame()
    act(() =>
      gameStore.setState({ myHand: [blueSwap], discard: blue7, activeColor: 'blue' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'blue swap' }))
    expect(screen.getByRole('button', { name: /Bob/ })).toBeInTheDocument()

    // The turn timed out and the server passed for us: card_drawn / turn_changed
    // move the seat on, and neither of them sets lastPlay.
    act(() => gameStore.setState({ currentTurn: 1 }))
    expect(screen.queryByRole('button', { name: /Bob/ })).toBeNull()
    expect(onSend).not.toHaveBeenCalled()
  })

  // Swap and GlobalSwitch are followed by a personalised game_state, so the
  // hand under an open prompt can be replaced wholesale without any card of
  // ours being played.
  it('closes the swap prompt when the card leaves our hand', () => {
    renderGame()
    act(() =>
      gameStore.setState({ myHand: [blueSwap], discard: blue7, activeColor: 'blue' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'blue swap' }))
    expect(screen.getByRole('button', { name: /Bob/ })).toBeInTheDocument()

    act(() => gameStore.setState({ myHand: [blue7] }))
    expect(screen.queryByRole('button', { name: /Bob/ })).toBeNull()
  })

  // The colour prompt answers to the same rule: a wild always matches, so what
  // retires it is losing the turn rather than the colour in play changing.
  it('closes the colour prompt when the turn moves under it', () => {
    renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'wild' }))
    expect(screen.getByRole('button', { name: 'green' })).toBeInTheDocument()

    act(() => gameStore.setState({ currentTurn: 1 }))
    expect(screen.queryByRole('button', { name: 'green' })).toBeNull()
  })

  // The picker is chrome like everything else: it must not hand a French player
  // an English card count. The count was the one string in this dialog written
  // straight into the component, so it stayed English under a French label.
  it('states the target hand size in the player language', () => {
    localStorage.setItem('loco_lang', 'fr')
    try {
      renderGame()
      act(() =>
        gameStore.setState({ myHand: [blueSwap], discard: blue7, activeColor: 'blue' }),
      )
      // The card's accessible name is in the player's language too.
      fireEvent.click(screen.getByRole('button', { name: 'bleu échange' }))
      expect(screen.getByRole('button', { name: /Bob/ })).toHaveTextContent('3 cartes')
    } finally {
      localStorage.removeItem('loco_lang')
    }
  })

  it('flies a legal ordinary play', () => {
    const { onSend, container } = renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'red number 3' }))
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'play_card' }))
    expect(container.querySelector('[data-flier-face="face"]')).toBeInTheDocument()
  })
})

describe('reconnect backoff', () => {
  // A dropped socket is a dead board: no plays land, no interrupt can be won.
  // The first retry has to be inside a single interrupt window, not two
  // seconds later, because most drops come back straight away.
  it('retries almost immediately on the first attempt', () => {
    expect(reconnectDelay(0)).toBeLessThanOrEqual(300)
  })

  it('backs off monotonically and settles on a cap', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 7, 12].map(reconnectDelay)
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1])
    }
    expect(delays[delays.length - 1]).toBe(delays[delays.length - 2])
    // Polite to a server that is genuinely down, and never the recovery path:
    // coming back online, coming back to the tab and pressing the button on the
    // curtain all reconnect on the spot.
    expect(delays[delays.length - 1]).toBeLessThanOrEqual(20000)
  })

  // The schedule does not end, and that is the fix rather than the tuning. Ten
  // attempts ran out at 27.75 s and left the tab on a "Reconnecting…" curtain
  // that would never come down again — while the server was still holding the
  // seat for 60 s, sometimes without having started counting.
  it('never runs out of attempts', () => {
    for (const attempt of [10, 50, 5000]) {
      expect(reconnectDelay(attempt)).toBeGreaterThan(0)
      expect(Number.isFinite(reconnectDelay(attempt))).toBe(true)
    }
  })
})
