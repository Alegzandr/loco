import type { CardDTO, CardColor, ClientMsg } from '../types/protocol'
import { clientMayInterrupt, clientMayPlay, isCounterCard } from '../components/interruptHelpers'
import { type MapDef, mapAssets } from '../components/cards/maps'
import { MAP_PRELOAD_TIMEOUT_MS, type MapPreloadState } from './mapPreload'
import { prefersReducedMotion } from './motionPref'
import { live } from './live.svelte'

/** A card waiting on a colour. `copies` carries a batch slam through the prompt. */
export interface ColorPick {
  card: CardDTO
  idx: number
  interrupt?: boolean
  counter?: boolean
  copies?: CardDTO[]
  /** Set when `copies` is the whole hand — see `finishesTheHand`. */
  declareLoco?: boolean
}

/**
 * Whether a batch puts down every card the player is holding.
 *
 * That is the one finish nobody could announce in advance: a hand of two
 * identical cards played at once never passes through a single card, so no catch
 * window ever opened on it and the LOCO! button was never offered. The server
 * refuses such a batch unless the message carries the call (`declare_loco`), so
 * the tap that takes the round *is* the call — there is no earlier moment to
 * make it in, and no second press to demand.
 *
 * Every other finish is gated on a declaration that already happened, and the
 * flag says nothing about it.
 */
function finishesTheHand(batch: CardDTO[] | undefined, hand: CardDTO[]): boolean {
  return batch !== undefined && batch.length >= hand.length
}

/**
 * Which copies a tap actually slams.
 *
 * The batch is automatic because an interject is a reaction and a second press
 * is a second reaction: nobody gets asked how many copies to send. That is only
 * fair while every extra copy *buys* something — a +2 or a +4 raises the stack,
 * a Skip steps another seat, a Reverse flips the ring again — which is exactly
 * the list `stackBatchEffects` has a case for on the server.
 *
 * A plain wild is not on that list. Two of them name one colour, so the second
 * copy does nothing at all beyond leaving the hand, and the hand it leaves is
 * the most flexible card in the game: a player who slammed one wild to take the
 * lead back found all three of theirs gone. So a wild batches for one reason
 * only — when the batch empties the hand and takes the round, which is worth
 * every wild it costs. Swap and GlobalSwitch the server refuses in batch
 * outright, so they never get here with more than one copy to send.
 */
function batchForSlam(card: CardDTO, copies: CardDTO[], hand: CardDTO[]): CardDTO[] | undefined {
  if (copies.length < 2) return undefined
  if (card.kind === 'swap' || card.kind === 'global_switch') return undefined
  if (card.kind === 'wild' && !finishesTheHand(copies, hand)) return undefined
  return copies
}

/** A Swap waiting on a target. */
export interface PlayerPick {
  card: CardDTO
  idx: number
  interrupt?: boolean
}

interface PlayParams {
  myHand: () => CardDTO[]
  discard: () => CardDTO | null
  activeColor: () => CardColor
  currentTurn: () => number
  myIndex: () => number
  pendingDraw: () => number
  onSend: (msg: ClientMsg) => void
  /** When the last card landed, whoever played it. Closes an open prompt. */
  lastPlayAt: () => number | undefined
}

/**
 * What a tap on a card means, and the two prompts a tap can open instead.
 *
 * All of it in one place because the three are one decision: the legality check
 * decides whether a prompt is owed, the prompt decides which message goes out,
 * and the same check run again is what closes a prompt the board has moved on
 * from. Split across a component they drift, and the drift is silent: an
 * off-colour Swap that asks for a target and is then refused by the server.
 */
