import * as PIXI from 'pixi.js'
import { CardDTO, CardColor } from '../types/protocol'
import { CARD_COLORS, CARD_COLORS_LIGHT, ACTIVE_COLOR_BORDER } from './cardColors'

const CARD_W = 72
const CARD_H = 108
const CARD_RADIUS = 10
const CARD_GAP = -16 // overlap cards in hand
const RECONNECT_ANIM_DURATION_MS = 500

export interface GameRenderState {
  myHand: CardDTO[]
  discard: CardDTO | null
  activeColor: CardColor
  players: { nickname: string; hand_size: number; index: number; connected?: boolean; finished?: boolean; placement?: number }[]
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
  duration: number
  onDone?: () => void
}

export class PixiGame {
  app: PIXI.Application
  private handContainer: PIXI.Container
  private discardContainer: PIXI.Container
  private uiContainer: PIXI.Container
  private animContainer: PIXI.Container
  private bgContainer: PIXI.Container
  private onCardClick: OnCardClick
  private animations: AnimTarget[] = []
  private lastDiscardKey = ''
  private initialized = false
  private destroyed = false
  private initStarted = false

  constructor(onCardClick: OnCardClick) {
    this.onCardClick = onCardClick
    this.app = new PIXI.Application()
    this.bgContainer = new PIXI.Container()
    this.handContainer = new PIXI.Container()
    this.discardContainer = new PIXI.Container()
    this.uiContainer = new PIXI.Container()
    this.animContainer = new PIXI.Container()
  }

  async init(canvas: HTMLCanvasElement) {
    this.initStarted = true
    await this.app.init({
      canvas,
      resizeTo: canvas.parentElement ?? window,
      backgroundColor: 0x0a0e1a,
      antialias: true,
    })
    if (this.destroyed) return
    this.app.stage.addChild(this.bgContainer)
    this.app.stage.addChild(this.discardContainer)
    this.app.stage.addChild(this.handContainer)
    this.app.stage.addChild(this.uiContainer)
    this.app.stage.addChild(this.animContainer)

    this.app.ticker.add((ticker) => {
      this.updateAnimations(ticker.deltaMS)
    })
    this.initialized = true
  }

  render(state: GameRenderState) {
    if (!this.initialized) return
    const { width, height } = this.app.screen

    const newDiscardKey = state.discard ? `${state.discard.color}-${state.discard.kind}-${state.discard.value}` : ''
    const discardChanged = newDiscardKey !== this.lastDiscardKey && newDiscardKey !== ''
    this.lastDiscardKey = newDiscardKey

    this.bgContainer.removeChildren()
    this.handContainer.removeChildren()
    this.discardContainer.removeChildren()
    this.uiContainer.removeChildren()

    this.renderBackground(width, height)
    this.renderDeckBack(width, height)
    this.renderDiscard(state, width, height)
    this.renderHand(state, width, height)
    this.renderPlayerInfo(state, width, height)
    this.renderTurnIndicator(state, width, height)

    if (discardChanged && state.discard) {
      this.animateCardToDiscard(state.discard, width, height)
    }
  }

