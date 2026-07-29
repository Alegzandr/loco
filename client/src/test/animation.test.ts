import { describe, it, expect } from 'vitest'
import { handCardKeys } from '../components/cards/layout'
import { radToDeg } from '../components/cards/cardTheme'
import { useGameStore } from '../hooks/useGameStore'
import { CardDTO, PlayerDTO } from '../types/protocol'

describe('handCardKeys', () => {
  it('gives distinct cards distinct keys', () => {
    const keys = handCardKeys([
      { color: 'red', kind: 'number', value: 5 },
      { color: 'blue', kind: 'skip' },
    ])
    expect(new Set(keys).size).toBe(2)
  })

  it('disambiguates duplicate cards by occurrence', () => {
    const keys = handCardKeys([
      { color: 'red', kind: 'number', value: 5 },
      { color: 'red', kind: 'number', value: 5 },
      { color: 'red', kind: 'number', value: 5 },
    ])
    expect(new Set(keys).size).toBe(3)
  })

  it('keeps the keys of untouched cards stable when one is played', () => {
    const hand: CardDTO[] = [
      { color: 'red', kind: 'number', value: 5 },
      { color: 'blue', kind: 'skip' },
      { color: 'green', kind: 'draw_two' },
    ]
    const before = handCardKeys(hand)
    // Play the middle card; the survivors must keep their identity so the fan
    // slides into the gap instead of remounting every slot.
    const after = handCardKeys([hand[0], hand[2]])
    expect(after).toEqual([before[0], before[2]])
  })

  it('distinguishes a number card from an action card of the same colour', () => {
    const keys = handCardKeys([
      { color: 'red', kind: 'number', value: 0 },
      { color: 'red', kind: 'skip' },
    ])
    expect(keys[0]).not.toBe(keys[1])
  })
})

describe('radToDeg', () => {
  it('converts the layout angles framer-motion expects in degrees', () => {
    expect(radToDeg(0)).toBe(0)
    expect(radToDeg(Math.PI)).toBeCloseTo(180)
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90)
    expect(radToDeg(-0.12)).toBeCloseTo(-6.875, 3)
  })
})

describe('lastPlay', () => {
  const players: PlayerDTO[] = [
    { index: 0, nickname: 'Alice', hand_size: 5, connected: true },
    { index: 1, nickname: 'Bob', hand_size: 5, connected: true },
  ]
  const card: CardDTO = { color: 'red', kind: 'skip' }

  it('records who played what so the renderer can fly the card from their seat', () => {
    useGameStore.setState({ lastPlay: null, players, myIndex: 0, myHand: [] })
    useGameStore.getState().applyCardPlayed(1, card, 0, 0, 'red', players)
    const lp = useGameStore.getState().lastPlay
    expect(lp).not.toBeNull()
    expect(lp!.actorIndex).toBe(1)
    expect(lp!.card).toEqual(card)
    expect(lp!.at).toBeGreaterThan(0)
  })

  it('advances `at` on every play so repeats of the same card still animate', () => {
    useGameStore.setState({ lastPlay: null, players, myIndex: 0, myHand: [] })
    useGameStore.getState().applyCardPlayed(1, card, 0, 0, 'red', players)
    const first = useGameStore.getState().lastPlay!.at
    useGameStore.setState({ lastPlay: { actorIndex: 1, card, at: first - 50 } })
    useGameStore.getState().applyCardPlayed(1, card, 0, 0, 'red', players)
    expect(useGameStore.getState().lastPlay!.at).toBeGreaterThan(first - 50)
  })
})
