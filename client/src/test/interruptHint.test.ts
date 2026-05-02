import { describe, it, expect } from 'vitest'
import { clientMayInterrupt } from '../components/interruptHelpers'
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

  it('rejects wild and global_switch (cannot take lead)', () => {
    expect(clientMayInterrupt(wild, wild, 0)).toBe(false)
    expect(clientMayInterrupt(globalSwitch, globalSwitch, 0)).toBe(false)
  })

  it('rejects when a draw penalty is pending', () => {
    expect(clientMayInterrupt(red5, red5, 2)).toBe(false)
  })

  it('rejects when there is no top discard yet', () => {
    expect(clientMayInterrupt(red5, null, 0)).toBe(false)
  })
})