  renderReconnect(state: GameRenderState, onComplete?: () => void) {
    if (!this.initialized) { onComplete?.(); return }
    const { width, height } = this.app.screen

    this.lastDiscardKey = state.discard
      ? `${state.discard.color}-${state.discard.kind}-${state.discard.value}`
      : ''

    this.bgContainer.removeChildren()
    this.handContainer.removeChildren()
    this.discardContainer.removeChildren()
    this.uiContainer.removeChildren()
    this.animations = []

    this.renderBackground(width, height)
    this.renderDeckBack(width, height)

    // 1. Discard pile — fade + scale in
    if (state.discard) {
      const card = this.drawCard(state.discard)
      const targetX = width / 2 - CARD_W / 2 + 20
      const targetY = height / 2 - CARD_H / 2 - 30
      card.x = targetX
      card.y = targetY
      card.alpha = 0
      card.scale.set(0.5)
      this.discardContainer.addChild(card)

      const ring = this._drawActiveRing(state.activeColor, targetX, targetY)
      ring.alpha = 0
      this.discardContainer.addChildAt(ring, 0)

      this.animations.push(this._makeAnim(card, targetX, targetY, targetX, targetY, 0, 1, 0.5, 1, 0))
      this.animations.push(this._makeAnim(ring, 0, 0, 0, 0, 0, 1, 1, 1, 0))
    }

    // 2. Player bubbles
    this._renderBubblesAnimated(state, width, height)

    // 3. Turn indicator
    const turnText = this._buildTurnIndicator(state, width, height)
    turnText.alpha = 0
    this.uiContainer.addChild(turnText)
    this.animations.push(this._makeAnim(turnText, turnText.x, turnText.y, turnText.x, turnText.y, 0, 1, 1, 1, -200))

    // 4. Hand cards
    const n = state.myHand.length
    if (n > 0) {
      const handY = height - CARD_H - 24
      const cardSpacing = Math.min(CARD_W + CARD_GAP, (width - 32) / n)
      const totalWidth = n * cardSpacing
      const startX = Math.max(16, width / 2 - totalWidth / 2)

      const lastIdx = n - 1
      state.myHand.forEach((card, i) => {
        const sprite = this.drawCard(card, true)
        const cardX = startX + i * cardSpacing
        sprite.x = cardX
        sprite.y = handY + 40
        sprite.alpha = 0
        sprite.eventMode = 'static'
        sprite.cursor = 'pointer'
        sprite.on('pointerover', () => { sprite.y = handY - 12 })
        sprite.on('pointerout', () => { sprite.y = handY })
        sprite.on('pointertap', () => { this.onCardClick(card, i) })
        this.handContainer.addChild(sprite)

        const delay = 300 + i * 40
        this.animations.push({
          ...this._makeAnim(sprite, cardX, handY + 40, cardX, handY, 0, 1, 1, 1, -delay),
          onDone: i === lastIdx && onComplete ? onComplete : undefined,
        })
      })
    } else if (onComplete) {
      setTimeout(onComplete, RECONNECT_ANIM_DURATION_MS + 400)
    }
  }

  private renderBackground(width: number, height: number) {
    // Table felt gradient
    const bg = new PIXI.Graphics()
    bg.rect(0, 0, width, height)
    bg.fill({ color: 0x0a0e1a })
    this.bgContainer.addChild(bg)

    // Subtle table oval
    const tableOval = new PIXI.Graphics()
    const cx = width / 2
    const cy = height / 2 - 20
    tableOval.ellipse(cx, cy, width * 0.42, height * 0.28)
    tableOval.fill({ color: 0x0f1629, alpha: 0.8 })
    tableOval.stroke({ color: 0x1a2744, width: 2, alpha: 0.5 })
    this.bgContainer.addChild(tableOval)
  }

  private renderDeckBack(width: number, height: number) {
    const deckX = width / 2 - CARD_W - 30
    const deckY = height / 2 - CARD_H / 2 - 30

    // Stacked deck visual (3 cards offset)
    for (let i = 2; i >= 0; i--) {
      const back = this._drawCardBack()
      back.x = deckX + i * 2
      back.y = deckY + i * 2
      back.alpha = 0.6 + i * 0.15
      this.discardContainer.addChild(back)
    }
  }

  private _drawCardBack(): PIXI.Container {
    const container = new PIXI.Container()
    const bg = new PIXI.Graphics()
    bg.roundRect(0, 0, CARD_W, CARD_H, CARD_RADIUS)
    bg.fill({ color: 0x1a1a3e })
    bg.stroke({ color: 0x2a2a5e, width: 1.5 })
    container.addChild(bg)

    // Inner pattern
    const inner = new PIXI.Graphics()
    inner.roundRect(6, 6, CARD_W - 12, CARD_H - 12, 6)
    inner.fill({ color: 0x22224a })
    inner.stroke({ color: 0x33336a, width: 1 })
    container.addChild(inner)

    // LOCO text
    const text = new PIXI.Text({
      text: 'L',
      style: { fontSize: 24, fill: '#4d96ff', fontWeight: 'bold' },
    })
    text.anchor.set(0.5)
    text.x = CARD_W / 2
    text.y = CARD_H / 2
    text.alpha = 0.4
    container.addChild(text)

    return container
  }

  private renderDiscard(state: GameRenderState, width: number, height: number) {
    if (!state.discard) return

    const discardX = width / 2 - CARD_W / 2 + 20
    const discardY = height / 2 - CARD_H / 2 - 30

    // Active color ring
    const ring = this._drawActiveRing(state.activeColor, discardX, discardY)
    this.discardContainer.addChild(ring)

    // Card
    const card = this.drawCard(state.discard)
    card.x = discardX
    card.y = discardY
    this.discardContainer.addChild(card)
  }

