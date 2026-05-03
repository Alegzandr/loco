// Card colour palette and shared dimensions for the React rendering layer.
import { CardColor, CardDTO } from '../../types/protocol'

export const CARD_FACE: Record<CardColor, string> = {
  red: '#d63031',
  yellow: '#fdcb6e',
  green: '#00b894',
  blue: '#0984e3',
  wild: '#2d3436',
}

export const CARD_FACE_LIGHT: Record<CardColor, string> = {
  red: '#ff7675',
  yellow: '#ffeaa7',
  green: '#55efc4',
  blue: '#74b9ff',
  wild: '#636e72',
}

export const ACTIVE_RING: Record<CardColor, string> = {
  red: '#ff6b6b',
  yellow: '#ffd93d',
  green: '#6bcb77',
  blue: '#4d96ff',
  wild: '#aaaaaa',
}

export const CARD_W = 72
export const CARD_H = 108
export const CARD_RADIUS = 10
// Reserved for the action bar so cards never overlap it.
export const BOTTOM_RESERVE = 82

export function cardLabel(card: CardDTO): string {
  switch (card.kind) {
    case 'number': return String(card.value ?? 0)
    case 'skip': return '⊘'
    case 'reverse': return '⇄'
    case 'draw_two': return '+2'
    case 'wild': return 'W'
    case 'wild_draw_four': return '+4'
    case 'swap': return '⇋'
    case 'global_switch': return '↻'
    default: return '?'
  }
}

// Stable key for diffing/animation lists.
export function cardKey(card: CardDTO, suffix?: string | number): string {
  const base = `${card.color}-${card.kind}-${card.value ?? ''}`
  return suffix === undefined ? base : `${base}-${suffix}`
}
