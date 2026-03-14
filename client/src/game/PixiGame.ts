import * as PIXI from 'pixi.js'
import { CardDTO, CardColor } from '../types/protocol'
import { CARD_COLORS, ACTIVE_COLOR_BORDER } from './cardColors'

const CARD_W = 70
const CARD_H = 105
const CARD_RADIUS = 8
const ANIM_DURATION_MS = 350
const RECONNECT_ANIM_DURATION_MS = 500

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
  duration: number
  onDone?: () => void
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

  /**
   * Animate recovery after reconnect: rebuild the table with staggered entrance animations.
   * Elements fade/slide in over ~800ms. onComplete fires when all animations have settled.
   */
  renderReconnect(state: GameRenderState, onComplete?: () => void) {
    const { width, height } = this.app.screen

    // Reset discard key so the regular render path doesn't re-animate
    this.lastDiscardKey = state.discard
      ? `${state.discard.color}-${state.discard.kind}-${state.discard.value}`
      : ''

    this.handContainer.removeChildren()
    this.discardContainer.removeChildren()
    this.uiContainer.removeChildren()
    this.animations = []

    // 1. Discard pile — fade + scale in from center
    if (state.discard) {
      const card = this.drawCard(state.discard, state.activeColor)
      const targetX = width / 2 - CARD_W / 2
      const targetY = height / 2 - CARD_H / 2
      card.x = targetX
      card.y = targetY
      card.alpha = 0
      card.scale.set(0.5)
      this.discardContainer.addChild(card)

      // Active color ring (starts invisible too)
      const ring = new PIXI.Graphics()
      ring.rect(targetX - 6, targetY - 6, CARD_W + 12, CARD_H + 12)
      ring.stroke({ color: ACTIVE_COLOR_BORDER[state.activeColor], width: 3, alpha: 0.8 })
      ring.alpha = 0
      this.discardContainer.addChildAt(ring, 0)

      this.animations.push({
        container: card,
        startX: targetX,
        startY: targetY,
        endX: targetX,
        endY: targetY,
        startAlpha: 0,
        endAlpha: 1,
        startScale: 0.5,
        endScale: 1,
        elapsed: 0,
        duration: RECONNECT_ANIM_DURATION_MS,
      })
      this.animations.push({
        container: ring,
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
        startAlpha: 0,
        endAlpha: 1,
        startScale: 1,
        endScale: 1,
        elapsed: 0,
        duration: RECONNECT_ANIM_DURATION_MS,
      })
    }

    // 2. Player info bubbles — fade in from above with a small stagger
    const others = state.players.filter((p) => p.index !== state.myIndex)
    const angleStep = (Math.PI * 2) / (others.length || 1)
    const cx = width / 2
    const cy = height * 0.35
    others.forEach((p, i) => {
      const angle = -Math.PI / 2 + angleStep * i
      const rx = cx + Math.cos(angle) * (width * 0.35)
      const ry = cy + Math.sin(angle) * (height * 0.2)

      const container = this._buildPlayerBubble(p, state.currentTurn)
      container.x = rx
      container.y = ry - 20 // start slightly above
      container.alpha = 0
      this.uiContainer.addChild(container)

      const delay = 150 + i * 80
      this.animations.push({
        container,
        startX: rx,
        startY: ry - 20,
        endX: rx,
        endY: ry,
        startAlpha: 0,
        endAlpha: 1,
        startScale: 1,
        endScale: 1,
        elapsed: -delay,
        duration: RECONNECT_ANIM_DURATION_MS,
      })
    })

    // 3. Turn indicator — fade in
    const turnText = this._buildTurnIndicator(state, width, height)
    turnText.alpha = 0
    this.uiContainer.addChild(turnText)
    this.animations.push({
      container: turnText,
      startX: turnText.x,
      startY: turnText.y,
      endX: turnText.x,
      endY: turnText.y,
      startAlpha: 0,
      endAlpha: 1,
      startScale: 1,
      endScale: 1,
      elapsed: -200,
      duration: RECONNECT_ANIM_DURATION_MS,
    })

    // 4. Hand cards — slide up from below with stagger
    const n = state.myHand.length
    if (n > 0) {
      const totalWidth = n * (CARD_W + 8) - 8
      const startX = Math.max(8, width / 2 - totalWidth / 2)
      const targetY = height - CARD_H - 20

      const lastIdx = n - 1
      state.myHand.forEach((card, i) => {
        const sprite = this.drawCard(card, state.activeColor, true)
        const cardX = startX + i * (CARD_W + 8)
        sprite.x = cardX
        sprite.y = targetY + 40
        sprite.alpha = 0
        sprite.eventMode = 'static'
        sprite.cursor = 'pointer'
        sprite.on('pointerover', () => { sprite.y = targetY - 10 })
        sprite.on('pointerout', () => { sprite.y = targetY })
        sprite.on('pointertap', () => { this.onCardClick(card, i) })
        this.handContainer.addChild(sprite)

        const delay = 300 + i * 40
        const isLast = i === lastIdx
        this.animations.push({
          container: sprite,
          startX: cardX,
          startY: targetY + 40,
          endX: cardX,
          endY: targetY,
          startAlpha: 0,
          endAlpha: 1,
          startScale: 1,
          endScale: 1,
          elapsed: -delay,
          duration: RECONNECT_ANIM_DURATION_MS,
          onDone: isLast && onComplete ? onComplete : undefined,
        })
      })
    } else if (onComplete) {
      // No hand cards — fire onComplete after the other animations settle
      setTimeout(onComplete, RECONNECT_ANIM_DURATION_MS + 400)
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
      duration: ANIM_DURATION_MS,
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
      duration: ANIM_DURATION_MS,
    })
  }

  private updateAnimations(deltaMS: number) {
    this.animations = this.animations.filter((anim) => {
      anim.elapsed += deltaMS
      if (anim.elapsed < 0) return true // waiting for delay

      const t = Math.min(anim.elapsed / anim.duration, 1)
      const ease = easeOutCubic(t)

      anim.container.x = lerp(anim.startX, anim.endX, ease)
      anim.container.y = lerp(anim.startY, anim.endY, ease)
      anim.container.alpha = lerp(anim.startAlpha, anim.endAlpha, ease)
      const scale = lerp(anim.startScale, anim.endScale, ease)
      anim.container.scale.set(scale)

      if (t >= 1) {
        if (anim.onDone) anim.onDone()
        // Only remove from animContainer, not from handContainer/discardContainer/uiContainer
        if (this.animContainer.children.includes(anim.container)) {
          this.animContainer.removeChild(anim.container)
        }
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

  private renderPlayerInfo(state: GameRenderState, width: number, height: number) {
    const others = state.players.filter((p) => p.index !== state.myIndex)
    const angleStep = (Math.PI * 2) / (others.length || 1)
    const cx = width / 2
    const cy = height * 0.35

    others.forEach((p, i) => {
      const angle = -Math.PI / 2 + angleStep * i
      const rx = cx + Math.cos(angle) * (width * 0.35)
      const ry = cy + Math.sin(angle) * (height * 0.2)

      const container = this._buildPlayerBubble(p, state.currentTurn)
      container.x = rx
      container.y = ry
      this.uiContainer.addChild(container)
    })
  }

  /** Build a player info bubble container (shared by render and reconnect paths). */
  private _buildPlayerBubble(
    p: { nickname: string; hand_size: number; index: number; connected?: boolean },
    currentTurn: number
  ): PIXI.Container {
    const container = new PIXI.Container()
    const isCurrentTurn = p.index === currentTurn
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

    return container
  }

  private renderTurnIndicator(state: GameRenderState, width: number, height: number) {
    const text = this._buildTurnIndicator(state, width, height)
    this.uiContainer.addChild(text)
  }

  /** Build the turn indicator text (shared by render and reconnect paths). */
  private _buildTurnIndicator(state: GameRenderState, width: number, height: number): PIXI.Text {
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
    return text
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
