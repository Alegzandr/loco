import * as PIXI from 'pixi.js'
import { CardDTO, CardColor } from '../types/protocol'
import { CARD_COLORS, CARD_COLORS_LIGHT, ACTIVE_COLOR_BORDER } from './cardColors'

const CARD_W = 72
const CARD_H = 108
const CARD_RADIUS = 10
const ANIM_DURATION_MS = 300
const RECONNECT_ANIM_DURATION_MS = 500

// Pixels reserved at the bottom for the action bar so cards are never obscured.
const BOTTOM_RESERVE = 82

export interface TurnTexts {
  yourTurn: string
  drawOrCounter: string  // contains %n placeholder
  playerTurnSuffix: string
  // Ordinal suffixes for finished-player placement badges
  ord1: string
  ord2: string
  ord3: string
  ordN: string  // suffix appended after rank number for 4th+
}

export interface GameRenderState {
  myHand: CardDTO[]
  discard: CardDTO | null
  activeColor: CardColor
  players: { nickname: string; hand_size: number; index: number; connected?: boolean; finished?: boolean; placement?: number }[]
  myIndex: number
  currentTurn: number
  pendingDraw: number
  turnTexts?: TurnTexts
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
  startRotation: number
  endRotation: number
  elapsed: number
  duration: number
  onDone?: () => void
}

// Track card positions for animation origins
interface CardSlot {
  x: number
  y: number
  rotation: number
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
  // Track last rendered hand card positions for play animation origin
  private handCardSlots: CardSlot[] = []
  private deckPos: { x: number; y: number } = { x: 0, y: 0 }

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
      const targetY = (height - BOTTOM_RESERVE) / 2 - CARD_H / 2
      card.x = targetX
      card.y = targetY
      card.alpha = 0
      card.scale.set(0.5)
      this.discardContainer.addChild(card)

      const ring = this._drawActiveRing(state.activeColor, targetX, targetY)
      ring.alpha = 0
      this.discardContainer.addChildAt(ring, 0)