export function cardPlay(params: PlayParams) {
  let colorPicker = $state<ColorPick | null>(null)
  let playerPicker = $state<PlayerPick | null>(null)

  const isMyTurn = $derived(params.currentTurn() === params.myIndex())

  // Returns true when the tap actually sent a play, which is what the board keys
  // the hand→discard flight off. A refused card and a card that only opens a
  // prompt both return false.
  function onCardClick(card: CardDTO, cardIdx: number): boolean {
    const discard = params.discard()
    const pendingDraw = params.pendingDraw()
    const myHand = params.myHand()
    // Out-of-turn path: realtime "lead-taking" interrupt. If the tapped card is an
    // exact match of the top discard, send interrupt_play_card (the server
    // enforces the time window and ordering). Otherwise ignore the tap.
    if (params.currentTurn() !== params.myIndex()) {
      if (!clientMayInterrupt(card, discard, pendingDraw)) return false
      // Auto-batch: if the player holds multiple identical copies, send them all
      // in a single interrupt — the rule allows playing any number of identical
      // matching cards together. Swap and global_switch never batch.
      const copies = myHand.filter(
        (c) => c.color === card.color && c.kind === card.kind && c.value === card.value,
      )
      const batch = batchForSlam(card, copies, myHand)
      // Wilds can take the lead too, and they still need their colour named —
      // global_switch included: it rotates the hands *and* sets the colour.
      if (card.kind === 'wild' || card.kind === 'wild_draw_four' || card.kind === 'global_switch') {
        colorPicker = {
          card,
          idx: cardIdx,
          interrupt: true,
          copies: batch,
          declareLoco: finishesTheHand(batch, myHand),
        }
        return false
      }
      if (card.kind === 'swap') {
        playerPicker = { card, idx: cardIdx, interrupt: true }
        return false
      }
      params.onSend({
        type: 'interrupt_play_card',
        card,
        play_cards: batch,
        declare_loco: finishesTheHand(batch, myHand),
      })
      return true
    }
    // Answering a pending +2/+4 stack is its own message. Any matching draw card
    // counters, whatever its colour — the server compares kinds only. Sending
    // play_card here is always refused ("must counter or draw pending penalty
    // cards first"), which used to make stacking unreachable by tap.
    if (pendingDraw > 0) {
      if (!isCounterCard(card, discard, pendingDraw)) return false
      if (card.kind === 'wild_draw_four') {
        colorPicker = { card, idx: cardIdx, counter: true }
        return false
      }
      params.onSend({ type: 'counter_draw', card, chosen_color: card.color })
      return true
    }
    // Block clearly-invalid plays so there's no "fake" play UI flash. Server is
    // always authoritative; this is a UX hint only.
    //
    // This has to come *before* the prompts, not after. The three wilds always
    // match, so gating them made no difference — but Swap is a coloured card and
    // obeys the ordinary matching rules, so an off-colour Swap opened its target
    // prompt, took a choice, and was refused by the server with an "illegal card
    // play" warning. Asking a question and then rejecting the answer is a worse
    // refusal than the silent one every other unplayable card gives.
    if (!clientMayPlay(card, discard, params.activeColor(), pendingDraw)) return false
    if (card.kind === 'wild' || card.kind === 'wild_draw_four' || card.kind === 'global_switch') {
      colorPicker = { card, idx: cardIdx }
      return false
    }
    if (card.kind === 'swap') {
      playerPicker = { card, idx: cardIdx }
      return false
    }
    params.onSend({ type: 'play_card', card, chosen_color: card.color })
    return true
  }

  // A picker is a promise about a board that no longer exists once a card lands.
  // Someone interjecting on top of the discard you were about to answer (the
  // classic case is a second GlobalSwitch stealing the lead) invalidates both the
  // colour and the swap target you were choosing, and the server would refuse the
  // play anyway. Close them: the interjecter now owns the choice.
  //
  // "Once a card lands" is the whole condition, so the timestamp is read through
  // `live()` and nothing else is read at all. Reading it off the snapshot meant
  // depending on the entire match: every message closed the prompt, so from the
  // second card of the round onwards a wild could not be given a colour and a
  // Swap could not be given a target — the picker shut itself under the player's
  // thumb.
  const lastLanded = live(() => params.lastPlayAt())
  $effect(() => {
    if (lastLanded() === undefined) return
    colorPicker = null
    playerPicker = null
  })

  // ...and a card landing is not the only way the board moves. The turn timing
  // out, a forced draw, a fresh game_state after a Swap: none of them set
  // lastPlay, so the prompt stayed up over a table that had gone, and the choice
  // went out against a state the server had already replaced. It came back
  // "illegal card play" *after* the player had answered a question nobody should
  // have asked, which is the one refusal this game gives that feels like a broken
  // promise rather than an illegal card.
  //
  // The condition is deliberately the same one that opened the prompt, read
  // again: a prompt is only owed while the card behind it is still playable.
  $effect(() => {
    const pendingPick = colorPicker ?? playerPicker
    const myHand = params.myHand()
    const discard = params.discard()
    const pendingDraw = params.pendingDraw()
    const activeColor = params.activeColor()
    const mine = params.currentTurn() === params.myIndex()
    if (!pendingPick) return
    const { card, interrupt } = pendingPick
    const stillHeld = myHand.some(
      (c) => c.color === card.color && c.kind === card.kind && c.value === card.value,
    )
    const stillLegal =
      stillHeld &&
      (interrupt
        ? clientMayInterrupt(card, discard, pendingDraw)
        : mine && clientMayPlay(card, discard, activeColor, pendingDraw))
    if (stillLegal) return
    colorPicker = null
    playerPicker = null
  })

  // Predicates passed to the board: highlight what can be played right now.
  // Off-turn that means exact-match slams, on-turn the normal legality rules —
  // both delegated so the highlight can never drift from what a tap will do.
  const isPlayable = (card: CardDTO): boolean =>
    isMyTurn
      ? clientMayPlay(card, params.discard(), params.activeColor(), params.pendingDraw())
      : clientMayInterrupt(card, params.discard(), params.pendingDraw())

  const isInteractive = (card: CardDTO): boolean =>
    isMyTurn || clientMayInterrupt(card, params.discard(), params.pendingDraw())

  // True when the player has at least one card they can legally play right now.
  // Used to de-emphasise the Draw button so it doesn't look like the required
  // action.
  const hasPlayableCard = $derived(
    isMyTurn &&
      params
        .myHand()
        .some((c) => clientMayPlay(c, params.discard(), params.activeColor(), params.pendingDraw())),
  )
  // While a penalty is pending the only legal cards are the ones that stack it, so
  // "can I play something" and "can I counter" are the same question.
  const canCounter = $derived(params.pendingDraw() > 0 && hasPlayableCard)

  return {
    get colorPicker() {
      return colorPicker
    },
    set colorPicker(v: ColorPick | null) {
      colorPicker = v
    },
    get playerPicker() {
      return playerPicker
    },
    set playerPicker(v: PlayerPick | null) {
      playerPicker = v
    },
    onCardClick,
    isPlayable,
    isInteractive,
    get isMyTurn() {
      return isMyTurn
    },
    get hasPlayableCard() {
      return hasPlayableCard
    },
    get canCounter() {
      return canCounter
    },
  }
}