  private _drawActiveRing(color: CardColor, x: number, y: number): PIXI.Graphics {
    const ring = new PIXI.Graphics()
    ring.roundRect(x - 5, y - 5, CARD_W + 10, CARD_H + 10, CARD_RADIUS + 3)
    ring.stroke({ color: ACTIVE_COLOR_BORDER[color], width: 3, alpha: 0.7 })
    return ring
  }

  private renderHand(state: GameRenderState, width: number, height: number) {
    const n = state.myHand.length
    if (n === 0) return

    const handY = height - CARD_H - 24
    const isMyTurn = state.currentTurn === state.myIndex

    // Cards overlap with dynamic spacing based on count
    const maxSpacing = CARD_W + 6
    const minSpacing = 24
    const availWidth = width - 32
    const cardSpacing = Math.max(minSpacing, Math.min(maxSpacing, availWidth / n))
    const totalWidth = n * cardSpacing
    const startX = Math.max(16, width / 2 - totalWidth / 2)

    state.myHand.forEach((card, i) => {
      const sprite = this.drawCard(card, true, isMyTurn)
      const x = startX + i * cardSpacing
      sprite.x = x
      sprite.y = handY
      sprite.zIndex = i
      sprite.eventMode = 'static'
      sprite.cursor = isMyTurn ? 'pointer' : 'default'

      sprite.on('pointerover', () => { sprite.y = handY - 14; sprite.zIndex = 100 })
      sprite.on('pointerout', () => { sprite.y = handY; sprite.zIndex = i })
      sprite.on('pointertap', () => { this.onCardClick(card, i) })

      this.handContainer.addChild(sprite)
    })
    this.handContainer.sortableChildren = true
  }

  private renderPlayerInfo(state: GameRenderState, width: number, height: number) {
    const others = state.players.filter((p) => p.index !== state.myIndex)
    if (others.length === 0) return

    if (others.length === 1) {
      // 1v1: opponent centered at top
      const p = others[0]
      const container = this._buildPlayerBubble(p, state.currentTurn)
      container.x = width / 2
      container.y = 50
      this.uiContainer.addChild(container)
      return
    }

    // Multiple opponents: arc at top
    const angleStep = Math.PI / (others.length + 1)
    const cx = width / 2
    const radiusX = width * 0.38
    const radiusY = height * 0.15

    others.forEach((p, i) => {
      const angle = Math.PI + angleStep * (i + 1)
      const rx = cx + Math.cos(angle) * radiusX
      const ry = 60 + Math.sin(angle) * radiusY

      const container = this._buildPlayerBubble(p, state.currentTurn)
      container.x = rx
      container.y = ry
      this.uiContainer.addChild(container)
    })
  }

  private _renderBubblesAnimated(state: GameRenderState, width: number, height: number) {
    const others = state.players.filter((p) => p.index !== state.myIndex)
    if (others.length === 0) return

    const positions: { x: number; y: number }[] = []
    if (others.length === 1) {
      positions.push({ x: width / 2, y: 50 })
    } else {
      const angleStep = Math.PI / (others.length + 1)
      const cx = width / 2
      const radiusX = width * 0.38
      const radiusY = height * 0.15
      others.forEach((_, i) => {
        const angle = Math.PI + angleStep * (i + 1)
        positions.push({
          x: cx + Math.cos(angle) * radiusX,
          y: 60 + Math.sin(angle) * radiusY,
        })
      })
    }

    others.forEach((p, i) => {
      const { x, y } = positions[i]
      const container = this._buildPlayerBubble(p, state.currentTurn)
      container.x = x
      container.y = y - 20
      container.alpha = 0
      this.uiContainer.addChild(container)

      const delay = 150 + i * 80
      this.animations.push(this._makeAnim(container, x, y - 20, x, y, 0, 1, 1, 1, -delay))
    })
  }

