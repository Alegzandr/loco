import { StateCreator } from './createStore'
import { CardColor } from '../../types/protocol'
import { stamp, gameStateSliceFromDTO, keepDeclarations, makeSwapNotice, removePlayedCards } from './helpers'
import { CatchWindow, GameStore, TableActions } from './types'
import { offerEnd, type OnHookUntil } from '../../components/catchAvailability'

/**
 * The clock the centre button runs on, brought up to date by what the server
 * named: every seat in `catchSeats` gets its window end, every seat that is no
 * longer on one card is dropped, and everything else is kept as it was — a
 * seat the server stopped naming because it spoke is still on the clock, and
 * the clock is what must not know that.
 */
function updateOnHook(
  prev: OnHookUntil,
  catchSeats: { player_index: number; ends_at: number }[] | undefined,
  players: { index: number; hand_size: number }[],
  now: number,
): OnHookUntil {
  const next: OnHookUntil = {}
  for (const p of players) {
    const end = offerEnd(p.index, prev)
    if (end !== undefined && end > now) next[p.index] = prev[p.index]
  }
  for (const c of catchSeats ?? []) next[c.player_index] = c.ends_at
  return next
}

export const createTableActions: StateCreator<GameStore, TableActions> = (set) => ({
  applyGameState: (state) =>
    set((s) => {
      // Open catch windows are FILTERED against the snapshot, not wiped. A Swap
      // or a GlobalSwitch is followed by a personalised game_state, so clearing
      // here meant the one situation this rule exists for, a player handed
      // their last card, was never catchable by anyone. A window survives only
      // while it is unexpired and its seat still holds exactly one card, so a
      // fresh deal (nobody on one card) still clears everything.
      //
      // The snapshot now says who is on the hook itself (`catch_seats`, the same
      // list card_played carries), and when it does that list is the answer: a
      // reloaded tab has no windows to filter, and the snapshot a refusal
      // answers with knows more than what this client was holding. A call we
      // already spent on the same window stays spent. A snapshot with no field
      // at all is an older server or a fixture, and gets the filter.
      const now = Date.now()
      // The server says who is on the hook (`catch_seats`), exactly as it does
      // on card_played, so a reload two seconds into a window lands on a board
      // where that window is still open. What survives from before is only
      // whether we already spent a call on the same window.
      const catchWindows: CatchWindow[] = state.catch_seats
        ? state.catch_seats.map((c) => {
            const prev = s.catchWindows.find((w) => w.seat === c.player_index)
            const same = prev !== undefined && prev.endsAt === c.ends_at
            return { seat: c.player_index, endsAt: c.ends_at, attempted: same ? prev.attempted : undefined }
          })
        : s.catchWindows.filter(
            (w) =>
              w.endsAt > now &&
              state.players.find((p) => p.index === w.seat)?.hand_size === 1,
          )
      return {
        ...gameStateSliceFromDTO(state),
        // The round summary is deliberately NOT touched here. It is an overlay
        // over the board, not a state of it: the server deals the next round in
        // the same breath as it announces the last one, so this snapshot arrives
        // while the card is still up on every screen. Taking the card down here
        // would make the summary last exactly as long as the network, and
        // *buffering the snapshot instead* — which is what this used to do — was
        // worse: the buffer was applied on dismissal, over a board that had
        // moved on for up to eight seconds, so the whole table's plays were
        // rolled back to the deal on the screen of whoever read the scores.
        // See dismissRoundSummary.
        //
        // A buffered *match end* is another matter and is dropped: a board that
        // is still being dealt says the match is not over, so the payload behind
        // the card is one the server has contradicted.
        pendingMatchEnd: null,
        // The banner is cosmetic and announces the previous one-card moment; a
        // fresh authoritative snapshot must not leave it hanging.
        unoDeclared: false,
        unoDeclaredByIndex: -1,
        // A declaration only covers the single card it was called on. Any other
        // hand — a fresh deal, a penalty, a card drawn — owes nothing yet. The
        // server's own list wins when it sends one: a reloaded tab has nothing
        // to keep, and its LOCO! button used to come back live over a call
        // already spent.
        declaredSeats:
          state.declared_seats ??
          keepDeclarations(s.declaredSeats, (seat) =>
            state.players.find((p) => p.index === seat)?.hand_size,
          ),
        catchWindows,
        // The centre button's clock, off the same list. A reloaded tab holds
        // nothing from before, so a seat the snapshot does not name — one that
        // spoke, or whose window ran out — is dark there, which is the one
        // reading a tab that was not listening can honestly give.
        onHookUntil: updateOnHook(s.onHookUntil, state.catch_seats, state.players, now),
        // Same authority over a press in flight: the snapshot is the server's
        // whole answer, and a correction is how a refused press comes back.
        catchPending: false,
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
        onHookUntil: updateOnHook(s.onHookUntil, catchSeats, updatedPlayers, Date.now()),
        // The board moved, so a Contre-LOCO! is a fresh read rather than the
        // same one repeated: a card played is the one event that can put a new
        // offer on the table, and the server's own ration is keyed on the
        // offer.
        catchSpent: false,
        // A press still waiting on this board was answered by the board moving:
        // whatever the server says about it now, the call was about the last
        // card, and the button has to be free for the next one.
        catchPending: false,
        swapNotice,
        lastPlay: { actorIndex: playerIndex, card, at: stamp() },
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
        // The roster's count of our own hand moves with the hand: the fallback
        // paths below index on it, and a stale-low count there removed two
        // copies of a card for one play.
        const myHand = [...s.myHand, ...cards]
        const players = s.players.map((p) =>
          p.index === playerIndex ? { ...p, hand_size: myHand.length } : p,
        )
        return { ...turnState, myHand, players }
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
            departureNotice: nickname ? { nickname, at: stamp() } : s.departureNotice,
          },
    ),

  clearDepartureNotice: () => set({ departureNotice: null }),

  // The host's answer for this table, straight off `streamer_mode_changed`. It
  // is never derived from the local preference: this seat may not be the host's.
  setTableStreamer: (tableStreamer) => set({ tableStreamer }),

  setTurnDeadline: (turnDeadline) => set({ turnDeadline }),

  setSwapNotice: (swapNotice) => set({ swapNotice }),

  applyInterrupt: (actorIndex, count) =>
    set({ interruptFlash: { actorIndex, count, at: stamp() } }),

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
