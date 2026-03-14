import * as PIXI from 'pixi.js'
import { CardDTO, CardColor } from '../types/protocol'
import { CARD_COLORS, ACTIVE_COLOR_BORDER } from './cardColors'

const CARD_W = 70
const CARD_H = 105
const CARD_RADIUS = 8

export interface GameRenderState {
  myHand: CardDTO[]
  discard: CardDTO | null
  activeColor: CardColor
  players: { nickname: string; handSize: number; index: number }[]
  myIndex: number
  currentTurn: number
  pendingDraw: number
}

type OnCardClick = (card: CardDTO, idx: number) => void

export class PixiGame {
  app: PIXI.Application
  private handContainer: PIXI.Container
  private discardContainer: PIXI.Container
  private uiContainer: PIXI.Container
  private onCardClick: OnCardClick

  constructor(canvas: HTMLCanvasElement, onCardClick: OnCardClick) {
    this.onCardClick = onCardClick
    this.app = new PIXI.Application()
    this.handContainer = new PIXI.Container()
    this.discardContainer = new PIXI.Container()
    this.uiContainer = new PIXI.Container()
  }

  async init(canvas: HTMLCanvasElement) {
    await this.app.init({
      canvas,
      resizeTo: canvas.parentElement ?? window,
      backgroundColor: 0x1a1a2e,
      antialias: true,
    })
    this.app.stage.addChild(this.discardContainer)
    this.app.stage.addChild(this.handContainer)
    this.app.stage.addChild(this.uiContainer)
  }

  render(state: GameRenderState) {
    this.handContainer.removeChildren()
    this.discardContainer.removeChildren()
    this.uiContainer.removeChildren()

    const { width, height } = this.app.screen

    this.renderDiscard(state, width, height)
    this.renderHand(state, width, height)
    this.renderPlayerInfo(state, width, height)
    this.renderTurnIndicator(state, width, height)
  }

  private renderDiscard(state: GameRenderState, width: number, height: number) {
    if (!state.discard) return

    const card = this.drawCard(state.discard, state.activeColor)
    card.x = width / 2 - CARD_W / 2
    card.y = height / 2 - CARD_H / 2
    this.discardContainer.addChild(card)

    // Active color ring around discard
    const ring = new PIXI.Graphics()
    ring.rect(
      width / 2 - CARD_W / 2 - 6,
      height / 2 - CARD_H / 2 - 6,
      CARD_W + 12,
      CARD_H + 12
    )
    ring.stroke({ color: ACTIVE_COLOR_BORDER[state.activeColor], width: 3, alpha: 0.8 })
    this.discardContainer.addChildAt(ring, 0)
  }

  private renderHand(state: GameRenderState, width: number, height: number) {
    const n = state.myHand.length
    if (n === 0) return

    const totalWidth = n * (CARD_W + 8) - 8
    const startX = Math.max(8, width / 2 - totalWidth / 2)
    const y = height - CARD_H - 20

    state.myHand.forEach((card, i) => {
      const sprite = this.drawCard(card, state.activeColor, true)
      sprite.x = startX + i * (CARD_W + 8)
      sprite.y = y
      sprite.eventMode = 'static'
      sprite.cursor = 'pointer'

      sprite.on('pointerover', () => {
        sprite.y = y - 10
      })
      sprite.on('pointerout', () => {
        sprite.y = y
      })
      sprite.on('pointertap', () => {
        this.onCardClick(card, i)
      })

      this.handContainer.addChild(sprite)
    })
  }

  private renderPlayerInfo(state: GameRenderState, width: number, _height: number) {
    const others = state.players.filter((p) => p.index !== state.myIndex)
    const angleStep = (Math.PI * 2) / (others.length || 1)
    const cx = width / 2
    const cy = _height * 0.35

    others.forEach((p, i) => {
      const angle = -Math.PI / 2 + angleStep * i
      const rx = cx + Math.cos(angle) * (width * 0.35)
      const ry = cy + Math.sin(angle) * (_height * 0.2)

      const container = new PIXI.Container()
      container.x = rx
      container.y = ry

      const bg = new PIXI.Graphics()
      bg.roundRect(-60, -18, 120, 36, 6)
      const isCurrentTurn = p.index === state.currentTurn
      bg.fill({ color: isCurrentTurn ? 0x4d96ff : 0x16213e, alpha: 0.9 })
      container.addChild(bg)

      const text = new PIXI.Text({
        text: `${p.nickname} (${p.handSize})`,
        style: {
          fontSize: 13,
          fill: '#ffffff',
          fontWeight: isCurrentTurn ? 'bold' : 'normal',
        },
      })
      text.anchor.set(0.5)
      container.addChild(text)

      this.uiContainer.addChild(container)
    })
  }

  private renderTurnIndicator(state: GameRenderState, width: number, height: number) {
    const isMyTurn = state.currentTurn === state.myIndex
    const msg = isMyTurn
      ? state.pendingDraw > 0
        ? `Draw ${state.pendingDraw} or counter!`
        : 'Your turn!'
      : `${state.players.find((p) => p.index === state.currentTurn)?.nickname ?? '?'}'s turn`

    const text = new PIXI.Text({
      text: msg,
      style: {
        fontSize: 16,
        fill: isMyTurn ? '#ffd93d' : '#aaaaaa',
        fontWeight: 'bold',
      },
    })
    text.anchor.set(0.5, 0)
    text.x = width / 2
    text.y = height - CARD_H - 56
    this.uiContainer.addChild(text)
  }

  private drawCard(card: CardDTO, _activeColor: CardColor, interactive = false): PIXI.Container {
    const container = new PIXI.Container()

    const bg = new PIXI.Graphics()
    const color = CARD_COLORS[card.color]
    bg.roundRect(0, 0, CARD_W, CARD_H, CARD_RADIUS)
    bg.fill({ color })
    if (interactive) {
      bg.stroke({ color: 0xffffff, width: 1, alpha: 0.3 })
    }
    container.addChild(bg)

    // White oval in center
    const oval = new PIXI.Graphics()
    oval.ellipse(CARD_W / 2, CARD_H / 2, CARD_W * 0.35, CARD_H * 0.42)
    oval.fill({ color: 0xffffff, alpha: 0.15 })
    container.addChild(oval)

    // Card label
    const label = this.cardLabel(card)
    const text = new PIXI.Text({
      text: label,
      style: {
        fontSize: label.length === 1 ? 32 : 14,
        fill: '#ffffff',
        fontWeight: 'bold',
        align: 'center',
      },
    })
    text.anchor.set(0.5)
    text.x = CARD_W / 2
    text.y = CARD_H / 2
    container.addChild(text)

    return container
  }

  private cardLabel(card: CardDTO): string {
    switch (card.kind) {
      case 'number':
        return String(card.value ?? 0)
      case 'skip':
        return '⊘'
      case 'reverse':
        return '⇄'
      case 'draw_two':
        return '+2'
      case 'wild':
        return 'W'
      case 'wild_draw_four':
        return '+4'
      default:
        return '?'
    }
  }

  destroy() {
    this.app.destroy()
  }
}
