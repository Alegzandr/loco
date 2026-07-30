import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { DiscardPile } from '../components/cards/DiscardPile'
import { I18nProvider } from '../i18n'
import { GameView } from '../components/GameView'
import { useGameStore } from '../hooks/useGameStore'
import { CardDTO } from '../types/protocol'

const wild: CardDTO = { color: 'wild', kind: 'wild', value: 0 }
const red7: CardDTO = { color: 'red', kind: 'number', value: 7 }

const renderPile = (card: CardDTO, activeColor: 'red' | 'green' | 'blue' | 'yellow') =>
  render(<DiscardPile card={card} activeColor={activeColor} pendingDraw={0} width={1240} height={790} />)

describe('<DiscardPile /> active colour', () => {
  // The whole point of the chip: a wild's face says nothing about the colour in
  // play, and that is the state players ask about.
  it('names the active colour even when the top card is a wild', () => {
    renderPile(wild, 'green')
    expect(screen.getByLabelText('active color green')).toBeInTheDocument()
  })

  it('states it on a coloured top card too, so the place to look never moves', () => {
    renderPile(red7, 'red')
    expect(screen.getByLabelText('active color red')).toBeInTheDocument()
  })

  it('paints the chip in the suit gradient, not a flat sample', () => {
    renderPile(wild, 'blue')
    const chip = screen.getByLabelText('active color blue')
    expect(chip.style.background).toContain('linear-gradient')
  })
})

// The permanent cues say what the colour is; this one is what teaches a new
// player that they mean anything, on the only card that needs telling.
describe('GameBoard — colour-change callout', () => {
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = () =>
      ({ width: 1240, height: 790, top: 0, left: 0, right: 1240, bottom: 790, x: 0, y: 0 }) as DOMRect
    useGameStore.setState({
      myIndex: 0,
      myHand: [red7],
      players: [
        { index: 0, nickname: 'Alice', hand_size: 1, connected: true },
        { index: 1, nickname: 'Bob', hand_size: 3, connected: true },
      ],
      discard: red7,
      activeColor: 'red',
      currentTurn: 0,
      direction: 1,
      pendingDraw: 0,
      hasDrawn: false,
      lastPlay: null,
      showRoundSummary: false,
    })
    render(
      <I18nProvider>
        <GameView onSend={vi.fn()} wsStatus="open" />
      </I18nProvider>,
    )
  })

  it('announces the colour a wild named', () => {
    act(() => { useGameStore.setState({ discard: wild, activeColor: 'green' }) })
    expect(screen.getByText('GREEN!')).toBeInTheDocument()
  })

  it('stays quiet when the top card carries its own colour', () => {
    act(() => {
      useGameStore.setState({ discard: { color: 'blue', kind: 'number', value: 4 }, activeColor: 'blue' })
    })
    expect(screen.queryByText('BLUE!')).not.toBeInTheDocument()
  })
})