// Interception: a rattle, the board knocked sideways by a card slammed onto it.
const INTERRUPT_FRAMES: Keyframe[] = [
  { transform: 'translate(0, 0)' },
  { transform: 'translate(-11px, 6px)' },
  { transform: 'translate(9px, -5px)' },
  { transform: 'translate(-6px, 3px)' },
  { transform: 'translate(3px, -2px)' },
  { transform: 'translate(0, 0)' },
]

// Contre-LOCO!: a single vertical thump, matching the stamp coming down. The two
// loudest moments in the game must not shake the screen the same way, or a
// clipped highlight cannot tell them apart with the sound off.
const CATCH_FRAMES: Keyframe[] = [
  { transform: 'translate(0, 0)' },
  { transform: 'translate(0, 14px)', offset: 0.35 },
  { transform: 'translate(0, -6px)', offset: 0.62 },
  { transform: 'translate(0, 0)' },
]

const INTERRUPT_MS = 420
const CATCH_MS = 340
// Held back to the frame the stamp actually lands on: a board that jumps while
// the verdict is still falling reads as two unrelated events.
const CATCH_DELAY_MS = 180

/**
 * The two shakes the board takes, driven through the Web Animations API rather
 * than a CSS class so a second one replays immediately. A class toggle would need
 * the element to remount, which would tear down the whole board.
 */
