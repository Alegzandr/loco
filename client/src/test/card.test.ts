import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from './render'
import Card from '../components/cards/Card.svelte'
import CardBack from '../components/cards/CardBack.svelte'
import { cardLabel, SUIT_PAINT } from '../components/cards/cardTheme'
import { LOCO_MARK_VIEWBOX, LOCO_MARK_PATH } from '../components/cards/locoMark'
import LocoLogo from '../components/LocoLogo.svelte'
import { CardDTO } from '../types/protocol'

const card = (over: Partial<CardDTO> = {}): CardDTO => ({
  color: 'red', kind: 'number', value: 5, ...over,
})

/** The decoded mask image behind a card's art layer. */
const maskOf = (el: Element) =>
  decodeURIComponent((el as HTMLElement).style.getPropertyValue('--mark-mask'))

/** The wild's four mini cards, which are the ones carrying a suit gradient. */
const fanOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('div')).filter((d) =>
    d.style.getPropertyValue('--fan') !== '',
  )

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
    render(Card, { card: card({ value: 9 }) })
    expect(screen.getAllByText('9').length).toBeGreaterThan(0)
    expect(screen.getByLabelText(/red number 9/i)).toBeInTheDocument()
  })

  it('exposes data-* attributes for E2E selection', () => {
    const { container } = render(Card, { card: card({ kind: 'skip' }) })
    const el = container.firstElementChild as HTMLElement
    expect(el.dataset.cardColor).toBe('red')
    expect(el.dataset.cardKind).toBe('skip')
  })

  it('fires onclick on tap and on Enter/Space', () => {
    const onclick = vi.fn()
    const { container } = render(Card, { card: card(), onclick })
    const el = container.firstElementChild as HTMLElement
    fireEvent.click(el)
    fireEvent.keyDown(el, { key: 'Enter' })
    fireEvent.keyDown(el, { key: ' ' })
    expect(onclick).toHaveBeenCalledTimes(3)
  })

  // The play goes out on the press: a click is the release, 80-150 ms later on
  // a touch screen, and an interject is decided by arrival order.
  it('acts on pointerdown and not again on the click that follows', () => {
    const onclick = vi.fn()
    const { container } = render(Card, { card: card(), onclick })
    const el = container.querySelector('.card') as HTMLElement
    el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }))
    expect(onclick).toHaveBeenCalledTimes(1)
    el.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onclick).toHaveBeenCalledTimes(1)
  })

  it('keyboard handler is inert without onclick', () => {
    const { container } = render(Card, { card: card() })
    const el = container.firstElementChild as HTMLElement
    expect(el.getAttribute('role')).toBeNull()
    expect(el.tabIndex).toBe(-1)
  })
})

describe('<CardBack />', () => {
  it('paints the LOCO mark at default size', () => {
    const { container } = render(CardBack)
    expect(maskOf(container.querySelector('[aria-hidden]')!)).toContain('svg')
  })

  it('drops the mark when the card is too small to read it', () => {
    const { container } = render(CardBack, { width: 17, height: 25, radius: 3 })
    expect(container.querySelector('[aria-hidden]')).toBeNull()
  })

  it('applies opacity from prop', () => {
    const { container } = render(CardBack, { opacity: 0.5 })
    const el = container.firstElementChild as HTMLElement
    expect(el.style.opacity).toBe('0.5')
  })
})

