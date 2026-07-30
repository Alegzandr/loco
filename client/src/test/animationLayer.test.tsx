import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AnimationLayer, Flier, Impact } from '../components/cards/AnimationLayer'
import { CardDTO } from '../types/protocol'

const noop = () => {}

const flier = (over: Partial<Flier> = {}): Flier => ({
  id: 'f1',
  kind: 'face',
  card: { color: 'red', kind: 'number', value: 5 } as CardDTO,
  from: { x: 0, y: 0 },
  to: { x: 100, y: 100 },
  ...over,
})

describe('<AnimationLayer /> spinning fliers', () => {
  it('renders a card back behind a spinning card', () => {
    // Without the second face, half of every turn shows a mirrored front —
    // which reads as a rendering glitch, not as a card turning over.
    const { getByText } = render(
      <AnimationLayer
        fliers={[flier({ spin: 2 })]}
        effectTexts={[]}
        onFlierDone={noop}
        onEffectDone={noop}
      />,
    )
    expect(getByText('L')).toBeInTheDocument()  // the card-back monogram
  })

  it('renders no back for a flier that does not spin', () => {
    const { queryByText } = render(
      <AnimationLayer
        fliers={[flier()]}
        effectTexts={[]}
        onFlierDone={noop}
        onEffectDone={noop}
      />,
    )
    expect(queryByText('L')).toBeNull()
  })
})

describe('<AnimationLayer /> impacts', () => {
  const impact = (over: Partial<Impact> = {}): Impact => ({
    id: 'i1', x: 50, y: 60, color: '#9b7bff', ...over,
  })

  it('sizes the ring from the caller — a legendary lands wider than a rare', () => {
    const { container } = render(
      <AnimationLayer
        fliers={[]}
        effectTexts={[]}
        impacts={[impact({ id: 'a', size: 260 })]}
        onFlierDone={noop}
        onEffectDone={noop}
      />,
    )
    const ring = container.querySelector('[style*="width"]') as HTMLElement
    expect(ring.style.width).toBe('260px')
    expect(ring.style.height).toBe('260px')
  })

  it('tints the ring with the caller-supplied colour', () => {
    const { container } = render(
      <AnimationLayer
        fliers={[]}
        effectTexts={[]}
        impacts={[impact({ color: 'rgb(255, 0, 0)' })]}
        onFlierDone={noop}
        onEffectDone={noop}
      />,
    )
    const ring = container.querySelector('[style*="color"]') as HTMLElement
    expect(ring.style.color).toBe('rgb(255, 0, 0)')
  })

  it('adds no ring node when nothing landed', () => {
    const { container: withImpact } = render(
      <AnimationLayer
        fliers={[]} effectTexts={[]} impacts={[impact()]}
        onFlierDone={noop} onEffectDone={noop}
      />,
    )
    const { container: without } = render(
      <AnimationLayer fliers={[]} effectTexts={[]} onFlierDone={noop} onEffectDone={noop} />,
    )
    expect(withImpact.querySelectorAll('div').length)
      .toBeGreaterThan(without.querySelectorAll('div').length)
  })
})
