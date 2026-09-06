/**
 * batch-play.spec.ts
 *
 * One `card_played` can stand for several discards. The client used to remove
 * exactly one copy from the local hand, which left the rest as phantom cards:
 * they rendered, they could be tapped, and the server refused every tap with
 * "card not in hand" for the remainder of the round.
 *
 * `play_cards` had no end-to-end coverage at all, which is how a hand desync in
 * the game's signature mechanic survived. It is still the shape the wire
 * carries, and it is still how a turn batch travels — but an interject is one
 * card now, and the server refuses a batch one, so the other half of this file
 * is about the refusal and the presses that replace it.
 *
 * Coverage:
 *   - batch play (current player, N identical cards) leaves no phantom copies
 *   - the resulting hand still plays: the next card is accepted by the server
 *   - a batch +2 stacks 2N on the wire
 *   - a batch interject is refused, and the copies go down a press each
 *   - two identical cards take the round in two presses, with the LOCO! call
 *     owed in between (docs/rules.md §6.5, §14.7)
 *
 * Prerequisites: server with LOCO_E2E=1 on :8080.
 */
import { test, expect, Browser } from '@playwright/test'
import {
  createRoom,
  joinRoom,
  addBot,
  startGame,
  gameBoard,
  getState,
  sendMsg,
  debugSetState,
  waitForMyTurn,
  waitForTableOpen,
  waitForGameOver,
} from '../helpers/game'

const red5 = { color: 'red', kind: 'number', value: 5 } as const
const blue7 = { color: 'blue', kind: 'number', value: 7 } as const
const red3 = { color: 'red', kind: 'number', value: 3 } as const
const green2 = { color: 'green', kind: 'number', value: 2 } as const
const green4 = { color: 'green', kind: 'number', value: 4 } as const

/**
 * The local hand and the server's own count for our seat must agree. The
 * desync this guards is silent: nothing errors until the player taps a card
 * that no longer exists.
 */
async function expectHandInSync(page: Parameters<typeof getState>[0], expected: number) {
  await page.waitForFunction(
    (n: number) => {
      const s = window.__LOCO_E2E__?.getState?.()
      if (!s) return false
      const me = s.players.find((p) => p.index === s.myIndex)
      return s.myHand.length === n && me?.hand_size === n
    },
    expected,
    { timeout: 10_000 },
  )
}

