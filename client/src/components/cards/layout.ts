// Pure layout math for the React renderer.
import { CARD_W, CARD_H, BOTTOM_RESERVE } from './cardTheme'

export interface OpponentBubblePosition {
  x: number
  y: number
}

export interface HandSlot {
  x: number
  y: number
  rotation: number
}

interface PlayerLike {
  index: number
  nickname: string
  hand_size: number
  connected?: boolean
}

// Returns opponents in clockwise seat order starting from the player immediately
// after myIndex, so the leftmost bubble in the arc is the next player in turn order.
export function clockwiseOpponents<T extends PlayerLike>(players: T[], myIndex: number): T[] {
  const seatCount = players.reduce((max, p) => Math.max(max, p.index), myIndex) + 1
  return players
    .filter((p) => p.index !== myIndex)
    .sort((a, b) => {
      const aDist = (a.index - myIndex + seatCount) % seatCount
      const bDist = (b.index - myIndex + seatCount) % seatCount
      return aDist - bDist
    })
}

export function opponentBubblePositions(
  opponentCount: number,
  width: number,
  height: number,
): OpponentBubblePosition[] {
  if (opponentCount <= 0) return []
  if (opponentCount === 1) return [{ x: width / 2, y: 50 }]

  const bubbleHalfW = 86 // PlayerSlot uses a 172px pill width
  const playableHeight = Math.max(140, height - BOTTOM_RESERVE)
  const radiusX = Math.max(28, width / 2 - bubbleHalfW - 12)
  const radiusY = Math.max(30, playableHeight * 0.12)
  const angleStep = Math.PI / (opponentCount + 1)
  const topOffset = Math.max(56, playableHeight * 0.08)
  const cx = width / 2
  const positions: OpponentBubblePosition[] = []

  for (let i = 0; i < opponentCount; i++) {
    // Upper arc from left->right so opponents stay visible above the table.
    const angle = Math.PI - angleStep * (i + 1)
    positions.push({
      x: cx + Math.cos(angle) * radiusX,
      y: topOffset + Math.sin(angle) * radiusY,
    })
  }
  return positions
}

// Fan layout for the local hand. (n - 1) cards spaced by `cardSpacing`,
// centred horizontally, with a slight arc and per-card rotation.
export function calcHandSlots(n: number, width: number, height: number): HandSlot[] {
  if (n === 0) return []
  const baseY = height - CARD_H - BOTTOM_RESERVE
  const maxSpacing = CARD_W + 8
  const minSpacing = 20
  const availWidth = width - 40
  const cardSpacing = Math.max(minSpacing, Math.min(maxSpacing, availWidth / n))
  const totalWidth = (n - 1) * cardSpacing + CARD_W
  const startX = width / 2 - totalWidth / 2
  const maxRot = Math.min(0.12, 0.25 / Math.max(n, 1))

  return Array.from({ length: n }, (_, i) => {
    const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0  // -1 to 1
    return {
      x: startX + i * cardSpacing,
      y: baseY + Math.abs(t) * 6,
      rotation: t * maxRot,
    }
  })
}

// Returns one stable key per card in hand order. Cards are value objects, so a
// duplicate pair is disambiguated by occurrence number. Index keys would make
// React reuse the wrong node when a card leaves the middle of the fan, and the
// remaining cards would snap instead of sliding into the gap.
export function handCardKeys(hand: { color: string; kind: string; value?: number }[]): string[] {
  const seen = new Map<string, number>()
  return hand.map((c) => {
    const base = `${c.color}-${c.kind}-${c.value ?? ''}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return `${base}#${n}`
  })
}

// Centre of the discard pile, in container coordinates.
export function discardPosition(width: number, height: number): { x: number; y: number } {
  return {
    x: width / 2 - CARD_W / 2 + 20,
    y: (height - BOTTOM_RESERVE) / 2 - CARD_H / 2,
  }
}

// Centre of the deck stack (left of discard).
export function deckPosition(width: number, height: number): { x: number; y: number } {
  return {
    x: width / 2 - CARD_W - 30,
    y: (height - BOTTOM_RESERVE) / 2 - CARD_H / 2,
  }
}

// Returns the on-screen anchor for a seat: the local hand for myIndex,
// otherwise the opponent's bubble centre. Used as the source/sink for swap
// and global_switch trail animations.
export function seatPosition<T extends PlayerLike>(
  playerIndex: number,
  players: T[],
  myIndex: number,
  width: number,
  height: number,
): { x: number; y: number } {
  if (playerIndex === myIndex) {
    return { x: width / 2, y: height - CARD_H / 2 - 20 }
  }
  const others = clockwiseOpponents(players, myIndex)
  const positions = opponentBubblePositions(others.length, width, height)
  const i = others.findIndex((p) => p.index === playerIndex)
  if (i < 0) return { x: width / 2, y: height / 2 }
  return positions[i]
}
