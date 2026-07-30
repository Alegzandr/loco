import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Card } from '../components/cards/Card'
import { CardBack } from '../components/cards/CardBack'
import { cardLabel, SUIT_PAINT } from '../components/cards/cardTheme'
import { LOCO_MARK_VIEWBOX } from '../components/cards/locoMark'
import { LocoLogo } from '../components/LocoLogo'
import { CardDTO } from '../types/protocol'

const card = (over: Partial<CardDTO> = {}): CardDTO => ({
  color: 'red', kind: 'number', value: 5, ...over,
})

describe('cardLabel', () => {
  it('formats every kind', () => {
    expect(cardLabel(card({ kind: 'number', value: 7 }))).toBe('7')
    expect(cardLabel(card({ kind: 'skip' }))).toBe('⊘')
    expect(cardLabel(card({ kind: 'reverse' }))).toBe('⇄')
    expect(cardLabel(card({ kind: 'draw_two' }))).toBe('+2')
    expect(cardLabel(card({ kind: 'wild', color: 'wild' }))).toBe('W')
    expect(cardLabel(card({ kind: 'wild_draw_four', color: 'wild' }))).toBe('+4')
    expect(cardLabel(card({ kind: 'swap' }))).toBe('⇋')
    expect(cardLabel(card({ kind: 'global_switch', color: 'wild' }))).toBe('↻')
  })
})

describe('<Card />', () => {
  it('renders the label and an aria description', () => {
    render(<Card card={card({ value: 9 })} />)
    expect(screen.getAllByText('9').length).toBeGreaterThan(0)
    expect(screen.getByLabelText(/red number 9/i)).toBeInTheDocument()
  })

  it('exposes data-* attributes for E2E selection', () => {
    const { container } = render(<Card card={card({ kind: 'skip' })} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.dataset.cardColor).toBe('red')
    expect(el.dataset.cardKind).toBe('skip')
  })

  it('fires onClick on tap and on Enter/Space', () => {
    const onClick = vi.fn()
    const { container } = render(<Card card={card()} onClick={onClick} />)
    const el = container.firstElementChild as HTMLElement
    fireEvent.click(el)
    fireEvent.keyDown(el, { key: 'Enter' })
    fireEvent.keyDown(el, { key: ' ' })
    expect(onClick).toHaveBeenCalledTimes(3)
  })

  it('keyboard handler is inert without onClick', () => {
    const { container } = render(<Card card={card()} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.getAttribute('role')).toBeNull()
    expect(el.tabIndex).toBe(-1)
  })
})

describe('<CardBack />', () => {
  it('paints the LOCO mark at default size', () => {
    const { container } = render(<CardBack />)
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0)
  })

  it('drops the mark when the card is too small to read it', () => {
    const { container } = render(<CardBack width={17} height={25} radius={3} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('applies opacity from prop', () => {
    const { container } = render(<CardBack opacity={0.5} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.style.opacity).toBe('0.5')
  })
})

describe('card face art', () => {
  const stops = (container: HTMLElement, id: string) =>
    Array.from(container.querySelectorAll(`linearGradient[id$="-${id}"] stop`))
      .map((s) => s.getAttribute('stop-color'))

  it('paints the mark in the face gradient reversed', () => {
    // The whole face works because the watermark is brighter than the card where
    // the card is dark and darker where it is light. If the two gradients ever
    // run the same way the mark disappears into the face at both ends.
    const { container } = render(<Card card={card({ color: 'green' })} />)
    expect(stops(container, 'face')).toEqual([SUIT_PAINT.green.from, SUIT_PAINT.green.to])
    expect(stops(container, 'mark')).toEqual([SUIT_PAINT.green.to, SUIT_PAINT.green.from])
  })

  it('names the colour-change card by its four suits, never by a letter', () => {
    // Players read the shape; "W" is also a word in one of the two languages.
    const { container } = render(<Card card={card({ color: 'wild', kind: 'wild' })} />)
    expect(screen.queryByText('W')).toBeNull()
    const fan = Array.from(container.querySelectorAll('linearGradient[id*="-fan-"]'))
    expect(fan).toHaveLength(4)
  })

  it('gives the fan to the two cards that ask for a colour and to no others', () => {
    for (const kind of ['wild', 'wild_draw_four'] as const) {
      const { container } = render(<Card card={card({ color: 'wild', kind })} />)
      expect(container.querySelectorAll('linearGradient[id*="-fan-"]')).toHaveLength(4)
    }
    // GlobalSwitch is wild-coloured but chooses nothing.
    const { container } = render(<Card card={card({ color: 'wild', kind: 'global_switch' })} />)
    expect(container.querySelectorAll('linearGradient[id*="-fan-"]')).toHaveLength(0)
  })

  it('draws rule glyphs instead of typesetting them', () => {
    // ⊘ ⇄ ⇋ ↻ are the obvious characters and the wrong tool: Fredoka carries
    // none of them, so the fallback chain would decide what a rule card is.
    for (const kind of ['skip', 'reverse', 'swap', 'global_switch'] as const) {
      const { container } = render(<Card card={card({ kind })} />)
      expect(container.querySelectorAll('svg').length).toBeGreaterThan(1)
      expect(container.textContent).toBe('L')
    }
  })

  it('draws GlobalSwitch as a ring of hands, not as a refresh arrow', () => {
    // A lone circular arrow is the "refresh" pictogram: it says something turns
    // without saying the cards do, and it was read as "redraw your hand". The
    // three cards are the rule, and three of them can never be Swap's two.
    const { container } = render(<Card card={card({ color: 'wild', kind: 'global_switch' })} />)
    // The glyph is drawn twice (ink pass, then the glyph over it) in each of its
    // two places on the card (centre + corner), three seats per pass.
    expect(container.querySelectorAll('svg rect[transform]')).toHaveLength(3 * 4)
    const swap = render(<Card card={card({ kind: 'swap' })} />).container
    expect(swap.querySelectorAll('svg rect[transform]')).toHaveLength(0)
  })

  it('crops and tilts the mark on a card, and shows it whole in the logo', () => {
    // Two framings of one geometry, and they are not interchangeable. On a card
    // the mark runs off all four edges under the value — a landscape drawing
    // centred politely in a portrait card leaves two dead bands. The logo,
    // favicon and felt show the whole duck.
    const { container } = render(<Card card={card()} />)
    const mark = container.querySelector('svg g[transform]')!
    expect(mark.getAttribute('transform')).toMatch(/rotate\(\d/)

    const logo = render(<LocoLogo />).container.querySelector('svg')!
    expect(logo.getAttribute('viewBox')).toBe(LOCO_MARK_VIEWBOX)
    expect(logo.querySelector('g[transform]')).toBeNull()
  })

  it('brands a suited card top-left and repeats its value bottom-right', () => {
    render(<Card card={card({ kind: 'number', value: 6 })} />)
    expect(screen.getByText('L')).toBeInTheDocument()
    expect(screen.getAllByText('6')).toHaveLength(2) // centre + rotated corner
  })
})
