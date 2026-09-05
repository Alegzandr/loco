import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
    ActionBar, { isMyTurn: true, pendingDraw: 0, handSize: 5, hasDrawn: false, hasPlayableCard: true, catchArmed: false, catchLive: false, catchPending: false, hasDeclared: false, onDraw: noop, onPass: noop, onUno: noop, onCatch: noop, t: t, ...over },
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

  // The press is the one thing about a Contre-LOCO! decided on this screen, so
  // it is shown the frame it lands: the button holds itself down until the
  // server answers. Measured at 3–5 ms locally, the round trip is whatever the
  // player's network makes it, and a control that shows nothing until the
  // verdict comes back reads as a control that ignored the tap.
  it('holds the catch button down while a press is waiting on the server', () => {
    renderBar({ catchLive: true, catchArmed: true, catchPending: true })
    const catchBtn = btn(/^Catch!$/)
    expect(catchBtn).toHaveClass('called')
    // Held, not spent: a second window after a Swap is still one more tap.
    expect(catchBtn).toBeEnabled()
  })

  it('lets the catch button go once nothing is in flight', () => {
    renderBar({ catchLive: true, catchArmed: true, catchPending: false })
    expect(btn(/^Catch!$/)).not.toHaveClass('called')
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

/**
 * A dead button is read off the source, because jsdom applies no component
 * styles: what is asserted here is the declaration, the way `rulesModal` and
 * `preferences` assert theirs.
 */
const BAR_CSS = readFileSync(join(process.cwd(), 'src', 'components', 'ActionBar.svelte'), 'utf8')
const TOKENS = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8')

/** The body of a rule, by a selector that has to appear in it. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(selector)
  expect(at, `${selector} is gone from ActionBar.svelte`).toBeGreaterThan(-1)
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open))
}

/** A token's value in a block of `tokens.css`, by the selector that opens it. */
function token(name: string, scope: string): string {
  const at = TOKENS.indexOf(scope)
  expect(at, `${scope} is gone from tokens.css`).toBeGreaterThan(-1)
  const decl = TOKENS.indexOf(`${name}:`, at)
  expect(decl, `${name} is not declared under ${scope}`).toBeGreaterThan(-1)
  const value = TOKENS.slice(decl + name.length + 1, TOKENS.indexOf(';', decl)).trim()
  expect(value, `${name} under ${scope} is not a hex colour`).toMatch(/^#[0-9a-f]{6}$/)
  return value
}

const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('a dead action button', () => {
  // The failure this replaces: the disabled fill *was* `--color-surface-strong`,
  // which is what a live Pass wears, so the two differed by a label colour and a
  // missing ledge. Half the bar read as pressable for the whole of somebody
  // else's turn. The dead fill is now below the bar rather than on it.
  it('is printed into the bar, not raised off it', () => {
    const dead = rule(BAR_CSS, '.btn.btnDisabled')
    expect(dead).toContain('background: var(--color-surface-sunken)')
    expect(dead).toContain('color: var(--color-disabled-ink)')
    // A hard shadow inside the top edge: the ledge's own vocabulary, read as a
    // hollow. Never a ledge of its own, and never an opacity — quiet is a hue.
    expect(dead).toMatch(/box-shadow:\s*inset /)
    expect(dead).not.toMatch(/opacity:/)
    // And not the ink either: an outlined pill on a sunken fill is the ghost
    // button every other interface uses to mean "press me".
    expect(dead).toContain('border-color: var(--color-hairline)')
  })

  it('shares no fill with the live buttons beside it', () => {
    const dead = rule(BAR_CSS, '.btn.btnDisabled')
    for (const live of ['.btnPass', '.btnDrawSecondary']) {
      const body = rule(BAR_CSS, live)
      const fill = /background:\s*([^;]+);/.exec(body)?.[1]
      expect(fill, `${live} declares no fill`).toBeTruthy()
      expect(dead, `${live} and the dead state wear the same fill`).not.toContain(
        `background: ${fill}`,
      )
    }
  })

  // Catch sits disabled through the opening of every round, so this is the state
  // a spectator sees most: it stays readable at 720p.
  it('keeps its label above 4.5:1 on the sunken fill', () => {
    const scope = ':root {'
    const ink = token('--color-disabled-ink', scope)
    const fill = token('--color-surface-sunken', scope)
    expect(contrast(ink, fill), `${ink} on ${fill}`).toBeGreaterThanOrEqual(4.5)
  })
})
