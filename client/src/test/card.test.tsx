import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Card } from '../components/cards/Card'
import { CardBack } from '../components/cards/CardBack'
import { cardLabel } from '../components/cards/cardTheme'
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
  it('renders the L monogram at default size', () => {
    render(<CardBack />)
    expect(screen.getByText('L')).toBeInTheDocument()
  })

  it('hides monogram when card is too small', () => {
    render(<CardBack width={17} height={25} radius={3} />)
    expect(screen.queryByText('L')).toBeNull()
  })

  it('applies opacity from prop', () => {
    const { container } = render(<CardBack opacity={0.5} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.style.opacity).toBe('0.5')
  })
})
