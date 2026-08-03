import { describe, it, expect } from 'vitest'
import type { ComponentProps } from 'svelte'
import { render, screen } from './render'
import ActionBar from '../components/ActionBar.svelte'
import type { Translations } from '../i18n/en'

const t = {
  draw: 'Draw',
  pass: 'Pass',
  unoBtn: 'LOCO!',
  catchBtn: 'Catch!',
} as unknown as Translations

const noop = () => {}

function renderBar(over: Partial<ComponentProps<typeof ActionBar>> = {}) {
  return render(
    ActionBar, { isMyTurn: true, pendingDraw: 0, handSize: 5, hasDrawn: false, hasPlayableCard: true, canCatch: false, hasDeclared: false, onDraw: noop, onPass: noop, onUno: noop, onCatch: noop, t: t, ...over },
  )
}

const slotOf = (name: RegExp) =>
  screen.getByRole('button', { name }).closest('[data-slot]')?.getAttribute('data-slot')

const btn = (name: RegExp) => screen.getByRole('button', { name })

describe('ActionBar', () => {
  // The bar is a fixed three-column grid so a player can aim at a button before
  // it is needed. Catch owns the centre: it is the hardest button in the
  // game to hit, so it must already be under the cursor when its seconds open.
  it('keeps draw left, catch centre and pass right', () => {
    renderBar()
    expect(slotOf(/^Draw$/)).toBe('left')
    expect(slotOf(/^Catch!$/)).toBe('center')
    expect(slotOf(/^Pass$/)).toBe('right')
  })

  it('holds the centre with a disabled catch when nobody is catchable', () => {
    renderBar()
    expect(btn(/^Catch!$/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^LOCO!$/ })).toBeNull()
  })

  it('puts the penalty draw in the same left slot as the ordinary draw', () => {
    renderBar({ pendingDraw: 4 })
    expect(slotOf(/Draw \+4/)).toBe('left')
    expect(slotOf(/^Catch!$/)).toBe('center')
  })

  it('renders all three slots even when it is not our turn', () => {
    // Empty slots must still occupy their column, otherwise the centre slides.
    renderBar({ isMyTurn: false })
    const slots = document.querySelectorAll('[data-slot]')
    expect([...slots].map((s) => s.getAttribute('data-slot'))).toEqual([
      'left',
      'center',
      'right',
    ])
    expect(slotOf(/^Catch!$/)).toBe('center')
  })

  it('enables catch in place — same slot, no reflow — when the window opens', () => {
    renderBar({ canCatch: true })
    expect(slotOf(/^Catch!$/)).toBe('center')
    expect(btn(/^Catch!$/)).toBeEnabled()
  })

  it('lends the centre to LOCO on one card and floats catch', () => {
    renderBar({ canCatch: true, handSize: 1 })
    expect(slotOf(/^LOCO!$/)).toBe('center')
    expect(slotOf(/^Catch!$/)).toBe('float')
  })

  // Both sides of the same wager get the same cue, so neither player gets a
  // head start on the other's reaction.
  it('arms catch and LOCO with the same attention-grabbing class', () => {
    const { unmount } = renderBar({ canCatch: true })
    const armedCatch = [...btn(/^Catch!$/).classList].find((c) => c.includes('armed'))
    expect(armedCatch).toBeTruthy()
    unmount()

    renderBar({ handSize: 1 })
    expect([...btn(/^LOCO!$/).classList]).toContain(armedCatch)
  })

  // A declaration is a one-shot. The button stays in its column — nothing in
  // this bar may move mid-match — but it is spent, so it can no longer be
  // tapped and no longer asks to be.
  it('spends the LOCO button once the declaration is in', () => {
    renderBar({ handSize: 1, hasDeclared: true })
    expect(slotOf(/^LOCO!$/)).toBe('center')
    expect(btn(/^LOCO!$/)).toBeDisabled()
    expect([...btn(/^LOCO!$/).classList].some((c) => c.includes('armed'))).toBe(false)
  })

  it('leaves catch unarmed while the window is closed', () => {
    renderBar()
    expect([...btn(/^Catch!$/).classList].some((c) => c.includes('armed'))).toBe(false)
  })
})