test.describe('batch play', () => {
  test('slams every copy and leaves no phantom card behind', async ({ browser }: { browser: Browser }) => {
    const ctxs = await Promise.all([browser.newContext(), browser.newContext()])
    const [alice, bob] = await Promise.all(ctxs.map((c) => c.newPage()))
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })
      await waitForTableOpen(bob)

      const me = (await getState(alice))!.myIndex
      await debugSetState(alice, {
        // Five cards so the batch leaves two: at one card the seat is catchable,
        // and at zero the round ends and a fresh hand is dealt.
        hand: [red5, red5, red5, blue7, green2],
        discard: red3,
        activeColor: 'red',
        // Explicitly cleared. A fixture has to state everything the assertion
        // depends on, not only the part it is about: PlayCard refuses every card
        // while a stack is pending, so a +2 left over from the deal would make
        // this pass or fail on the shuffle.
        pendingDraw: 0,
        currentTurn: me,
        direction: 1,
      })
      await waitForMyTurn(alice)

      await sendMsg(alice, { type: 'play_card', play_cards: [red5, red5, red5] })

      // Two cards left, and neither is a red 5 the server has already discarded.
      await expectHandInSync(alice, 2)
      const after = await getState(alice)
      expect(after!.myHand.map((c) => `${c.color}:${c.value ?? c.kind}`).sort()).toEqual([
        'blue:7',
        'green:2',
      ])
      expect(after!.discard).toMatchObject({ color: 'red', kind: 'number', value: 5 })
    } finally {
      await Promise.all(ctxs.map((c) => c.close()))
    }
  })

  /**
   * Two humans, not a bot. This test needs two of our turns, and whatever plays
   * in between must be nothing: a bot given the turn will play a card, and if it
   * plays a Swap or a Global Swap the hand under the assertion is replaced
   * wholesale. That is a real rule doing its job, not a flake to retry.
   */
  test('the hand left after a batch is still playable', async ({ browser }: { browser: Browser }) => {
    const ctxs = await Promise.all([browser.newContext(), browser.newContext()])
    const [alice, bob] = await Promise.all(ctxs.map((c) => c.newPage()))
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })
      await waitForTableOpen(bob)

      const me = (await getState(alice))!.myIndex
      // Never down to 0 or 1 cards: emptying the hand ends the round and the
      // next one is dealt, and a single card opens a catch window. Either makes
      // the final state transient.
      await debugSetState(alice, {
        hand: [red5, red5, blue7, green2, green4],
        discard: red3,
        activeColor: 'red',
        pendingDraw: 0,
        currentTurn: me,
        direction: 1,
      })
      await waitForMyTurn(alice)

      await sendMsg(alice, { type: 'play_card', play_cards: [red5, red5] })
      await expectHandInSync(alice, 3)

      // The blue 7 is a legal follow-up once the turn comes back around. If the
      // client had kept a phantom red 5 the fan would show a card the server
      // refuses, which is the failure this whole file exists for.
      await debugSetState(alice, {
        discard: blue7,
        activeColor: 'blue',
        pendingDraw: 0,
        currentTurn: me,
        direction: 1,
      })
      await waitForMyTurn(alice)
      await sendMsg(alice, { type: 'play_card', card: blue7 })

      await expectHandInSync(alice, 2)
      const errored = await alice.evaluate(() => window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '')
      expect(errored).toBe('')
    } finally {
      await Promise.all(ctxs.map((c) => c.close()))
    }
  })

  /**
   * The interject is the path the client builds by itself, and it builds one
   * card. It used to group every identical copy into a single
   * `interrupt_play_card`: a seat holding three +4 emptied the chain onto the
   * table on one press, and the read the mechanic is made of never had to be
   * made again. The server refuses the batch now, and the copies go down a
   * press each.
   *
   * Two humans, no bot: a bot's 800ms timer would play a card and re-arm the
   * window under the interject in flight.
   */
  test('a batch interject is refused, and the copies go down one press each', async ({
    browser,
  }: {
    browser: Browser
  }) => {
    const ctxs = await Promise.all([browser.newContext(), browser.newContext()])
    const [alice, bob] = await Promise.all(ctxs.map((c) => c.newPage()))
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })
      await waitForTableOpen(bob)

      const aliceIdx = (await getState(alice))!.myIndex
      const bobIdx = (await getState(bob))!.myIndex

      await debugSetState(alice, {
        hand: [red5, blue7],
        hands: [{ playerIndex: bobIdx, hand: [red5, red5, red5, blue7] }],
        discard: red3,
        activeColor: 'red',
        pendingDraw: 0,
        currentTurn: aliceIdx,
        direction: 1,
      })

      // Alice's play is what puts the red 5 on top for Bob to slam.
      await sendMsg(alice, { type: 'play_card', card: red5 })
      await bob.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.discard?.value === 5,
        undefined,
        { timeout: 5_000 },
      )

      // All three at once: refused, and the hand does not move.
      await sendMsg(bob, { type: 'interrupt_play_card', play_cards: [red5, red5, red5] })
      await bob.waitForFunction(
        () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') !== '',
        undefined,
        { timeout: 5_000 },
      )
      await expectHandInSync(bob, 4)

      // One press, one card. Bob takes the lead back off himself for the second,
      // which is the same window anyone else at the table could have won.
      await sendMsg(bob, { type: 'interrupt_play_card', card: red5 })
      await bob.waitForFunction(
        (idx) => window.__LOCO_E2E__?.getState?.()?.interruptFlash?.actorIndex === idx,
        bobIdx,
        { timeout: 5_000 },
      )
      await expectHandInSync(bob, 3)

      await sendMsg(bob, { type: 'interrupt_play_card', card: red5 })
      await expectHandInSync(bob, 2)

      const after = await getState(bob)
      expect(after!.myHand.filter((c) => c.color === 'red')).toHaveLength(1)
    } finally {
      await Promise.all(ctxs.map((c) => c.close()))
    }
  })

  /**
   * The hand of two identical cards, which used to take the round in one slam
   * and is the reason `declare_loco` exists on the wire at all.
   *
   * It now takes two presses, and the seat sits on one card in between: on the
   * hook, catchable, with the LOCO! button offered. So the winning press is
   * refused until the call is made, exactly like every other last card
   * (docs/rules.md §14.7) — no finish is an exemption any more, because no
   * finish skips the single-card state.
   */
  test('two identical cards take the round in two presses, and the call in between', async ({
    browser,
  }: {
    browser: Browser
  }) => {
    const ctxs = await Promise.all([browser.newContext(), browser.newContext()])
    const [alice, bob] = await Promise.all(ctxs.map((c) => c.newPage()))
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })
      await waitForTableOpen(bob)

      const aliceIdx = (await getState(alice))!.myIndex
      const bobIdx = (await getState(bob))!.myIndex

      // Bob holds exactly two identical cards.
      await debugSetState(alice, {
        hand: [red5, blue7],
        hands: [{ playerIndex: bobIdx, hand: [red5, red5] }],
        discard: red3,
        activeColor: 'red',
        pendingDraw: 0,
        currentTurn: aliceIdx,
        direction: 1,
      })

      // Alice's play is what puts the red 5 on top for Bob to slam.
      await sendMsg(alice, { type: 'play_card', card: red5 })
      await bob.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.discard?.value === 5,
        undefined,
        { timeout: 5_000 },
      )

      // The old one-press win, refused.
      await sendMsg(bob, { type: 'interrupt_play_card', play_cards: [red5, red5] })
      await bob.waitForFunction(
        () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') !== '',
        undefined,
        { timeout: 5_000 },
      )
      expect((await getState(bob))!.myHand).toHaveLength(2)

      // First press: down to one card, and nothing was declared on Bob's behalf.
      await sendMsg(bob, { type: 'interrupt_play_card', card: red5 })
      await expectHandInSync(bob, 1)
      expect((await getState(bob))!.screen).toBe('game')

      // Second press without the call: refused, exactly like a last card played
      // in turn. Matched on the refusal itself, since the batch one may still
      // be on screen.
      await sendMsg(bob, { type: 'interrupt_play_card', card: red5 })
      await bob.waitForFunction(
        () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '').includes('LOCO'),
        undefined,
        { timeout: 5_000 },
      )
      expect((await getState(bob))!.myHand).toHaveLength(1)

      // Call it, then take it.
      await sendMsg(bob, { type: 'declare_uno' })
      await sendMsg(bob, { type: 'interrupt_play_card', card: red5 })
      await waitForGameOver(bob)
      expect((await getState(bob))!.myHand).toHaveLength(0)
    } finally {
      await Promise.all(ctxs.map((c) => c.close()))
    }
  })
})
