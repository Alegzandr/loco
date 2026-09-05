import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { clientMayInterrupt, clientMayPlay, isCounterCard } from '../components/interruptHelpers'
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

  it('answers a pending penalty only with the same-coloured draw card', () => {
    const redD2: CardDTO = { color: 'red', kind: 'draw_two' }
    const blueD2: CardDTO = { color: 'blue', kind: 'draw_two' }
    expect(clientMayPlay(redD2, redD2, 'red', 2)).toBe(true)
    expect(clientMayPlay(blueD2, redD2, 'red', 2)).toBe(false)
  })

  it('plays that same off-colour +2 normally once the penalty has been taken', () => {
    // Forced draws do not cost the turn (§14.5): pendingDraw is back to 0 and the
    // +2 is now an ordinary kind-match on the +2 still sitting on the discard.
    const redD2: CardDTO = { color: 'red', kind: 'draw_two' }
    const blueD2: CardDTO = { color: 'blue', kind: 'draw_two' }
    expect(clientMayPlay(blueD2, redD2, 'red', 0)).toBe(true)
  })
})

describe('isCounterCard', () => {
  const redD2: CardDTO = { color: 'red', kind: 'draw_two' }
  const blueD2: CardDTO = { color: 'blue', kind: 'draw_two' }
  const wd4: CardDTO = { color: 'wild', kind: 'wild_draw_four' }

  it('accepts a same-coloured +2 on a +2 and refuses another colour', () => {
    expect(isCounterCard(redD2, redD2, 2)).toBe(true)
    expect(isCounterCard(blueD2, redD2, 2)).toBe(false)
  })

  it('accepts a +4 on a +4', () => {
    expect(isCounterCard(wd4, wd4, 4)).toBe(true)
  })

  it('does not cross kinds — a +4 never answers a +2 and vice-versa', () => {
    expect(isCounterCard(wd4, redD2, 2)).toBe(false)
    expect(isCounterCard(redD2, wd4, 4)).toBe(false)
  })

  it('rejects every other card while a penalty is pending', () => {
    expect(isCounterCard(red5, redD2, 2)).toBe(false)
    expect(isCounterCard(globalSwitch, redD2, 2)).toBe(false)
    expect(isCounterCard(wild, wd4, 4)).toBe(false)
  })

  it('is false with no pending penalty — that tap is an ordinary play', () => {
    expect(isCounterCard(redD2, redD2, 0)).toBe(false)
    expect(isCounterCard(blueD2, redD2, 0)).toBe(false)
  })

  it('rejects when there is no top discard yet', () => {
    expect(isCounterCard(redD2, null, 2)).toBe(false)
  })
})

describe('the interception slam lands where the words are', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'components/InterruptBanner.svelte'), 'utf8')

  it('tilts the band about the centre and sweeps it from the left', () => {
    // `skewY` moves a point vertically by its distance from the transform
    // origin. Skewed about its own left edge — a fifth of a screen off the left
    // of the frame — the band arrived at the middle of the screen a hundred and
    // forty pixels above where it was drawn, and on a wide monitor the words
    // came down on empty board with the band floating over them. Two elements:
    // the tilt pivots about the centre, the sweep still starts at the left.
    const tilt = source.match(/\n {2}\.slashTilt \{[\s\S]*?\n {2}\}/)
    const slash = source.match(/\n {2}\.slash \{[\s\S]*?\n {2}\}/)
    expect(tilt, '.slashTilt rule not found').not.toBeNull()
    expect(slash, '.slash rule not found').not.toBeNull()
    expect(tilt![0]).toMatch(/transform:\s*skewY\(-?\d+deg\)/)
    expect(tilt![0]).toMatch(/transform-origin:\s*center center/)
    expect(slash![0]).not.toMatch(/skewY/)
    expect(slash![0]).toMatch(/transform-origin:\s*left center/)
    // And the sweep's own keyframes carry no skew either, or the tilt is
    // applied twice on the element that is not centred.
    const sweep = source.match(/@keyframes slashSweep \{[\s\S]*?\n {2}\}/)
    expect(sweep![0]).not.toMatch(/skewY/)
  })

  it('takes the whole band away under reduced motion', () => {
    expect(source).toMatch(/:root\[data-motion="reduce"\] \.slashTilt \{[^}]*display:\s*none/)
  })
})

describe('the interrupt window', () => {
  const red5: CardDTO = { color: 'red', kind: 'number', value: 5 }

  // The card on top says nothing about whether it may still be slammed: a
  // draw or a pass by the seat at turn shuts the window, and the server is
  // the one that knows. Offered without that answer, the twin stayed tappable
  // after somebody had drawn and the press came back "somebody was faster" on
  // a table where nobody had been.
  it('is the server\'s word, and a shut window offers nothing', () => {
    expect(clientMayInterrupt(red5, red5, 0, true)).toBe(true)
    expect(clientMayInterrupt(red5, red5, 0, false)).toBe(false)
  })
})
