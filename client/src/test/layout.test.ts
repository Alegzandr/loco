import { describe, it, expect } from 'vitest'
import {
  clockwiseOpponents,
  opponentBubblePositions,
} from '../components/cards/layout'

describe('opponent layout helpers', () => {
  it('clockwiseOpponents preserves clockwise order from local player', () => {
    const players = [
      { index: 0, nickname: 'alice', hand_size: 5, connected: true },
      { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      { index: 2, nickname: 'carol', hand_size: 5, connected: true },
      { index: 3, nickname: 'dave', hand_size: 5, connected: true },
    ]
    const others = clockwiseOpponents(players, 2)
    expect(others.map((p) => p.index)).toEqual([3, 0, 1])
  })

  it('clockwiseOpponents handles sparse seat indexes without dropping opponents', () => {
    const players = [
      { index: 0, nickname: 'alice', hand_size: 5, connected: true },
      { index: 2, nickname: 'bob', hand_size: 5, connected: true },
      { index: 5, nickname: 'carol', hand_size: 5, connected: true },
    ]
    const others = clockwiseOpponents(players, 2)
    expect(others.map((p) => p.index)).toEqual([5, 0])
  })

  it('opponentBubblePositions keep bubbles on-screen for small/mobile viewport', () => {
    const positions = opponentBubblePositions(3, 320, 640)
    expect(positions).toHaveLength(3)
    for (const pos of positions) {
      expect(pos.x).toBeGreaterThanOrEqual(0)
      expect(pos.x).toBeLessThanOrEqual(320)
      expect(pos.y).toBeGreaterThan(0)
    }
  })

  it('opponentBubblePositions place first clockwise opponent on the left', () => {
    const positions = opponentBubblePositions(2, 1024, 768)
    expect(positions[0].x).toBeLessThan(positions[1].x)
    expect(positions[0].y).toBeGreaterThan(0)
    expect(positions[1].y).toBeGreaterThan(0)
  })
})
