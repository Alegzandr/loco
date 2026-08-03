import { gameStore } from '../hooks/gameStore'
import type { CardDTO, ClientMsg } from '../types/protocol'
import type { WsStatus } from '../hooks/webSocketPolicy'

/**
 * The handles Playwright drives the app through, hung on `window.__LOCO_E2E__`.
 *
 * Every body here is behind `import.meta.env.DEV`, which Vite replaces with
 * `false` in a production build: the branch folds and nothing below it ships.
 * They live together rather than beside the code they expose because they are one
 * surface: the suite reads them as one object, and two components writing to the
 * same global from two files is how a key ends up quietly overwritten.
 *
 * There was a second half of this file while the client had two frameworks in
 * it, and both wrote the same keys. It went with the last `.tsx`: this file is
 * now the whole `window.__LOCO_E2E__` surface, and it stays the whole of it.
 */

/** Backing store for the turn recorder. Module-level: there is one page. */
let recordedTurns: number[] = []
let turnRecorderStop: (() => void) | null = null

export function e2eBridge(
  send: (msg: ClientMsg) => void,
  wsStatus: () => WsStatus,
  forceClose: () => void,
): void {
  $effect(() => {
    if (!import.meta.env.DEV) return
    const status = wsStatus()
    window.__LOCO_E2E__ = {
      ...(window.__LOCO_E2E__ ?? {}),
      send,
      getState: gameStore.getState,
      // Turn recorder: captures every distinct currentTurn the store passes
      // through, so tests can assert on a turn *sequence* rather than sampling a
      // transient value a bot may already have moved past. Results are read back
      // via getRecordedTurns() — the recorder itself has to stay in the page.
      startTurnRecorder: () => {
        turnRecorderStop?.()
        recordedTurns = [gameStore.getState().currentTurn]
        turnRecorderStop = gameStore.subscribe((s) => {
          if (s.currentTurn !== recordedTurns[recordedTurns.length - 1]) {
            recordedTurns.push(s.currentTurn)
          }
        })
      },
      getRecordedTurns: () => [...recordedTurns],
      getWsStatus: () => status,
      forceCloseWs: forceClose,
    }
  })
}

/**
 * Playing a card, driven through the same handler a real tap goes through, so the
 * suite exercises the legality checks and the prompts rather than the wire.
 */
export function e2ePlayCard(
  onCardClick: (card: CardDTO, cardIdx: number) => boolean,
  myHand: () => CardDTO[],
): void {
  $effect(() => {
    if (!import.meta.env.DEV) return
    const hand = myHand()
    if (!window.__LOCO_E2E__) window.__LOCO_E2E__ = {}
    window.__LOCO_E2E__.playCard = (card: CardDTO) => {
      const idx = hand.findIndex(
        (c) => c.color === card.color && c.kind === card.kind && c.value === card.value,
      )
      onCardClick(card, Math.max(0, idx))
    }
  })
}
