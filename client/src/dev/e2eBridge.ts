import { useEffect, useRef, type RefObject } from 'react'
import { useGameStore } from '../hooks/useGameStore'
import type { CardDTO, ClientMsg } from '../types/protocol'
import type { WsStatus } from '../hooks/useWebSocket'

/**
 * The handles Playwright drives the app through, hung on `window.__LOCO_E2E__`.
 *
 * Every body here is behind `import.meta.env.DEV`, which Vite replaces with
 * `false` in a production build: the branch folds and nothing below it ships.
 * They live together rather than beside the code they expose because they are
 * one surface: the suite reads them as one object, and two components writing
 * to the same global from two files is how a key ends up quietly overwritten.
 */
export function useE2EBridge(
  sendRef: RefObject<(msg: ClientMsg) => void>,
  wsStatus: WsStatus,
  forceClose: () => void,
) {
  // Backing store for the turn recorder below.
  const recordedTurns = useRef<number[]>([])
  const turnRecorderStop = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__LOCO_E2E__ = {
      ...(window.__LOCO_E2E__ ?? {}),
      send: (msg: ClientMsg) => sendRef.current(msg),
      getState: useGameStore.getState,
      // Turn recorder: captures every distinct currentTurn the store passes
      // through, so tests can assert on a turn *sequence* rather than sampling a
      // transient value a bot may already have moved past. Results are read back
      // via getRecordedTurns() — the recorder itself has to stay in the page.
      startTurnRecorder: () => {
        turnRecorderStop.current?.()
        recordedTurns.current = [useGameStore.getState().currentTurn]
        turnRecorderStop.current = useGameStore.subscribe((s) => {
          const seen = recordedTurns.current
          if (s.currentTurn !== seen[seen.length - 1]) seen.push(s.currentTurn)
        })
      },
      getRecordedTurns: () => [...recordedTurns.current],
      getWsStatus: () => wsStatus,
      forceCloseWs: forceClose,
    }
  }, [sendRef, wsStatus, forceClose])
}

/**
 * Playing a card, driven through the same handler a real tap goes through, so
 * the suite exercises the legality checks and the prompts rather than the wire.
 */
export function useE2EPlayCard(
  onCardClick: (card: CardDTO, cardIdx: number) => boolean,
  myHand: CardDTO[],
) {
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (!window.__LOCO_E2E__) window.__LOCO_E2E__ = {}
    window.__LOCO_E2E__.playCard = (card: CardDTO) => {
      const idx = myHand.findIndex(
        (c) => c.color === card.color && c.kind === card.kind && c.value === card.value,
      )
      onCardClick(card, Math.max(0, idx))
    }
  }, [onCardClick, myHand])
}