export function boardShake(
  el: () => HTMLElement | null,
  interruptFlash: () => { at: number } | null,
  catchFlash: () => { at: number } | null,
): void {
  const shake = (frames: Keyframe[], durationMs: number, delayMs = 0) => {
    if (prefersReducedMotion()) return
    const node = el()
    // Guarded like kickBoard: the Web Animations API is absent under jsdom, and a
    // missing shake must never take the banner down with it.
    if (!node || typeof node.animate !== 'function') return
    node.animate(frames, { duration: durationMs, delay: delayMs, easing: 'ease-out' })
  }

  // Both watch `at`, not just the object. Two interrupts in a row are two flashes
  // that differ by their timestamp and nothing else, and an effect that only
  // looked at whether there was one would run for the first and sit still for
  // the second — one shake per match instead of one per interrupt.
  //
  // And `live()` is what makes the timestamp the dependency rather than merely
  // the thing read: the flash stays in the store for the length of its banner,
  // so an effect tracking the snapshot rattled the board again on every message
  // that arrived while it was up.
  const interruptAt = live(() => interruptFlash()?.at)
  const catchAt = live(() => catchFlash()?.at)

  $effect(() => {
    if (interruptAt() === undefined) return
    shake(INTERRUPT_FRAMES, INTERRUPT_MS)
  })

  $effect(() => {
    if (catchAt() === undefined) return
    shake(CATCH_FRAMES, CATCH_MS, CATCH_DELAY_MS)
  })
}

/**
 * Downloads and decodes a map's images, reporting progress.
 *
 * `decode()` rather than the `load` event: `load` fires when the bytes have
 * arrived, not when the browser can paint them. **A failure counts as done** — an
 * image that 404s must never leave a player stranded; the board falls back to the
 * built-in felt, which is a worse-looking match, not a broken one.
 */
function mapPreload(
  map: () => MapDef | null,
  enabled: () => boolean,
): { readonly current: MapPreloadState } {
  let state = $state<MapPreloadState>({ progress: 0, done: false })
  // Keyed on the map id, not the object, so an update with an equal-but-new
  // definition does not restart a load that is already half done.
  let startedFor: string | null = null
  // Abandoning a download is keyed on the same id, deliberately, and is *not*
  // the effect's cleanup. The two were the same thing once, and a re-run — one
  // arrives every time another seat answers the gate — cancelled a load in
  // flight that the guard above then refused to restart: `done` never came, so
  // map_ready never went out and the table opened on the server's 20s backstop
  // with this player still watching a bar. Cancel when the load is genuinely
  // over (the gate shut, or a different map), never because an effect ran twice.
  let abandon: (() => void) | null = null

  $effect(() => {
    const m = map()
    if (!enabled() || !m) {
      abandon?.()
      abandon = null
      startedFor = null
      return
    }
    if (startedFor === m.id) return
    abandon?.()
    startedFor = m.id

    const files = mapAssets(m)
    let settled = 0
    let cancelled = false

    const bump = () => {
      if (cancelled) return
      settled++
      state = { progress: settled / files.length, done: settled >= files.length }
    }

    const timer = window.setTimeout(() => {
      if (cancelled) return
      cancelled = true
      state = { progress: 1, done: true }
    }, MAP_PRELOAD_TIMEOUT_MS)

    state = { progress: 0, done: false }
    for (const src of files) {
      const img = new Image()
      img.src = src
      const settle = () => bump()
      if (typeof img.decode === 'function') img.decode().then(settle, settle)
      else {
        img.onload = settle
        img.onerror = settle
      }
    }

    abandon = () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  })

  return {
    get current() {
      return state
    },
  }
}

/**
 * The loading gate, from this client's side: preload the room's art while the
 * table is shut, then tell the server the moment we are in.
 *
 * The once-per-gate guard is a plain variable rather than a dependency because
 * `mapLoading` gets a new identity on every progress broadcast (each time
 * *another* player arrives), and keying on the object itself would re-send
 * map_ready once per opponent. A map we have no art for is ready immediately:
 * there is nothing to fetch, and a client that never answers is the one outcome
 * the gate cannot survive.
 */
export function mapGate(
  map: () => MapDef | null,
  gateOpen: () => boolean,
  onSend: (msg: ClientMsg) => void,
): { readonly current: MapPreloadState } {
  const preload = mapPreload(map, gateOpen)
  let sentReady = false

  $effect(() => {
    const open = gateOpen()
    const done = preload.current.done
    const nothingToLoad = map() === null
    if (!open) {
      sentReady = false
      return
    }
    if (sentReady) return
    if (!done && !nothingToLoad) return
    sentReady = true
    onSend({ type: 'map_ready' })
  })

  return preload
}
