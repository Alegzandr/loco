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
    ActionBar, { isMyTurn: true, pendingDraw: 0, handSize: 5, hasDrawn: false, hasPlayableCard: true, catchArmed: false, catchLive: false, hasDeclared: false, onDraw: noop, onPass: noop, onUno: noop, onCatch: noop, t: t, ...over },
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

  it('holds the centre with a disabled catch when nobody is near finishing', () => {
    renderBar()
    expect(btn(/^Catch!$/)).toBeDisabled()
    expect(btn(/^LOCO!$/)).toBeDisabled()
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
      'loco',
    ])
    expect(slotOf(/^Catch!$/)).toBe('center')
  })

  // Reserving the column was only half of it. A slot that empties on somebody
  // else's turn leaves one lone pill in a wide trough, and the bar's outline
  // pinches to a point at each end of it — little teeth that come and go with
  // the turn, under a thumb that is supposed to be able to stop looking. Every
  // column keeps its button all match and goes dead in place, exactly like
  // Catch and LOCO!.
  it('keeps a button in every column all match, dead rather than absent', () => {
    const { unmount } = renderBar({ isMyTurn: false })
    for (const name of [/^Draw$/, /^Catch!$/, /^Pass$/, /^LOCO!$/]) {
      expect(btn(name), String(name)).toBeDisabled()
    }
    expect(slotOf(/^Draw$/)).toBe('left')
    expect(slotOf(/^Pass$/)).toBe('right')
    unmount()

    // And the same three, in the same three columns, once the turn is ours.
    renderBar({ isMyTurn: false, pendingDraw: 4 })
    expect(slotOf(/^Draw$/)).toBe('left')
    // Never the pulsing penalty variant on somebody else's turn: the stack is
    // theirs to answer, and that button is the loudest object on the screen.
    expect(screen.queryByRole('button', { name: /Draw \+4/ })).toBeNull()
    expect(btn(/^Draw$/)).toBeDisabled()
  })

  it('lights the draw and the pass in turn, without either ever leaving', () => {
    // Drawing is ours until it is spent; passing only becomes ours once it is.
    const { unmount } = renderBar({ isMyTurn: true, hasDrawn: false })
    expect(btn(/^Draw$/)).toBeEnabled()
    expect(btn(/^Pass$/)).toBeDisabled()
    unmount()

    renderBar({ isMyTurn: true, hasDrawn: true })
    expect(btn(/^Draw$/)).toBeDisabled()
    expect(btn(/^Pass$/)).toBeEnabled()
  })

  // The point of the whole arrangement: the press is available while it is still
  // a read. A button that only unlocks once the server has named a target can
  // only ever be answered, and the window it answers is seconds long.
  it('lets catch be pressed on a live table, before anybody is on the hook', () => {
    renderBar({ catchLive: true, catchArmed: false })
    expect(btn(/^Catch!$/)).toBeEnabled()
    expect([...btn(/^Catch!$/).classList].some((c) => c.includes('armed'))).toBe(false)
  })

  it('arms catch in place — same slot, no reflow — when a window actually opens', () => {
    renderBar({ catchLive: true, catchArmed: true })
    expect(slotOf(/^Catch!$/)).toBe('center')
    expect(btn(/^Catch!$/)).toBeEnabled()
    expect([...btn(/^Catch!$/).classList].some((c) => c.includes('armed'))).toBe(true)
  })

  // Catch never leaves the centre, whatever our own hand is doing.
  it('keeps the centre for catch even while we are the one on a single card', () => {
    renderBar({ catchLive: true, catchArmed: true, handSize: 1 })
    expect(slotOf(/^Catch!$/)).toBe('center')
    expect(slotOf(/^LOCO!$/)).toBe('loco')
  })

  // The chip is on screen from the deal, dead, so the player has looked at it a
  // hundred times before the round where it matters. A control that only appears
  // for the two seconds it is worth pressing has to be found in those two seconds.
  it('keeps LOCO on screen and dead until we owe the call', () => {
    const { unmount } = renderBar({ handSize: 2 })
    expect(slotOf(/^LOCO!$/)).toBe('loco')
    expect(btn(/^LOCO!$/)).toBeDisabled()
    unmount()

    renderBar({ handSize: 1 })
    expect(slotOf(/^LOCO!$/)).toBe('loco')
    expect(btn(/^LOCO!$/)).toBeEnabled()
  })

  // Both sides of the same wager get the same cue, so neither player gets a
  // head start on the other's reaction.
  it('arms catch and LOCO with the same attention-grabbing class', () => {
    const { unmount } = renderBar({ catchLive: true, catchArmed: true })
    const armedCatch = [...btn(/^Catch!$/).classList].find((c) => c.includes('armed'))
    expect(armedCatch).toBeTruthy()
    unmount()

    renderBar({ handSize: 1 })
    expect([...btn(/^LOCO!$/).classList]).toContain(armedCatch)
  })

  // A declaration is a one-shot: the server refuses the second one, so the chip
  // has to stop asking. It goes dead in place rather than leaving, like every
  // other control on this bar.
  it('puts the LOCO button back to sleep once the declaration is in', () => {
    renderBar({ handSize: 1, hasDeclared: true })
    expect(btn(/^LOCO!$/)).toBeDisabled()
    expect(slotOf(/^LOCO!$/)).toBe('loco')
    expect(slotOf(/^Catch!$/)).toBe('center')
  })
})