describe('card face art', () => {
  it('paints the mark in the face gradient reversed', () => {
    // The whole face works because the watermark is brighter than the card where
    // the card is dark and darker where it is light. If the two gradients ever
    // run the same way the mark disappears into the face at both ends.
    const { container } = render(Card, { card: card({ color: 'green' }) })
    const art = container.querySelector('[aria-hidden]') as HTMLElement
    expect(art.style.getPropertyValue('--face'))
      .toBe(`linear-gradient(35deg, ${SUIT_PAINT.green.from}, ${SUIT_PAINT.green.to})`)
    expect(art.style.getPropertyValue('--mark'))
      .toBe(`linear-gradient(35deg, ${SUIT_PAINT.green.to}, ${SUIT_PAINT.green.from})`)
  })

  it('names the colour-change card by its four suits, never by a letter', () => {
    // Players read the shape; "W" is also a word in one of the two languages.
    const { container } = render(Card, { card: card({ color: 'wild', kind: 'wild' }) })
    expect(screen.queryByText('W')).toBeNull()
    expect(fanOf(container)).toHaveLength(4)
  })

  it('gives the fan to the two cards that ask for a colour and to no others', () => {
    for (const kind of ['wild', 'wild_draw_four'] as const) {
      const { container } = render(Card, { card: card({ color: 'wild', kind }) })
      expect(fanOf(container)).toHaveLength(4)
    }
    // GlobalSwitch is wild-coloured but chooses nothing.
    const { container } = render(Card, { card: card({ color: 'wild', kind: 'global_switch' }) })
    expect(fanOf(container)).toHaveLength(0)
  })

  it('draws rule glyphs instead of typesetting them', () => {
    // ⊘ ⇄ ⇋ ↻ are the obvious characters and the wrong tool: Fredoka carries
    // none of them, so the fallback chain would decide what a rule card is.
    for (const kind of ['skip', 'reverse', 'swap', 'global_switch'] as const) {
      const { container } = render(Card, { card: card({ kind }) })
      expect(container.querySelectorAll('svg').length).toBeGreaterThan(1)
      expect(container.textContent).toBe('L')
    }
  })

  it('draws GlobalSwitch as a ring of hands, not as a refresh arrow', () => {
    // A lone circular arrow is the "refresh" pictogram: it says something turns
    // without saying the cards do, and it was read as "redraw your hand". The
    // three cards are the rule, and three of them can never be Swap's two.
    const { container } = render(Card, { card: card({ color: 'wild', kind: 'global_switch' }) })
    // The glyph is drawn twice (ink pass, then the glyph over it) in each of its
    // two places on the card (centre + corner), three seats per pass.
    expect(container.querySelectorAll('svg rect[transform]')).toHaveLength(3 * 4)
    const swap = render(Card, { card: card({ kind: 'swap' }) }).container
    expect(swap.querySelectorAll('svg rect[transform]')).toHaveLength(0)
  })

  it('crops and tilts the mark on a card, and shows it whole in the logo', () => {
    // Two framings of one geometry, and they are not interchangeable. On a card
    // the mark runs off all four edges under the value — a landscape drawing
    // centred politely in a portrait card leaves two dead bands. The logo,
    // favicon and felt show the whole duck.
    const { container } = render(Card, { card: card() })
    expect(maskOf(container.querySelector('[aria-hidden]')!)).toMatch(/rotate\(\d/)

    const logo = render(LocoLogo).container.querySelector('svg')!
    expect(logo.getAttribute('viewBox')).toBe(LOCO_MARK_VIEWBOX)
    expect(logo.querySelector('g[transform]')).toBeNull()
  })

  it('brands a suited card top-left and repeats its value bottom-right', () => {
    render(Card, { card: card({ kind: 'number', value: 6 }) })
    expect(screen.getByText('L')).toBeInTheDocument()
    expect(screen.getAllByText('6')).toHaveLength(2) // centre + rotated corner
  })
})

describe('card art rendering cost', () => {
  // The board carries up to ~50 card faces and backs at once (hand, both piles,
  // every opponent's mini fan) and most of them sit under a scale animation,
  // which re-rasterises them every frame. Painting the mark as a live <path>
  // meant re-filling 130-odd even-odd segments under a gradient, per card, per
  // frame, measured at 3.0 fps against 9.8 on a full hand where the compositing
  // is done in software. See cardArtSpace.ts for the full numbers.
  //
  // As a mask image it is one bitmap the browser rasterises once per used size
  // and every card composites. These two tests are the guard: both go green
  // again the moment somebody puts the geometry back into the markup, and no
  // other test in the suite can see the difference.
  it('never puts the mark geometry in the markup, however many cards are drawn', () => {
    // Every face together, because the cost this guards is per card on screen:
    // each render appends to the same document, so the scan below sees all of
    // them at once the way the board does.
    for (const color of ['red', 'yellow', 'green', 'blue'] as const) {
      render(Card, { card: card({ color }) })
    }
    render(Card, { card: card({ color: 'wild', kind: 'wild' }) })
    render(Card, { card: card({ color: 'wild', kind: 'wild_draw_four' }) })
    render(CardBack)

    // The count that says the fixture actually drew something. Without it the
    // assertion below is zero paths out of zero cards, which passes forever.
    expect(document.body.querySelectorAll('[data-card-color]')).toHaveLength(6)

    // Counted as live <path> geometry, not as a substring of the markup: the
    // mask's data URI legitimately carries the same path, percent-encoded, and
    // matching on the raw string would pass for that reason rather than for the
    // right one. What must be zero is paths the engine has to *fill*.
    //
    // The wild used to be the worst case on its own: the same geometry once for
    // the face and again inside each of the four mini cards, so six cards and a
    // back used to put fifteen of these on screen.
    const live = Array.from(document.body.querySelectorAll('path'))
      .filter((p) => p.getAttribute('d') === LOCO_MARK_PATH)
    expect(live).toHaveLength(0)
  })

  it('shares one mask image across every suit, so the cache is hit once', () => {
    // Per-card or per-suit URLs would be per-card or per-suit rasterisations,
    // which hands back exactly the cost this replaces.
    const masks = (['red', 'yellow', 'green', 'blue', 'wild'] as const).map((color) => {
      const { container } = render(Card, { card: card({ color }) })
      return maskOf(container.querySelector('[aria-hidden]')!)
    })
    expect(new Set(masks).size).toBe(1)
  })
})
