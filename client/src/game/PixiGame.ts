import * as PIXI from 'pixi.js'
import { CardDTO, CardColor } from '../types/protocol'
import { CARD_COLORS, ACTIVE_COLOR_BORDER } from './cardColors'

const CARD_W = 70
const CARD_H = 105
const CARD_RADIUS = 8
const ANIM_DURATION_MS = 350

export interface GameRenderState {
  myHand: CardDTO[]
  discard: CardDTO | null
  activeColor: CardColor
  players: { nickname: string; hand_size: number; index: number; connected?: boolean }[]
  myIndex: number
  currentTurn: number
  pendingDraw: number
}

type OnCardClick = (card: CardDTO, idx: number) => void

interface AnimTarget {
  container: PIXI.Container
  startX: number
  startY: number
  endX: number
  endY: number
  startAlpha: number
  endAlpha: number
  startScale: number
  endScale: number
  elapsed: number
}

export class PixiGame {
  app: PIXI.Application
  private handContainer: PIXI.Container
  private discardContainer: PIXI.Container
  private uiContainer: PIXI.Container
  private animContainer: PIXI.Container
  private onCardClick: OnCardClick
  private animations: AnimTarget[] = []
  private lastDiscardKey = ''

  constructor(_canvas: HTMLCanvasElement, onCardClick: OnCardClick) {
    this.onCardClick = onCardClick
    this.app = new PIXI.Application()
    this.handContainer = new PIXI.Container()
    this.discardContainer = new PIXI.Container()
    this.uiContainer = new PIXI.Container()
    this.animContainer = new PIXI.Container()
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
    this.app.stage.addChild(this.animContainer)

    // Animation ticker
    this.app.ticker.add((ticker) => {
      this.updateAnimations(ticker.deltaMS)
    })
  }

  render(state: GameRenderState) {
    const { width, height } = this.app.screen

    // Detect new discard card → animate it flying in
    const newDiscardKey = state.discard ? `${state.discard.color}-${state.discard.kind}-${state.discard.value}` : ''
    const discardChanged = newDiscardKey !== this.lastDiscardKey && newDiscardKey !== ''
    this.lastDiscardKey = newDiscardKey

    this.handContainer.removeChildren()
    this.discardContainer.removeChildren()
    this.uiContainer.removeChildren()

    this.renderDiscard(state, width, height)
    this.renderHand(state, width, height, discardChanged)
    this.renderPlayerInfo(state, width, height)
    this.renderTurnIndicator(state, width, height)

    // Animate a new card onto the discard pile
    if (discardChanged && state.discard) {
      this.animateCardToDiscard(state.discard, state.activeColor, width, height)
    }
  }

  private animateCardToDiscard(
    card: CardDTO,
    activeColor: CardColor,
    width: number,
    height: number
  ) {
    const sprite = this.drawCard(card, activeColor)
    sprite.alpha = 0.1
    sprite.scale.set(0.6)
    // Start from the bottom (hand area)
    sprite.x = width / 2 - CARD_W / 2
    sprite.y = height - CARD_H - 20
    this.animContainer.addChild(sprite)

    const targetX = width / 2 - CARD_W / 2
    const targetY = height / 2 - CARD_H / 2

    this.animations.push({
      container: sprite,
      startX: sprite.x,
      startY: sprite.y,
      endX: targetX,
      endY: targetY,
      startAlpha: 0.1,
      endAlpha: 1,
      startScale: 0.6,
      endScale: 1,
      elapsed: 0,
    })
  }

  // Animate a card being drawn: fly from deck area down to hand area
  animateCardDrawn(card: CardDTO, activeColor: CardColor) {
    const { width, height } = this.app.screen
    const sprite = this.drawCard(card, activeColor)
    sprite.alpha = 0.1
    sprite.scale.set(0.6)
    // Start from deck position (left of center)
    sprite.x = width / 2 - CARD_W - 20
    sprite.y = height / 2 - CARD_H / 2
    this.animContainer.addChild(sprite)

    this.animations.push({
      container: sprite,
      startX: sprite.x,
      startY: sprite.y,
      endX: width / 2 - CARD_W / 2,
      endY: height - CARD_H - 20,
      startAlpha: 0.1,
      endAlpha: 1,
      startScale: 0.6,
      endScale: 1,
      elapsed: 0,
    })
  }

  private updateAnimations(deltaMS: number) {
    this.animations = this.animations.filter((anim) => {
      anim.elapsed += deltaMS
      const t = Math.min(anim.elapsed / ANIM_DURATION_MS, 1)
      const ease = easeOutCubic(t)

      anim.container.x = lerp(anim.startX, anim.endX, ease)
      anim.container.y = lerp(anim.startY, anim.endY, ease)
      anim.container.alpha = lerp(anim.startAlpha, anim.endAlpha, ease)
      const scale = lerp(anim.startScale, anim.endScale, ease)
      anim.container.scale.set(scale)

      if (t >= 1) {
        this.animContainer.removeChild(anim.container)
        return false
      }
      return true
    })
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

  private renderHand(
    state: GameRenderState,
    width: number,
    height: number,
    _discardChanged: boolean
  ) {
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

      const isCurrentTurn = p.index === state.currentTurn
      const isDisconnected = p.connected === false

      const bg = new PIXI.Graphics()
      bg.roundRect(-60, -18, 120, 36, 6)
      bg.fill({ color: isDisconnected ? 0x333333 : isCurrentTurn ? 0x4d96ff : 0x16213e, alpha: 0.9 })
      container.addChild(bg)

      const label = isDisconnected ? `${p.nickname} ✗ (${p.hand_size})` : `${p.nickname} (${p.hand_size})`
      const text = new PIXI.Text({
        text: label,
        style: {
          fontSize: 13,
          fill: isDisconnected ? '#666666' : '#ffffff',
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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}