  private _buildPlayerBubble(
    p: { nickname: string; hand_size: number; index: number; connected?: boolean; finished?: boolean; placement?: number },
    currentTurn: number
  ): PIXI.Container {
    const container = new PIXI.Container()
    const isCurrentTurn = p.index === currentTurn
    const isDisconnected = p.connected === false
    const isFinished = !!p.finished

    let bgColor: number
    let borderColor: number
    if (isFinished) { bgColor = 0x2d2a0a; borderColor = 0x5a5520 }
    else if (isDisconnected) { bgColor = 0x222222; borderColor = 0x444444 }
    else if (isCurrentTurn) { bgColor = 0x0d3875; borderColor = 0x4d96ff }
    else { bgColor = 0x121830; borderColor = 0x1e2d50 }

    const pillW = 140
    const pillH = 40
    const bg = new PIXI.Graphics()
    bg.roundRect(-pillW / 2, -pillH / 2, pillW, pillH, pillH / 2)
    bg.fill({ color: bgColor, alpha: 0.92 })
    bg.stroke({ color: borderColor, width: isCurrentTurn ? 2 : 1, alpha: 0.8 })
    container.addChild(bg)

    let label: string
    let textColor: string
    const fontSize = 13
    if (isFinished) {
      const badge = placementSuffix(p.placement ?? 0)
      label = `${badge} · ${p.nickname}`
      textColor = '#ffd93d'
    } else if (isDisconnected) {
      label = `${p.nickname} ✗`
      textColor = '#666666'
    } else {
      label = `${p.nickname}`
      textColor = isCurrentTurn ? '#74b9ff' : '#b8c4d6'
    }

    const text = new PIXI.Text({
      text: label,
      style: {
        fontSize,
        fill: textColor,
        fontWeight: isCurrentTurn ? 'bold' : 'normal',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      },
    })
    text.anchor.set(0.5)
    text.y = isFinished ? 0 : -3
    container.addChild(text)

    // Card count badge (for non-finished players)
    if (!isFinished) {
      const countText = new PIXI.Text({
        text: `${p.hand_size} cards`,
        style: {
          fontSize: 10,
          fill: '#666d80',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        },
      })
      countText.anchor.set(0.5)
      countText.y = 10
      container.addChild(countText)
    }

    // Turn indicator dot
    if (isCurrentTurn && !isFinished) {
      const dot = new PIXI.Graphics()
      dot.circle(0, -pillH / 2 - 6, 4)
      dot.fill({ color: 0x4d96ff })
      container.addChild(dot)
    }

    return container
  }

  private renderTurnIndicator(state: GameRenderState, width: number, height: number) {
    const text = this._buildTurnIndicator(state, width, height)
    this.uiContainer.addChild(text)
  }

  private _buildTurnIndicator(state: GameRenderState, width: number, height: number): PIXI.Text {
    const isMyTurn = state.currentTurn === state.myIndex
    const msg = isMyTurn
      ? state.pendingDraw > 0
        ? `Draw ${state.pendingDraw} or counter!`
        : 'Your turn'
      : `${state.players.find((p) => p.index === state.currentTurn)?.nickname ?? '?'}'s turn`

    const text = new PIXI.Text({
      text: msg,
      style: {
        fontSize: 15,
        fill: isMyTurn ? '#ffd93d' : '#5a6580',
        fontWeight: 'bold',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      },
    })
    text.anchor.set(0.5, 0)
    text.x = width / 2
    text.y = height - CARD_H - 54
    return text
  }

  private animateCardToDiscard(card: CardDTO, width: number, height: number) {
    const sprite = this.drawCard(card)
    sprite.alpha = 0.1
    sprite.scale.set(0.6)
    sprite.x = width / 2 - CARD_W / 2
    sprite.y = height - CARD_H - 20
    this.animContainer.addChild(sprite)

    const targetX = width / 2 - CARD_W / 2 + 20
    const targetY = height / 2 - CARD_H / 2 - 30

    this.animations.push(this._makeAnim(sprite, sprite.x, sprite.y, targetX, targetY, 0.1, 1, 0.6, 1, 0))
  }

  animateCardDrawn(card: CardDTO) {
    const { width, height } = this.app.screen
    const sprite = this.drawCard(card)
    sprite.alpha = 0.1
    sprite.scale.set(0.6)
    sprite.x = width / 2 - CARD_W - 30
    sprite.y = height / 2 - CARD_H / 2 - 30
    this.animContainer.addChild(sprite)

    this.animations.push(this._makeAnim(
      sprite, sprite.x, sprite.y,
      width / 2 - CARD_W / 2, height - CARD_H - 24,
      0.1, 1, 0.6, 1, 0
    ))
  }

  private _makeAnim(
    container: PIXI.Container,
    sx: number, sy: number, ex: number, ey: number,
    sa: number, ea: number, ss: number, es: number,
    elapsed: number
  ): AnimTarget {
    return {
      container, startX: sx, startY: sy, endX: ex, endY: ey,
      startAlpha: sa, endAlpha: ea, startScale: ss, endScale: es,
      elapsed, duration: RECONNECT_ANIM_DURATION_MS,
    }
  }

