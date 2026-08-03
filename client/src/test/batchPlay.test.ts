import { describe, it, expect, beforeEach } from 'vitest'
import { gameStore, removePlayedCards } from '../hooks/gameStore'
import { CardDTO, PlayerDTO } from '../types/protocol'

const red5: CardDTO = { color: 'red', kind: 'number', value: 5 }
const blue7: CardDTO = { color: 'blue', kind: 'number', value: 7 }
const redSkip: CardDTO = { color: 'red', kind: 'skip' }

function players(mySize: number): PlayerDTO[] {
  return [
    { index: 0, nickname: 'me', hand_size: mySize, connected: true },
    { index: 1, nickname: 'bob', hand_size: 4, connected: true },
  ]
}

beforeEach(() => {
  gameStore.setState({ myIndex: 0, myHand: [], players: players(0), pendingDraw: 0 })
})

describe('removePlayedCards', () => {
  it('drops as many copies as the server took', () => {
    const hand = [red5, blue7, red5, red5, redSkip]
    // Server says 2 cards left, so three copies of the red 5 just went out.
    expect(removePlayedCards(hand, red5, 2)).toEqual([blue7, redSkip])
  })

  it('drops one copy when there is no server hand size to compare against', () => {
    const hand = [red5, red5, blue7]
    expect(removePlayedCards(hand, red5, undefined)).toEqual([red5, blue7])
  })

  it('leaves the hand alone when the server holds more cards than we do', () => {
    const hand = [red5, blue7]
    expect(removePlayedCards(hand, red5, 5)).toBe(hand)
  })

  it('never removes a card of a different kind or colour', () => {
    const hand = [blue7, redSkip]
    // The server claims two cards left; nothing here is the played card, so the
    // hand is untouched rather than trimmed by kind-blind slicing.
    expect(removePlayedCards(hand, red5, 0)).toBe(hand)
  })

  it('keeps the earliest copies so surviving cards keep their identity', () => {
    const a: CardDTO = { color: 'red', kind: 'number', value: 5 }
    const b: CardDTO = { color: 'red', kind: 'number', value: 5 }
    const hand = [a, blue7, b]
    const next = removePlayedCards(hand, red5, 2)
    expect(next[0]).toBe(a)
    expect(next).toHaveLength(2)
  })
})

describe('applyCardPlayed with a batch', () => {
  it('leaves no phantom copies after a batch interrupt', () => {
    gameStore.setState({ myHand: [red5, red5, red5, blue7] })
    // A batch interrupt: the server discarded all three copies at once and
    // reports one card left.
    gameStore
      .getState()
      .applyCardPlayed(0, red5, 1, 0, 'red', players(1), undefined, 1)

    const hand = gameStore.getState().myHand
    expect(hand).toHaveLength(1)
    expect(hand).toEqual([blue7])
  })

  it('still removes exactly one copy on an ordinary play', () => {
    gameStore.setState({ myHand: [red5, red5, blue7] })
    gameStore
      .getState()
      .applyCardPlayed(0, red5, 1, 0, 'red', players(2), undefined, 1)

    expect(gameStore.getState().myHand).toEqual([red5, blue7])
  })

  it('does not touch our hand when somebody else plays', () => {
    const hand = [red5, red5, blue7]
    gameStore.setState({ myHand: hand })
    gameStore
      .getState()
      .applyCardPlayed(1, red5, 0, 0, 'red', players(3), undefined, 1)

    expect(gameStore.getState().myHand).toEqual(hand)
  })
})
