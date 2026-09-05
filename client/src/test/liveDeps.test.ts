import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from './render'
import { renderHook, act } from './renderHook'
import { autoClear, countdown, reconnectAnimation } from '../hooks/viewEffects.svelte'
import { drainBar } from '../hooks/drainBar.svelte'
import { boardShake, cardPlay } from '../hooks/gamePlay.svelte'
import { gameStore } from '../hooks/gameStore'
import GameView from '../components/GameView.svelte'
import DiscardPile from '../components/cards/DiscardPile.svelte'
import Hand from '../components/cards/Hand.svelte'
import type { CardDTO } from '../types/protocol'

/**
 * Every timing effect in the game watches **one field** of a snapshot that is
 * replaced whole several times a second.
 *
 * `game.current` is a single `$state.raw` holding the entire store, so an effect
 * reading `g.errorMsg` inside it does not depend on the error: it depends on the
 * snapshot, and every message the server sends invalidates it. React compared
 * dependencies by value and re-ran nothing when `errorMsg` was the same string
 * twice; Svelte tracks the signal that was read, so the same code re-runs on
 * every card anybody plays. What that costs is not a re-render, it is the
 * cleanup: a timer that is cleared and re-armed on every message never reaches
 * the end of its own countdown, so a notice sits on a busy board forever and the
 * reconnect overlay outlives the reconnect.
 *
 * Each test below moves a field the hook is not watching and asserts the hook
 * did not notice. That is the shape of every one of these bugs, and it is the
 * one thing the per-hook tests cannot see: they hand a constant or a dedicated
 * prop, which is the case where the snapshot never moves underneath.
 */