  private updateAnimations(deltaMS: number) {
    this.animations = this.animations.filter((anim) => {
      anim.elapsed += deltaMS
      if (anim.elapsed < 0) return true

      const t = Math.min(anim.elapsed / anim.duration, 1)
      const ease = easeOutCubic(t)

      anim.container.x = lerp(anim.startX, anim.endX, ease)
      anim.container.y = lerp(anim.startY, anim.endY, ease)
      anim.container.alpha = lerp(anim.startAlpha, anim.endAlpha, ease)
      const scale = lerp(anim.startScale, anim.endScale, ease)
      anim.container.scale.set(scale)

      if (t >= 1) {
        if (anim.onDone) anim.onDone()
        if (this.animContainer.children.includes(anim.container)) {
          this.animContainer.removeChild(anim.container)
        }
        return false
      }
      return true
    })
  }

  private drawCard(card: CardDTO, interactive = false, playable = false): PIXI.Container {
    const container = new PIXI.Container()
    const color = CARD_COLORS[card.color]
    const lightColor = CARD_COLORS_LIGHT[card.color]

    // Card shadow
    if (interactive) {
      const shadow = new PIXI.Graphics()
      shadow.roundRect(2, 3, CARD_W, CARD_H, CARD_RADIUS)
      shadow.fill({ color: 0x000000, alpha: 0.25 })
      container.addChild(shadow)
    }

    // Card body
    const bg = new PIXI.Graphics()
    bg.roundRect(0, 0, CARD_W, CARD_H, CARD_RADIUS)
    bg.fill({ color })
    container.addChild(bg)

    // Top highlight strip
    const highlight = new PIXI.Graphics()
    highlight.roundRect(0, 0, CARD_W, CARD_H / 3, CARD_RADIUS)
    highlight.fill({ color: lightColor, alpha: 0.15 })
    container.addChild(highlight)

    // White center oval
    const oval = new PIXI.Graphics()
    oval.ellipse(CARD_W / 2, CARD_H / 2, CARD_W * 0.32, CARD_H * 0.38)
    oval.fill({ color: 0xffffff, alpha: 0.12 })
    container.addChild(oval)

    // Card label
    const label = this.cardLabel(card)
    const isNum = label.length === 1 && /\d/.test(label)
    const text = new PIXI.Text({
      text: label,
      style: {
        fontSize: isNum ? 34 : label.length <= 2 ? 22 : 14,
        fill: '#ffffff',
        fontWeight: 'bold',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        align: 'center',
        dropShadow: {
          color: '#00000066',
          blur: 2,
          distance: 1,
        },
      },
    })
    text.anchor.set(0.5)
    text.x = CARD_W / 2
    text.y = CARD_H / 2
    container.addChild(text)

    // Corner value
    if (label.length <= 3) {
      const corner = new PIXI.Text({
        text: label,
        style: {
          fontSize: 10,
          fill: '#ffffffcc',
          fontWeight: 'bold',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        },
      })
      corner.x = 5
      corner.y = 4
      container.addChild(corner)
    }

    // Border for interactive cards
    if (interactive) {
      const border = new PIXI.Graphics()
      border.roundRect(0, 0, CARD_W, CARD_H, CARD_RADIUS)
      border.stroke({ color: playable ? 0xffffff : 0x888888, width: playable ? 1.5 : 0.8, alpha: playable ? 0.5 : 0.2 })
      container.addChild(border)
    }

    return container
  }

  private cardLabel(card: CardDTO): string {
    switch (card.kind) {
      case 'number': return String(card.value ?? 0)
      case 'skip': return '⊘'
      case 'reverse': return '⇄'
      case 'draw_two': return '+2'
      case 'wild': return 'W'
      case 'wild_draw_four': return '+4'
      default: return '?'
    }
  }

  destroy() {
    // Idempotent: safe to call multiple times (React StrictMode double-invoke).
    if (this.destroyed) return
    this.destroyed = true
    // Only call app.destroy() if init() fully completed. If init() was still
    // in progress (initStarted=true, initialized=false), the internal PixiJS
    // resize handler (_cancelResize) has not been set up yet and calling
    // app.destroy() would throw. The in-progress init() checks this.destroyed
    // after its await and returns early without touching the stage.
    if (this.initialized) {
      try {
        this.app.destroy()
      } catch (err) {
        console.warn('PixiGame: error during app.destroy()', err)
      }
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function placementSuffix(rank: number): string {
  if (rank === 1) return '1st'
  if (rank === 2) return '2nd'
  if (rank === 3) return '3rd'
  return `${rank}th`
}