      this.animations.push(this._makeAnim(card, targetX, targetY, targetX, targetY, 0, 1, 0.5, 1, 0, 0, 0))
      this.animations.push(this._makeAnim(ring, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0))
    }

    // 2. Player bubbles
    this._renderBubblesAnimated(state, width, height)

    // 3. Turn indicator
    const turnText = this._buildTurnIndicator(state, width, height)
    turnText.alpha = 0
    this.uiContainer.addChild(turnText)
    this.animations.push(this._makeAnim(turnText, turnText.x, turnText.y, turnText.x, turnText.y, 0, 1, 1, 1, 0, 0, -200))

    // 4. Hand cards with fan layout
    const n = state.myHand.length
    if (n > 0) {
      const slots = this._calcHandSlots(n, width, height)
      const lastIdx = n - 1
      state.myHand.forEach((card, i) => {
        const { x: cardX, y: handY, rotation: targetRot } = slots[i]
        const sprite = this.drawCard(card, true)
        sprite.x = cardX
        sprite.y = handY + 40
        sprite.alpha = 0
        sprite.rotation = targetRot
        sprite.eventMode = 'static'
        sprite.cursor = 'pointer'
        sprite.on('pointerover', () => {
          sprite.y = handY - 16
          sprite.scale.set(1.06)
          sprite.zIndex = 100
        })
        sprite.on('pointerout', () => {
          sprite.y = handY
          sprite.scale.set(1)
          sprite.zIndex = i
        })
        sprite.on('pointertap', () => { this.onCardClick(card, i) })
        this.handContainer.addChild(sprite)

        const delay = 300 + i * 40
        this.animations.push({
          ...this._makeAnim(sprite, cardX, handY + 40, cardX, handY, 0, 1, 1, 1, targetRot, targetRot, -delay),
          onDone: i === lastIdx && onComplete ? onComplete : undefined,
        })
      })
      this.handContainer.sortableChildren = true
    } else if (onComplete) {
      setTimeout(onComplete, RECONNECT_ANIM_DURATION_MS + 400)
    }
  }

  // Calculate fan layout positions for the player's hand.
  // BOTTOM_RESERVE keeps cards above the absolutely-positioned action bar.
  private _calcHandSlots(n: number, width: number, height: number): { x: number; y: number; rotation: number }[] {
    const baseY = height - CARD_H - BOTTOM_RESERVE
    const maxSpacing = CARD_W + 8
    const minSpacing = 20
    const availWidth = width - 40
    const cardSpacing = Math.max(minSpacing, Math.min(maxSpacing, availWidth / n))
    const totalWidth = (n - 1) * cardSpacing + CARD_W
    const startX = width / 2 - totalWidth / 2

    // Fan rotation: spread from -maxRot to +maxRot
    const maxRot = Math.min(0.12, 0.25 / Math.max(n, 1))

    return Array.from({ length: n }, (_, i) => {
      const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0  // -1 to 1
      return {
        x: startX + i * cardSpacing,
        y: baseY + Math.abs(t) * 6,  // slight arc: middle cards higher
        rotation: t * maxRot,
      }
    })
  }

  private renderBackground(width: number, height: number) {
    const bg = new PIXI.Graphics()
    bg.rect(0, 0, width, height)
    bg.fill({ color: 0x0a0e1a })
    this.bgContainer.addChild(bg)

    // Subtle table oval — centred in the playable area above the action bar
    const tableOval = new PIXI.Graphics()
    const cx = width / 2
    const cy = (height - BOTTOM_RESERVE) / 2 - 10
    tableOval.ellipse(cx, cy, width * 0.42, (height - BOTTOM_RESERVE) * 0.28)
    tableOval.fill({ color: 0x0f1629, alpha: 0.8 })
    tableOval.stroke({ color: 0x1a2744, width: 2, alpha: 0.5 })
    this.bgContainer.addChild(tableOval)
  }

  private renderDeckBack(width: number, height: number) {
    const deckX = width / 2 - CARD_W - 30
    const deckY = (height - BOTTOM_RESERVE) / 2 - CARD_H / 2

    // Track deck position for draw animation origin
    this.deckPos = { x: deckX, y: deckY }

    // Stacked deck visual (3 cards offset)
    for (let i = 2; i >= 0; i--) {
      const back = this._drawCardBack()
      back.x = deckX + i * 2
      back.y = deckY + i * 2
      back.alpha = 0.6 + i * 0.15
      this.discardContainer.addChild(back)
    }
  }

  private _drawCardBack(w = CARD_W, h = CARD_H, r = CARD_RADIUS): PIXI.Container {
    const container = new PIXI.Container()
    const bg = new PIXI.Graphics()
    bg.roundRect(0, 0, w, h, r)
    bg.fill({ color: 0x1a1a3e })
    bg.stroke({ color: 0x2a2a5e, width: 1.5 })
    container.addChild(bg)

    const inner = new PIXI.Graphics()
    inner.roundRect(w * 0.08, h * 0.06, w * 0.84, h * 0.88, Math.max(2, r * 0.5))
    inner.fill({ color: 0x22224a })
    inner.stroke({ color: 0x33336a, width: 1 })
    container.addChild(inner)

    if (w > 20) {
      const text = new PIXI.Text({
        text: 'L',
        style: { fontSize: Math.max(8, w * 0.33), fill: '#4d96ff', fontWeight: 'bold' },
      })
      text.anchor.set(0.5)
      text.x = w / 2
      text.y = h / 2
      text.alpha = 0.4
      container.addChild(text)
    }

    return container
  }

  private renderDiscard(state: GameRenderState, width: number, height: number) {
    if (!state.discard) return

    const discardX = width / 2 - CARD_W / 2 + 20
    const discardY = (height - BOTTOM_RESERVE) / 2 - CARD_H / 2

    const ring = this._drawActiveRing(state.activeColor, discardX, discardY)
    this.discardContainer.addChild(ring)

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
    if (n === 0) {
      this.handCardSlots = []
      return
    }

    const isMyTurn = state.currentTurn === state.myIndex
    const topCard = state.discard
    const activeColor = state.activeColor

    const slots = this._calcHandSlots(n, width, height)
    this.handCardSlots = slots

    state.myHand.forEach((card, i) => {
      const isPlayable = isMyTurn && topCard != null && _canPlayCard(card, topCard, activeColor)
      const { x: cardX, y: handY, rotation } = slots[i]

      const sprite = this.drawCard(card, true, isPlayable)
      sprite.x = cardX
      sprite.y = handY
      sprite.rotation = rotation
      sprite.zIndex = i
      sprite.eventMode = 'static'
      sprite.cursor = isMyTurn ? 'pointer' : 'default'

      sprite.on('pointerover', () => {
        sprite.y = handY - 16
        sprite.scale.set(1.07)
        sprite.zIndex = 100
        sprite.rotation = 0
      })
      sprite.on('pointerout', () => {
        sprite.y = handY
        sprite.scale.set(1)
        sprite.zIndex = i
        sprite.rotation = rotation
      })
      sprite.on('pointertap', () => { this.onCardClick(card, i) })

      this.handContainer.addChild(sprite)
    })
    this.handContainer.sortableChildren = true
  }

  private renderPlayerInfo(state: GameRenderState, width: number, height: number) {
    const others = state.players.filter((p) => p.index !== state.myIndex)
    if (others.length === 0) return

    if (others.length === 1) {
      const p = others[0]
      const container = this._buildPlayerBubble(p, state.currentTurn, state.turnTexts)
      container.x = width / 2
      container.y = 50
      this.uiContainer.addChild(container)
      return
    }

    const angleStep = Math.PI / (others.length + 1)
    const cx = width / 2
    const radiusX = width * 0.38
    const radiusY = height * 0.15

    others.forEach((p, i) => {
      const angle = Math.PI + angleStep * (i + 1)
      const rx = cx + Math.cos(angle) * radiusX
      const ry = 60 + Math.sin(angle) * radiusY

      const container = this._buildPlayerBubble(p, state.currentTurn, state.turnTexts)
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
      const container = this._buildPlayerBubble(p, state.currentTurn, state.turnTexts)
      container.x = x
      container.y = y - 20
      container.alpha = 0
      this.uiContainer.addChild(container)

      const delay = 150 + i * 80
      this.animations.push(this._makeAnim(container, x, y - 20, x, y, 0, 1, 1, 1, 0, 0, -delay))
    })
  }

  private _buildPlayerBubble(
    p: { nickname: string; hand_size: number; index: number; connected?: boolean; finished?: boolean; placement?: number },
    currentTurn: number,
    turnTexts?: TurnTexts
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

    // Wider pill to fit the fanned card backs; non-finished gets extra height for the fan.
    const pillW = 172
    const pillH = isFinished ? 38 : 66
    const bg = new PIXI.Graphics()
    bg.roundRect(-pillW / 2, -pillH / 2, pillW, pillH, pillH / 2)
    bg.fill({ color: bgColor, alpha: 0.92 })
    bg.stroke({ color: borderColor, width: isCurrentTurn ? 2 : 1, alpha: 0.8 })
    container.addChild(bg)

    let label: string
    let textColor: string
    const fontSize = 13
    if (isFinished) {
      const badge = _placementSuffix(p.placement ?? 0, turnTexts)
      label = `${badge} · ${p.nickname}`
      textColor = '#ffd93d'
    } else if (isDisconnected) {
      label = `${p.nickname} ✗`
      textColor = '#666666'
    } else {
      label = p.nickname
      textColor = isCurrentTurn ? '#74b9ff' : '#b8c4d6'
    }

    const nicknameY = isFinished ? 0 : -14
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
    text.y = nicknameY
    container.addChild(text)

    // Fanned mini card backs for non-finished players
    if (!isFinished && p.hand_size > 0) {
      const miniCards = this._buildMiniCardBacks(p.hand_size)
      // The fan container's origin is at the pivot bottom-centre of the first card;
      // shift up so the fan sits centred in the lower half of the pill.
      miniCards.y = 4
      container.addChild(miniCards)
    }

    // Turn indicator dot above the pill
    if (isCurrentTurn && !isFinished) {
      const dot = new PIXI.Graphics()
      dot.circle(0, -pillH / 2 - 6, 4)
      dot.fill({ color: 0x4d96ff })
      container.addChild(dot)
    }

    return container
  }

  // Build a fanned row of mini card backs representing an opponent's hand.
  // Cards are sized to be recognisably card-shaped and spread with a fan rotation.
  private _buildMiniCardBacks(count: number): PIXI.Container {
    const container = new PIXI.Container()
    const cw = 17
    const ch = 25
    const cr = 3
    const stride = 11    // horizontal step between card left edges (overlap = cw - stride)
    const maxVisible = 9
    const n = Math.min(count, maxVisible)
    const totalW = (n - 1) * stride + cw
    const startX = -totalW / 2

    // Fan rotation: spread ±maxRotDeg across the visible cards
    const maxRotDeg = n > 4 ? 14 : n > 1 ? 8 : 0
    const maxRot = (maxRotDeg * Math.PI) / 180

    for (let i = 0; i < n; i++) {
      const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0  // -1 (left) to +1 (right)
      const rot = t * maxRot
      const arcY = Math.abs(t) * 4  // edge cards drop slightly (arc)
      const back = this._drawCardBack(cw, ch, cr)
      // Rotate around the card's bottom centre for a natural fan pivot
      back.pivot.set(cw / 2, ch)
      back.x = startX + i * stride + cw / 2
      back.y = arcY + ch       // shift down by ch to compensate pivot
      back.rotation = rot
      back.alpha = 0.6 + (i / Math.max(n - 1, 1)) * 0.4
      container.addChild(back)
    }

    // Overflow label when hand exceeds maxVisible
    if (count > maxVisible) {
      const overflow = new PIXI.Text({
        text: `+${count - maxVisible}`,
        style: { fontSize: 9, fill: '#4d96ff', fontWeight: 'bold', fontFamily: 'system-ui, sans-serif' },
      })
      overflow.anchor.set(0, 0.5)
      overflow.x = startX + n * stride + 2
      overflow.y = ch / 2
      container.addChild(overflow)
    }

    return container
  }

  private renderTurnIndicator(state: GameRenderState, width: number, height: number) {
    const text = this._buildTurnIndicator(state, width, height)
    this.uiContainer.addChild(text)
  }

  private _buildTurnIndicator(state: GameRenderState, width: number, height: number): PIXI.Text {
    const isMyTurn = state.currentTurn === state.myIndex
    const texts = state.turnTexts
    let msg: string
    if (isMyTurn) {
      if (state.pendingDraw > 0) {
        const template = texts?.drawOrCounter ?? 'Draw %n or counter!'
        msg = template.replace('%n', String(state.pendingDraw))
      } else {
        msg = texts?.yourTurn ?? 'Your turn'
      }
    } else {
      const nickname = state.players.find((p) => p.index === state.currentTurn)?.nickname ?? '?'
      const suffix = texts?.playerTurnSuffix ?? "'s turn"
      msg = `${nickname}${suffix}`
    }

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
    text.y = height - CARD_H - BOTTOM_RESERVE - 34
    return text
  }

  // Animate a card from a hand position (or default) to the discard pile
  animateCardPlay(card: CardDTO, cardIdx: number, width: number, height: number) {
    const discardX = width / 2 - CARD_W / 2 + 20
    const discardY = height / 2 - CARD_H / 2 - 30

    // Use tracked slot position if available
    const slot = this.handCardSlots[cardIdx]
    const startX = slot ? slot.x : width / 2 - CARD_W / 2
    const startY = slot ? slot.y : height - CARD_H - 20
    const startRot = slot ? slot.rotation : 0

    const sprite = this.drawCard(card)
    sprite.x = startX
    sprite.y = startY
    sprite.rotation = startRot
    sprite.alpha = 0.9
    this.animContainer.addChild(sprite)

    this.animations.push(this._makeAnim(
      sprite, startX, startY, discardX, discardY,
      0.9, 1, 1, 1, startRot, 0, 0
    ))
  }

  private animateCardToDiscard(card: CardDTO, width: number, height: number) {
    // Fallback animation when we don't have the card index (opponent plays)
    const sprite = this.drawCard(card)
    sprite.alpha = 0.1
    sprite.scale.set(0.6)
    sprite.x = width / 2 - CARD_W / 2
    sprite.y = (height - BOTTOM_RESERVE) / 2

    const targetX = width / 2 - CARD_W / 2 + 20
    const targetY = (height - BOTTOM_RESERVE) / 2 - CARD_H / 2
    this.animContainer.addChild(sprite)

    this.animations.push(this._makeAnim(sprite, sprite.x, sprite.y, targetX, targetY, 0.1, 1, 0.6, 1, 0, 0, 0))
  }

  animateCardDrawn(_card: CardDTO) {
    if (!this.initialized) return
    const { width, height } = this.app.screen
    const sprite = this._drawCardBack()
    sprite.alpha = 0.1
    sprite.scale.set(0.7)
    sprite.x = this.deckPos.x
    sprite.y = this.deckPos.y
    this.animContainer.addChild(sprite)

    // Target: last slot in hand (approximate)
    const n = this.handCardSlots.length
    const targetSlot = n > 0 ? this.handCardSlots[n - 1] : null
    const targetX = targetSlot ? targetSlot.x : width / 2
    const targetY = targetSlot ? targetSlot.y : height - CARD_H - 20

    this.animations.push(this._makeAnim(
      sprite,
      this.deckPos.x, this.deckPos.y,
      targetX, targetY,
      0.1, 1, 0.7, 1, 0, 0, 0
    ))
  }

  private _makeAnim(
    container: PIXI.Container,
    sx: number, sy: number, ex: number, ey: number,
    sa: number, ea: number, ss: number, es: number,
    sr: number, er: number,
    elapsed: number
  ): AnimTarget {
    return {
      container, startX: sx, startY: sy, endX: ex, endY: ey,
      startAlpha: sa, endAlpha: ea, startScale: ss, endScale: es,
      startRotation: sr, endRotation: er,
      elapsed, duration: ANIM_DURATION_MS,
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
      anim.container.rotation = lerp(anim.startRotation, anim.endRotation, ease)

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

  drawCard(card: CardDTO, interactive = false, playable = false): PIXI.Container {
    const container = new PIXI.Container()
    const color = CARD_COLORS[card.color]
    const lightColor = CARD_COLORS_LIGHT[card.color]

    // Drop shadow
    if (interactive) {
      const shadow = new PIXI.Graphics()
      shadow.roundRect(3, 5, CARD_W, CARD_H, CARD_RADIUS)
      shadow.fill({ color: 0x000000, alpha: playable ? 0.35 : 0.2 })
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
    highlight.fill({ color: lightColor, alpha: 0.18 })
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

    // Border
    if (interactive) {
      const border = new PIXI.Graphics()
      border.roundRect(0, 0, CARD_W, CARD_H, CARD_RADIUS)
      if (playable) {
        // Bright glow border for playable cards
        border.stroke({ color: 0xffffff, width: 2, alpha: 0.7 })
      } else {
        border.stroke({ color: 0x888888, width: 0.8, alpha: 0.2 })
      }
      container.addChild(border)

      // Playable card indicator: subtle inner glow
      if (playable) {
        const glow = new PIXI.Graphics()
        glow.roundRect(2, 2, CARD_W - 4, CARD_H - 4, CARD_RADIUS - 1)
        glow.stroke({ color: 0xffd93d, width: 1.5, alpha: 0.4 })
        container.addChild(glow)
      }
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
    if (this.destroyed) return
    this.destroyed = true
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

function _placementSuffix(rank: number, texts?: TurnTexts): string {
  if (!texts) {
    if (rank === 1) return '1st'
    if (rank === 2) return '2nd'
    if (rank === 3) return '3rd'
    return `${rank}th`
  }
  if (rank === 1) return texts.ord1
  if (rank === 2) return texts.ord2
  if (rank === 3) return texts.ord3
  return `${rank}${texts.ordN}`
}

// Client-side canPlay check for highlighting (mirrors server rules.go CanPlay)
function _canPlayCard(card: CardDTO, topCard: CardDTO, activeColor: CardColor): boolean {
  if (card.color === 'wild') return true
  if (card.color === activeColor) return true
  if (card.kind === topCard.kind) {
    if (card.kind === 'number') return card.value === topCard.value
    return true
  }
  return false
}
