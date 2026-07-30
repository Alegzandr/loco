import { describe, it, expect } from 'vitest'
import { clientMayInterrupt, clientMayPlay } from '../components/interruptHelpers'
import type { CardDTO } from '../types/protocol'

const red5: CardDTO = { color: 'red', kind: 'number', value: 5 }
const red5Skip: CardDTO = { color: 'red', kind: 'skip' }
const blue5: CardDTO = { color: 'blue', kind: 'number', value: 5 }
const red6: CardDTO = { color: 'red', kind: 'number', value: 6 }
const wild: CardDTO = { color: 'wild', kind: 'wild' }
const globalSwitch: CardDTO = { color: 'wild', kind: 'global_switch' }

describe('clientMayInterrupt', () => {
  it('matches identical color+kind+value', () => {
    expect(clientMayInterrupt(red5, red5, 0)).toBe(true)
    expect(clientMayInterrupt(red5Skip, red5Skip, 0)).toBe(true)
  })

  it('rejects color mismatch', () => {
    expect(clientMayInterrupt(red5, blue5, 0)).toBe(false)
  })

  it('rejects value mismatch', () => {
    expect(clientMayInterrupt(red5, red6, 0)).toBe(false)
  })

  it('allows wild on wild and global_switch on global_switch', () => {
    expect(clientMayInterrupt(wild, wild, 0)).toBe(true)
    expect(clientMayInterrupt(globalSwitch, globalSwitch, 0)).toBe(true)
  })

  it('keeps wild kinds distinct — a wild never lands on a wild_draw_four', () => {
    const wd4: CardDTO = { color: 'wild', kind: 'wild_draw_four' }
    expect(clientMayInterrupt(wild, wd4, 0)).toBe(false)
  })

  it('rejects non-draw interject when a draw penalty is pending', () => {
    expect(clientMayInterrupt(red5, red5, 2)).toBe(false)
  })

  it('allows identical DrawTwo to extend an active draw chain', () => {
    const redD2: CardDTO = { color: 'red', kind: 'draw_two' }
    expect(clientMayInterrupt(redD2, redD2, 2)).toBe(true)
  })

  it('allows identical WildDrawFour to extend an active +4 chain', () => {
    const wd4: CardDTO = { color: 'wild', kind: 'wild_draw_four' }
    expect(clientMayInterrupt(wd4, wd4, 4)).toBe(true)
  })

  it('rejects color-mismatched DrawTwo during a draw chain', () => {
    const redD2: CardDTO = { color: 'red', kind: 'draw_two' }
    const blueD2: CardDTO = { color: 'blue', kind: 'draw_two' }
    expect(clientMayInterrupt(blueD2, redD2, 2)).toBe(false)
  })

  it('rejects when there is no top discard yet', () => {
    expect(clientMayInterrupt(red5, null, 0)).toBe(false)
  })
})

describe('clientMayPlay', () => {
  it('treats global_switch as wild — playable on any non-pending-draw discard', () => {
    expect(clientMayPlay(globalSwitch, red5, 'red', 0)).toBe(true)
    expect(clientMayPlay(globalSwitch, blue5, 'blue', 0)).toBe(true)
    expect(clientMayPlay(globalSwitch, red5Skip, 'red', 0)).toBe(true)
  })

  it('treats wild and wild_draw_four as playable', () => {
    expect(clientMayPlay(wild, red5, 'red', 0)).toBe(true)
    const wd4: CardDTO = { color: 'wild', kind: 'wild_draw_four' }
    expect(clientMayPlay(wd4, red5, 'red', 0)).toBe(true)
  })

  it('blocks global_switch while a draw penalty is pending (only matching draw cards counter)', () => {
    expect(clientMayPlay(globalSwitch, { color: 'red', kind: 'draw_two' }, 'red', 2)).toBe(false)
  })

  it('matches by color, kind, or number value for non-wild cards', () => {
    expect(clientMayPlay(red5, blue5, 'blue', 0)).toBe(true)  // same number value
    expect(clientMayPlay(red5, red6, 'red', 0)).toBe(true)    // same color
    expect(clientMayPlay(red5, red6, 'blue', 0)).toBe(false)  // no overlap
  })
})
