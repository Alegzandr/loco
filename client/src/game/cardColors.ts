import { CardColor } from '../types/protocol'

export const CARD_COLORS: Record<CardColor, number> = {
  red: 0xd63031,
  yellow: 0xfdcb6e,
  green: 0x00b894,
  blue: 0x0984e3,
  wild: 0x2d3436,
}

export const CARD_COLORS_LIGHT: Record<CardColor, number> = {
  red: 0xff7675,
  yellow: 0xffeaa7,
  green: 0x55efc4,
  blue: 0x74b9ff,
  wild: 0x636e72,
}

export const ACTIVE_COLOR_BORDER: Record<CardColor, number> = {
  red: 0xff6b6b,
  yellow: 0xffd93d,
  green: 0x6bcb77,
  blue: 0x4d96ff,
  wild: 0xaaaaaa,
}
