import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import { GameView } from '../components/GameView'
import { useGameStore } from '../hooks/useGameStore'
import { TOP_CHROME } from '../components/cards/layout'
import { BOTTOM_RESERVE } from '../components/cards/cardTheme'
import type { CardDTO } from '../types/protocol'

// iPhone 14 Pro, portrait: notch above, home indicator below.
const INSETS = { top: 59, right: 0, bottom: 34, left: 0 }
let insets = INSETS

vi.mock('../hooks/useSafeAreaInsets', () => ({
  useSafeAreaInsets: () => insets,
}))

const red3: CardDTO = { color: 'red', kind: 'number', value: 3 }
const seat = (index: number, nickname: string, handSize: number) => ({
  index,
  nickname,
  hand_size: handSize,
  connected: true,
})

const VIEWPORT = { w: 390, h: 844 }

beforeEach(() => {
  insets = INSETS
  Element.prototype.getBoundingClientRect = () =>
    ({
      width: VIEWPORT.w,
      height: VIEWPORT.h,
      top: 0,
      left: 0,
      right: VIEWPORT.w,
      bottom: VIEWPORT.h,
      x: 0,
      y: 0,
    }) as DOMRect

  useGameStore.setState({
    screen: 'game',
    myIndex: 0,
    myHand: [red3],
    players: [seat(0, 'Alice', 1), seat(1, 'Bob', 3)],
    discard: red3,
    activeColor: 'red',
    currentTurn: 0,
    direction: 1,
    pendingDraw: 0,
    hasDrawn: false,
    lastPlay: null,
    showRoundSummary: false,
    mapId: '',
    mapLoading: null,
    turnDeadline: null,
  })
})

afterEach(() => {
  useGameStore.setState({ mapId: '', mapLoading: null })
})

function mountBoard() {
  render(
    <I18nProvider>
      <GameView onSend={vi.fn()} wsStatus="open" />
    </I18nProvider>,
  )
  const stage = screen.getByTestId('game-board').firstElementChild as HTMLElement
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(stage.style.transform)
  if (!m) throw new Error(`stage transform not recognised: ${stage.style.transform}`)
  return {
    stage,
    offsetX: parseFloat(m[1]),
    offsetY: parseFloat(m[2]),
    scale: parseFloat(m[3]),
    height: parseFloat(stage.style.height),
    width: parseFloat(stage.style.width),
  }
}

/*
 * The page runs `viewport-fit=cover` so the room's picture reaches every edge of
 * the screen (without it iOS confines the page to the safe area and paints the
 * notch and home-indicator bands with the body's own colour, which is where the
 * dark purple strips came from). That makes the board element bigger than the
 * part of it a player can see and touch, and the whole point of the change is
 * that only the *paint* uses the difference. layout.test.ts owns the maths; this
 * owns the wiring, which is the half a pure test cannot see.
 */
describe('safe areas on the board', () => {
  it('deals the table inside the notch and the home indicator', () => {
    const { offsetY, scale, height } = mountBoard()
    const toPx = (y: number) => offsetY + y * scale
    expect(toPx(TOP_CHROME)).toBeCloseTo(INSETS.top + TOP_CHROME, 5)
    expect(toPx(height - BOTTOM_RESERVE)).toBeCloseTo(VIEWPORT.h - INSETS.bottom - BOTTOM_RESERVE, 5)
  })

  // The bands the page does not own are painted with the *root* element's
  // colour, and the app's candy gradient there was two bright strips laid across
  // a dark room. Nothing else can reach those pixels from inside the page.
  it('pins the root to the room while a map is up, and releases it after', () => {
    useGameStore.setState({ mapId: 'neon' })
    const view = render(
      <I18nProvider>
        <GameView onSend={vi.fn()} wsStatus="open" />
      </I18nProvider>,
    )
    expect(document.documentElement.dataset.room).toBe('neon')
    view.unmount()
    expect(document.documentElement.dataset.room).toBeUndefined()
  })

  it('leaves the root alone with no map: a lobby is not a room', () => {
    mountBoard()
    expect(document.documentElement.dataset.room).toBeUndefined()
  })

  it('leaves the board flush with the element when the device has none', () => {
    insets = { top: 0, right: 0, bottom: 0, left: 0 }
    const { offsetX, offsetY, scale, width } = mountBoard()
    expect(offsetX).toBe(0)
    expect(offsetY).toBeCloseTo(TOP_CHROME * (1 - scale), 5)
    expect(width * scale).toBeCloseTo(VIEWPORT.w, 5)
  })
})
