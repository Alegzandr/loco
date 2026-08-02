import { useCallback, useEffect, useState } from 'react'
import { CardDTO, CardColor, ClientMsg } from '../types/protocol'
import { clientMayInterrupt, clientMayPlay, isCounterCard } from '../components/interruptHelpers'

/** A card waiting on a colour. `copies` carries a batch slam through the prompt. */
export interface ColorPick {
  card: CardDTO
  idx: number
  interrupt?: boolean
  counter?: boolean
  copies?: CardDTO[]
}

/** A Swap waiting on a target. */
export interface PlayerPick {
  card: CardDTO
  idx: number
  interrupt?: boolean
}

interface Params {
  myHand: CardDTO[]
  discard: CardDTO | null
  activeColor: CardColor
  currentTurn: number
  myIndex: number
  pendingDraw: number
  onSend: (msg: ClientMsg) => void
  /** When the last card landed, whoever played it. Closes an open prompt. */
  lastPlayAt: number | undefined
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
export function useCardPlay({
  myHand,
  discard,
  activeColor,
  currentTurn,
  myIndex,
  pendingDraw,
  onSend,
  lastPlayAt,
}: Params) {
  const [colorPicker, setColorPicker] = useState<ColorPick | null>(null)
  const [playerPicker, setPlayerPicker] = useState<PlayerPick | null>(null)

  const isMyTurn = currentTurn === myIndex

  // Returns true when the tap actually sent a play, which is what <GameBoard />
  // keys the hand→discard flight off. A refused card and a card that only opens
  // a prompt both return false.
  const onCardClick = useCallback(
    (card: CardDTO, cardIdx: number): boolean => {
      // Out-of-turn path: realtime "lead-taking" interrupt. If the tapped card
      // is an exact match of the top discard, send interrupt_play_card (the
      // server enforces the time window and ordering). Otherwise ignore the tap.
      if (currentTurn !== myIndex) {
        if (!clientMayInterrupt(card, discard, pendingDraw)) return false
        // Auto-batch: if the player holds multiple identical copies, send them all
        // in a single interrupt — the rule allows playing any number of identical
        // matching cards together. Swap and global_switch never batch.
        const copies = myHand.filter(
          (c) => c.color === card.color && c.kind === card.kind && c.value === card.value,
        )
        const batch = copies.length > 1 ? copies : undefined
        // Wilds can take the lead too, and they still need their colour named
        // global_switch included: it rotates the hands *and* sets the colour.
        if (card.kind === 'wild' || card.kind === 'wild_draw_four' || card.kind === 'global_switch') {
          setColorPicker({
            card,
            idx: cardIdx,
            interrupt: true,
            copies: card.kind === 'global_switch' ? undefined : batch,
          })
          return false
        }
        if (card.kind === 'swap') {
          setPlayerPicker({ card, idx: cardIdx, interrupt: true })
          return false
        }
        onSend({ type: 'interrupt_play_card', card, play_cards: batch })
        return true
      }
      // Answering a pending +2/+4 stack is its own message. Any matching draw
      // card counters, whatever its colour — the server compares kinds only.
      // Sending play_card here is always refused ("must counter or draw pending
      // penalty cards first"), which used to make stacking unreachable by tap.
      if (pendingDraw > 0) {
        if (!isCounterCard(card, discard, pendingDraw)) return false
        if (card.kind === 'wild_draw_four') {
          setColorPicker({ card, idx: cardIdx, counter: true })
          return false
        }
        onSend({ type: 'counter_draw', card, chosen_color: card.color })
        return true
      }
      // Block clearly-invalid plays so there's no "fake" play UI flash.
      // Server is always authoritative; this is a UX hint only.
      //
      // This has to come *before* the prompts, not after. The three wilds always
      // match, so gating them made no difference — but Swap is a coloured card
      // and obeys the ordinary matching rules, so an off-colour Swap opened its
      // target prompt, took a choice, and was refused by the server with an
      // "illegal card play" warning. Asking a question and then rejecting the
      // answer is a worse refusal than the silent one every other unplayable
      // card gives, which is what the player was reporting.
      if (!clientMayPlay(card, discard, activeColor, pendingDraw)) return false
      if (card.kind === 'wild' || card.kind === 'wild_draw_four' || card.kind === 'global_switch') {
        setColorPicker({ card, idx: cardIdx })
        return false
      }
      if (card.kind === 'swap') {
        setPlayerPicker({ card, idx: cardIdx })
        return false
      }
      onSend({ type: 'play_card', card, chosen_color: card.color })
      return true
    },
    [currentTurn, myIndex, discard, activeColor, pendingDraw, myHand, onSend],
  )

  // A picker is a promise about a board that no longer exists once a card lands.
  // Someone interjecting on top of the discard you were about to answer (the
  // classic case is a second GlobalSwitch stealing the lead) invalidates both
  // the colour and the swap target you were choosing, and the server would
  // refuse the play anyway. Close them: the interjecter now owns the choice.
  useEffect(() => {
    if (lastPlayAt === undefined) return
    setColorPicker(null)
    setPlayerPicker(null)
  }, [lastPlayAt])

  // ...and a card landing is not the only way the board moves. The turn timing
  // out, a forced draw, a fresh game_state after a Swap: none of them set
  // lastPlay, so the prompt stayed up over a table that had gone, and the
  // choice went out against a state the server had already replaced. It came
  // back "illegal card play" *after* the player had answered a question nobody
  // should have asked, which is the one refusal this game gives that feels like
  // a broken promise rather than an illegal card.
  //
  // The condition is deliberately the same one that opened the prompt, read
  // again: a prompt is only owed while the card behind it is still playable.
  const pendingPick = colorPicker ?? playerPicker
  useEffect(() => {
    if (!pendingPick) return
    const { card, interrupt } = pendingPick
    const stillHeld = myHand.some(
      (c) => c.color === card.color && c.kind === card.kind && c.value === card.value,
    )
    const stillLegal =
      stillHeld &&
      (interrupt
        ? clientMayInterrupt(card, discard, pendingDraw)
        : currentTurn === myIndex && clientMayPlay(card, discard, activeColor, pendingDraw))
    if (stillLegal) return
    setColorPicker(null)
    setPlayerPicker(null)
  }, [pendingPick, myHand, discard, activeColor, pendingDraw, currentTurn, myIndex])

  // Predicates passed to <GameBoard />: highlight what can be played right now.
  // Off-turn that means exact-match slams, on-turn the normal legality rules —
  // both delegated so the highlight can never drift from what a tap will do.
  const isPlayable = useCallback(
    (card: CardDTO): boolean =>
      isMyTurn
        ? clientMayPlay(card, discard, activeColor, pendingDraw)
        : clientMayInterrupt(card, discard, pendingDraw),
    [isMyTurn, discard, activeColor, pendingDraw],
  )
  const isInteractive = useCallback(
    (card: CardDTO): boolean => isMyTurn || clientMayInterrupt(card, discard, pendingDraw),
    [isMyTurn, discard, pendingDraw],
  )

  // True when the player has at least one card they can legally play right now.
  // Used to de-emphasize the Draw button so it doesn't look like the required action.
  const hasPlayableCard =
    isMyTurn && myHand.some((c) => clientMayPlay(c, discard, activeColor, pendingDraw))
  // While a penalty is pending the only legal cards are the ones that stack it,
  // so "can I play something" and "can I counter" are the same question.
  const canCounter = pendingDraw > 0 && hasPlayableCard

  return {
    colorPicker,
    playerPicker,
    setColorPicker,
    setPlayerPicker,
    onCardClick,
    isPlayable,
    isInteractive,
    isMyTurn,
    hasPlayableCard,
    canCounter,
  }
}
