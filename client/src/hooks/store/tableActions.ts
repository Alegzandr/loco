import { StateCreator } from './createStore'
import { CardColor } from '../../types/protocol'
import { gameStateSliceFromDTO, keepDeclarations, makeSwapNotice, removePlayedCards } from './helpers'
import { CatchWindow, GameStore, TableActions } from './types'

export const createTableActions: StateCreator<GameStore, TableActions> = (set) => ({
  applyGameState: (state) =>
    set((s) => {
      // Open catch windows are FILTERED against the snapshot, not wiped. A Swap
      // or a GlobalSwitch is followed by a personalised game_state, so clearing
      // here meant the one situation this rule exists for, a player handed
      // their last card, was never catchable by anyone. A window survives only
      // while it is unexpired and its seat still holds exactly one card, so a
      // fresh deal (nobody on one card) still clears everything.
      const now = Date.now()
      const catchWindows = s.catchWindows.filter(
        (w) =>
          w.endsAt > now &&
          state.players.find((p) => p.index === w.seat)?.hand_size === 1,
      )
      return {
        ...gameStateSliceFromDTO(state),
        roundWinner: '',
        showRoundSummary: false,
        pendingGameState: null,
        pendingMatchEnd: null,
        // The banner is cosmetic and announces the previous one-card moment; a
        // fresh authoritative snapshot must not leave it hanging.
        unoDeclared: false,
        unoDeclaredByIndex: -1,
        // A declaration only covers the single card it was called on. Any other
        // hand — a fresh deal, a penalty, a card drawn — owes nothing yet.
        declaredSeats: keepDeclarations(s.declaredSeats, (seat) =>
          state.players.find((p) => p.index === seat)?.hand_size,
        ),
        catchWindows,
      }
    }),

  applyCardPlayed: (playerIndex, card, turn, pendingDraw, activeColor, players, chosenPlayer, direction, catchSeats = []) =>
    set((s) => {
      // Prefer server-provided player list (includes Finished/Placement); fall back to local update
      const updatedPlayers = players
        ? players
        : s.players.map((p) =>
            p.index === playerIndex ? { ...p, hand_size: p.hand_size - 1 } : p
          )
      // Use server-authoritative active color; fall back to card color or current.
      // 'wild' is never a playable colour — it matches nothing, so the colour in
      // play carries over (this is exactly what a GlobalSwitch does).
      const resolvedColor: CardColor =
        activeColor && activeColor !== 'wild'
          ? activeColor
          : card.color === 'wild'
            ? s.activeColor
            : card.color
      // Remove the played card from local hand if it was our play
      let updatedHand = s.myHand
      if (playerIndex === s.myIndex) {
        updatedHand = removePlayedCards(
          s.myHand,
          card,
          updatedPlayers.find((p) => p.index === s.myIndex)?.hand_size
        )
      }
      // Surface a transient notice when a hand-swapping card resolves so non-actors
      // understand why their (or others') card counts just changed.
      const resolvedDirection = typeof direction === 'number' && direction !== 0 ? direction : s.direction
      const swapNotice = makeSwapNotice(card, playerIndex, chosenPlayer, resolvedDirection) ?? s.swapNotice
      // Who owes the table a declaration is the server's answer, carried on
      // this message (`catch_seats`). The client used to work it out again from
      // the roster and the card kind, which put the rule that a Swap or a
      // GlobalSwitch catches EVERY seat left on one card in two languages with
      // nothing checking they agree. What is left here is presentation: which
      // window we have already spent a call on, and whether the banner still
      // describes the table.
      const catchWindows: CatchWindow[] = catchSeats.map((c) => {
        const prev = s.catchWindows.find((w) => w.seat === c.player_index)
        // A window that just reopened is a new obligation, so a call we made on
        // the previous one is not spent on this one.
        const reopened = !prev || c.ends_at > prev.endsAt
        return {
          seat: c.player_index,
          endsAt: c.ends_at,
          attempted: reopened ? undefined : prev.attempted,
        }
      })
      const opened = catchWindows.filter((w) => {
        const prev = s.catchWindows.find((p) => p.seat === w.seat)
        return !prev || w.endsAt > prev.endsAt
      })
      // Any fresh window retires the declaration banner: it announced the
      // previous one-card situation, and the table has moved on.
      const voidsBanner = opened.length > 0
      return {
        myHand: updatedHand,
        discard: card,
        activeColor: resolvedColor,
        currentTurn: turn,
        direction: resolvedDirection,
        pendingDraw,
        hasDrawn: false,
        players: updatedPlayers,
        unoDeclared: voidsBanner ? false : s.unoDeclared,
        unoDeclaredByIndex: voidsBanner ? -1 : s.unoDeclaredByIndex,
        // A window reopening on a seat is a new obligation, exactly like the
        // server's openCatchWindow: what it called earlier was another card.
        // Our own seat is in there like any other — the roster carries our
        // hand size too, and the server is the authority on it.
        declaredSeats: keepDeclarations(
          s.declaredSeats,
          (seat) => updatedPlayers.find((p) => p.index === seat)?.hand_size,
          opened.map((w) => w.seat),
        ),
        catchWindows,
        // The board moved, so a Contre-LOCO! is a fresh read rather than the
        // same one repeated. This is the client's copy of the server's PlayEpoch
        // and it is cleared by the same event the server counts.
        catchSpent: false,
        swapNotice,
        lastPlay: { actorIndex: playerIndex, card, at: Date.now() },
      }
    }),

  applyCardDrawn: (cards, playerIndex, turn, hasDrawn, drawnCount, pendingDraw) =>
    set((s) => {
      // `has_drawn` / `pending_draw` are taken from the message, never guessed.
      // Not every card_drawn is a turn action: the UNO-catch penalty grows a hand
      // while somebody else's draw-once state is what it was, and the same
      // message reaches the whole table. Defaulting the missing flag to "drawn"
      // is what stuck a player with a disabled Draw button and a Pass the server
      // answered "you must draw a card before passing" until the turn timer ran
      // out. Absent means unchanged; the server fills both in on every card_drawn.
      // A hand that grew is off one card, and the server answers every catch on
      // that seat with "target does not have exactly 1 card". Keeping the window
      // open leaves Contre-LOCO! armed on a tap that can only come back refused.
      const catchWindows = s.catchWindows.filter((w) => w.seat !== playerIndex)
      const turnState = {
        currentTurn: turn,
        hasDrawn: hasDrawn ?? s.hasDrawn,
        pendingDraw: pendingDraw ?? s.pendingDraw,
        catchWindows,
        // A hand that grew is off one card, so whatever that seat called is
        // spent — it will owe the table a fresh call on the way back down.
        declaredSeats: s.declaredSeats.filter((seat) => seat !== playerIndex),
      }
      if (cards && cards.length > 0) {
        return { ...turnState, myHand: [...s.myHand, ...cards] }
      }
      // Observer: update hand size by the count the server sent. Absent means
      // nothing, never "probably one": a draw against exhausted piles hands over
      // zero cards, and guessing there adds a card to a hand that did not grow —
      // the same class of desync as inferring has_drawn above.
      const count = drawnCount ?? 0
      const players = s.players.map((p) =>
        p.index === playerIndex ? { ...p, hand_size: p.hand_size + count } : p
      )
      return { ...turnState, players }
    }),

  // Re-resolves myIndex from our own nickname on every roster update. The server
  // re-indexes seats when someone leaves a lobby or a finished room, so a client
  // that holds a stale index would lose host controls (or claim someone else's).
  // Nicknames are unique per room, so the match is unambiguous.
  setPlayers: (players) =>
    set((s) => {
      const myNickname = s.players.find((p) => p.index === s.myIndex)?.nickname
      if (!myNickname) return { players }
      const mine = players.find((p) => p.nickname === myNickname)
      return mine ? { players, myIndex: mine.index } : { players }
    }),

  // The table changed hands, which moves exactly two seats: the old host's and
  // the new one's. Taken from the message rather than re-derived from our own
  // nickname the way setPlayers does it — the server sends this one per
  // recipient precisely so nobody has to.
  applyHostChange: (myIndex, players) => set({ myIndex, players }),

  // A seat whose hold ran out. Only ever named by the one player_left that
  // cannot re-base the roster — the seat is the index of a hand in a running
  // match, so nothing moves — and idempotent, because the flag is about who is
  // never coming back rather than about how many messages said so.
  // The notice rides the same call and is idempotent with it: a repeat says
  // nothing new, so it must not put the banner back up over a board the table
  // has already moved on from.
  noteSeatGone: (seat, nickname) =>
    set((s) =>
      seat < 0 || s.goneSeats.includes(seat)
        ? s
        : {
            goneSeats: [...s.goneSeats, seat],
            departureNotice: nickname ? { nickname, at: Date.now() } : s.departureNotice,
          },
    ),

  clearDepartureNotice: () => set({ departureNotice: null }),

  // The host's answer for this table, straight off `streamer_mode_changed`. It
  // is never derived from the local preference: this seat may not be the host's.
  setTableStreamer: (tableStreamer) => set({ tableStreamer }),

  setTurnDeadline: (turnDeadline) => set({ turnDeadline }),

  setSwapNotice: (swapNotice) => set({ swapNotice }),

  applyInterrupt: (actorIndex, count) =>
    set({ interruptFlash: { actorIndex, count, at: Date.now() } }),

  clearInterrupt: () => set({ interruptFlash: null }),

  // The table is shut. Also clears the turn deadline: game_started arrives with
  // no clock (the server does not arm one until match_ready), and a stale
  // deadline left over from the previous round would drain a bar over a loading
  // screen for a turn nobody can take yet.
  applyMatchLoading: (ready) => set({ mapLoading: { ready }, turnDeadline: null }),

  // The table is open. This, not game_started, is where a match actually
  // begins. The deadline comes from the same message so the bar and the server's
  // clock start together.
  applyMatchReady: (turn, turnDeadline) =>
    set({ mapLoading: null, currentTurn: turn, turnDeadline }),

  applyLatencies: (latencies) => set({ latencies }),
})