describe('a timing effect ignores the fields it does not watch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** The shape of every snapshot below: one watched field, one that just moves. */
  type Snap<T> = { watched: T; tick: number }

  it('autoClear takes a notice down on time while the board keeps moving', () => {
    const clear = vi.fn()
    const { rerender } = renderHook<void, Snap<string>>(
      (p) => autoClear(() => p().watched, 2500, clear),
      { initialProps: { watched: 'illegal card play', tick: 0 } },
    )

    act(() => vi.advanceTimersByTime(1200))
    // Somebody else played a card: a new snapshot, the same refusal on screen.
    rerender({ watched: 'illegal card play', tick: 1 })
    act(() => vi.advanceTimersByTime(1400))

    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('reconnectAnimation lifts the curtain on time while the board keeps moving', () => {
    const done = vi.fn()
    const { result, rerender } = renderHook<{ readonly current: boolean }, Snap<boolean>>(
      (p) => reconnectAnimation(() => p().watched, done),
      { initialProps: { watched: true, tick: 0 } },
    )
    expect(result.current).toBe(true)

    // A reconnect lands as a burst of writes (players, state, seat, screen) and
    // the match carries on underneath. None of them is the flag.
    act(() => vi.advanceTimersByTime(300))
    rerender({ watched: true, tick: 1 })
    act(() => vi.advanceTimersByTime(200))
    rerender({ watched: true, tick: 2 })
    act(() => vi.advanceTimersByTime(200))

    expect(result.current).toBe(false)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('countdown keeps counting the same window down', () => {
    const expire = vi.fn()
    const { result, rerender } = renderHook<{ readonly current: number }, Snap<boolean>>(
      (p) => countdown(() => p().watched, 8000, expire),
      { initialProps: { watched: true, tick: 0 } },
    )

    act(() => vi.advanceTimersByTime(5000))
    expect(result.current).toBe(3)
    rerender({ watched: true, tick: 1 })
    // Still the same three seconds: the summary did not reopen.
    expect(result.current).toBe(3)

    act(() => vi.advanceTimersByTime(3100))
    expect(expire).toHaveBeenCalledTimes(1)
  })

  it('drainBar does not restart a bar that is already draining', () => {
    const node = document.createElement('div')
    const setProperty = vi.spyOn(node.style, 'setProperty')
    const deadline = Date.now() + 30_000

    const { rerender } = renderHook<void, Snap<number>>(
      (p) => drainBar(() => node, () => p().watched, 'auto'),
      { initialProps: { watched: deadline, tick: 0 } },
    )
    expect(setProperty).toHaveBeenCalled()
    setProperty.mockClear()

    rerender({ watched: deadline, tick: 1 })

    // Re-arming would drop the class, force a reflow and start the animation
    // over: the bar visibly jumps back to full on every message.
    expect(setProperty).not.toHaveBeenCalled()
  })

  it('boardShake rattles once per interception, not once per message', () => {
    const node = document.createElement('div')
    const animate = vi.spyOn(node, 'animate')
    const flash = { at: 1000 }

    const { rerender } = renderHook<void, Snap<number>>(
      (p) => boardShake(() => node, () => (p().watched ? flash : null), () => null),
      { initialProps: { watched: 1, tick: 0 } },
    )
    expect(animate).toHaveBeenCalledTimes(1)

    rerender({ watched: 1, tick: 1 })
    rerender({ watched: 1, tick: 2 })

    expect(animate).toHaveBeenCalledTimes(1)
  })

  it('a prompt survives a message that does not move the play behind it', () => {
    const wild: CardDTO = { color: 'wild', kind: 'wild', value: 0 }
    const discard: CardDTO = { color: 'red', kind: 'number', value: 5 }

    const { result, rerender } = renderHook<ReturnType<typeof cardPlay>, Snap<number>>(
      (p) =>
        cardPlay({
          myHand: () => [wild],
          discard: () => discard,
          activeColor: () => 'red',
          currentTurn: () => 0,
          myIndex: () => 0,
          pendingDraw: () => 0,

          interruptOpen: () => true,
          onSend: () => {},
          // A card landed earlier in the round, which is the ordinary case.
          lastPlayAt: () => p().watched,
        }),
      { initialProps: { watched: 1000, tick: 0 } },
    )

    act(() => {
      result.onCardClick(wild, 0)
    })
    expect(result.colorPicker).not.toBeNull()

    // Anything at all: a latency ping, an opponent drawing, a fresh snapshot.
    // The question we asked is still a question.
    act(() => rerender({ watched: 1000, tick: 1 }))

    expect(result.colorPicker).not.toBeNull()
  })
})

/**
 * The same bug one level down, where it is not the store that moves but a prop.
 *
 * A child does not get the dependency narrowing either: Svelte re-runs an effect
 * reading `p.watched` when a *sibling* prop is re-evaluated, even if `watched`
 * came back equal. Every component under `GameView` is handed a dozen props off
 * the same snapshot, so "one message arrived" invalidates all of them at once —
 * and these effects either spawn an animation or hold a timer.
 *
 * The board's older effects already guard on the trigger's timestamp, and the
 * comments say why ("one flight per play, never a replay on resize"). The four
 * below did not.
 */
describe('a component effect ignores the props it does not watch', () => {
  const red7: CardDTO = { color: 'red', kind: 'number', value: 7 }

  beforeEach(() => {
    Element.prototype.getBoundingClientRect = () =>
      ({ width: 1240, height: 790, top: 0, left: 0, right: 1240, bottom: 790, x: 0, y: 0 }) as DOMRect
    gameStore.setState({
      screen: 'game',
      myIndex: 0,
      myHand: [red7],
      players: [
        { index: 0, nickname: 'Alice', hand_size: 1, connected: true },
        { index: 1, nickname: 'Bob', hand_size: 3, connected: true },
      ],
      discard: red7,
      activeColor: 'red',
      currentTurn: 0,
      direction: 1,
      pendingDraw: 0,
      hasDrawn: false,
      lastPlay: null,
      swapNotice: null,
      catchFlash: null,
      showRoundSummary: false,
      turnDeadline: null,
    })
  })

  /** Anything the board does not animate off: one ordinary message landing. */
  const anUnrelatedMessage = (n: number) =>
    act(() => {
      gameStore.setState({ latencies: [{ player_index: 1, rtt_ms: n }] })
    })

  it('draws one swap trail per Échange, not one per message', () => {
    const { container } = render(GameView, { onSend: vi.fn(), wsStatus: 'open' })

    act(() => {
      gameStore.setState({
        swapNotice: { at: 1000, kind: 'swap', actorIndex: 1, targetIndex: 0, direction: 1 },
      })
    })
    const drawn = container.querySelectorAll('.flier').length
    expect(drawn).toBeGreaterThan(0)

    // The notice stays in the store for its whole 3.5s, so every message that
    // arrives while it is up used to spawn the pair of trails again.
    anUnrelatedMessage(1)
    anUnrelatedMessage(2)

    expect(container.querySelectorAll('.flier').length).toBe(drawn)
  })

  it('flies the Contre-LOCO! penalty once, not once per message', () => {
    const { container } = render(GameView, { onSend: vi.fn(), wsStatus: 'open' })

    act(() => {
      gameStore.setState({ catchFlash: { at: 1000, seat: 1 } })
    })
    const drawn = container.querySelectorAll('.flier').length
    expect(drawn).toBeGreaterThan(0)

    anUnrelatedMessage(1)
    anUnrelatedMessage(2)

    expect(container.querySelectorAll('.flier').length).toBe(drawn)
  })

  it('the discard reveals its card on the flight it was staged for', () => {
    vi.useFakeTimers()
    try {
      const { container, rerender } = render(DiscardPile, {
        card: red7,
        activeColor: 'red',
        pendingDraw: 0,
        width: 1240,
        height: 790,
      })
      const blue4: CardDTO = { color: 'blue', kind: 'number', value: 4 }
      act(() => {
        rerender({ card: blue4, activeColor: 'blue', pendingDraw: 0, width: 1240, height: 790 })
      })
      // Messages keep arriving while the card is still crossing the table, which
      // is what a busy board is. Each one cancels the staged reveal, so if the
      // effect re-runs on them the pile waits out a fresh flight every time and
      // never shows the card at all — the one card in the game every legality
      // decision is read off.
      for (let i = 1; i <= 20; i++) {
        act(() => { vi.advanceTimersByTime(50) })
        act(() => {
          rerender({ card: blue4, activeColor: 'blue', pendingDraw: i, width: 1240, height: 790 })
        })
      }

      // The pile shows the card it staged, not the one it replaced.
      expect(container.textContent).toContain('4')
      expect(container.textContent).not.toContain('7')
    } finally {
      vi.useRealTimers()
    }
  })

  it('the discard reveals even when the state is republished under the flight', () => {
    vi.useFakeTimers()
    try {
      render(GameView, { onSend: vi.fn(), wsStatus: 'open' })
      const blue4: CardDTO = { color: 'blue', kind: 'number', value: 4 }
      act(() => { gameStore.setState({ discard: blue4, activeColor: 'blue' }) })

      // An authoritative `game_state` rebuilds the discard object, so the prop
      // changes identity while naming the same card. The reveal is staged on the
      // card's identity, not on the object's, or a board that republishes during
      // a flight never gets to the end of one.
      for (let i = 0; i < 20; i++) {
        act(() => { vi.advanceTimersByTime(50) })
        act(() => { gameStore.setState({ discard: { ...blue4 } }) })
      }

      const pile = document.querySelector('.pile')
      expect(pile?.textContent).toContain('4')
    } finally {
      vi.useRealTimers()
    }
  })

  it('the deal stagger ends even when the hand is re-rendered under it', () => {
    vi.useFakeTimers()
    try {
      const hand: CardDTO[] = Array.from({ length: 8 }, (_, i) => ({
        color: 'red',
        kind: 'number',
        value: i,
      }))
      const props = {
        hand,
        width: 1240,
        height: 790,
        isPlayable: () => false,
        isInteractive: () => false,
        onCardClick: () => {},
      }
      const { container, rerender } = render(Hand, props)
      expect(container.querySelector('.dealing')).not.toBeNull()

      // Re-rendered mid-deal by something that is not the hand. The timer that
      // ends the stagger was cancelled by the re-run and never re-armed, so
      // every card kept its deal delay for the rest of the round.
      act(() => { vi.advanceTimersByTime(200) })
      act(() => { rerender({ ...props, isPlayable: () => true }) })
      act(() => { vi.advanceTimersByTime(5000) })

      expect(container.querySelector('.dealing')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
