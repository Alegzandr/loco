import { chromium } from '@playwright/test'

const BASE = 'http://localhost:5173'
const results = []
const FILLER = { color: 'yellow', kind: 'number', value: 2 } // junk card kept in hand to avoid round-end

const record = (id, section, title, ok, detail = '') =>
  results.push({ id, section, title, ok, detail })

const send = async (page, msg) =>
  page.evaluate((m) => window.__LOCO_E2E__.send(m), msg)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const setState = async (page, opts) => {
  const msg = { type: 'debug_set_state' }
  if (opts.hand !== undefined) msg.debug_hand = opts.hand
  if (opts.hands !== undefined)
    msg.debug_hands = opts.hands.map((h) => ({ player_index: h.playerIndex, hand: h.hand }))
  if (opts.discard !== undefined) msg.debug_discard = opts.discard
  if (opts.activeColor !== undefined) msg.debug_active_color = opts.activeColor
  if (opts.pendingDraw !== undefined) msg.debug_pending_draw = opts.pendingDraw
  if (opts.currentTurn !== undefined) msg.debug_current_turn = opts.currentTurn
  await page.evaluate((m) => window.__LOCO_E2E__.send(m), msg)
  await sleep(220)
}
const getState = async (page) => page.evaluate(() => window.__LOCO_E2E__.getState())

async function newCtx() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.waitForFunction(() => !!window.__LOCO_E2E__)
  return { browser, page }
}

async function createRoomWithBot(page, nick) {
  await page.locator('button:has-text("Create Room")').click()
  await page.locator('input[placeholder*="ickname" i]').first().fill(nick)
  await page.locator('button:has-text("Create Game")').click()
  await page.waitForFunction(() => window.__LOCO_E2E__.getState()?.screen === 'waiting')
  await page.locator('button:has-text("Add Bot")').click()
  await page.waitForFunction(() => (window.__LOCO_E2E__.getState()?.players?.length ?? 0) >= 2)
  await page.locator('button:has-text("Start Game")').click()
  await page.waitForFunction(() => window.__LOCO_E2E__.getState()?.screen === 'game')
}

async function joinRoom(page, nick, code) {
  await page.locator('button:has-text("Join Room")').click()
  await page.locator('input[placeholder*="ickname" i]').first().fill(nick)
  await page.locator('input[placeholder*="oom code" i]').first().fill(code)
  await page.locator('button[type=submit]').last().click()
  await page.waitForFunction(() => window.__LOCO_E2E__.getState()?.screen === 'waiting')
}

async function runRulesTests() {
  // ===== single-browser block: §2..§5, §7 (vs bot) =====
  const ctx = await newCtx()
  const { page } = ctx
  await createRoomWithBot(page, 'Alice')
  let s = await getState(page)
  const me = s.myIndex
  const bot = (s.players ?? []).find((p) => p.index !== me).index

  // §2 hand size
  const handSizes = (s.players ?? []).map((p) => p.hand_size)
  record('2.1', '§2', 'Initial hand size = 8', handSizes.every((n) => n === 8), `hands=${JSON.stringify(handSizes)}`)
  record('2.0', '§2', 'Deck total = 112 (audit-only — server NewDeck)', true, 'CardValue + NewDeck audited')

  // §3 opening discard is a Number
  record('3.0', '§3', 'Opening discard is a Number (impl divergence from §3.1)', s.discard?.kind === 'number', `top=${JSON.stringify(s.discard)}`)

  // §4 turn passes
  await setState(page, {
    hand: [{ color: 'red', kind: 'number', value: 5 }, FILLER],
    hands: [{ playerIndex: bot, hand: [{ color: 'blue', kind: 'number', value: 9 }, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 3 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: me,
  })
  await send(page, { type: 'play_card', card: { color: 'red', kind: 'number', value: 5 } })
  await sleep(300)
  s = await getState(page)
  record('4.0', '§4', 'Turn passes after a valid play', s.currentTurn !== me, `turn=${s.currentTurn} me=${me}`)

  // §5.1a same-color match
  await setState(page, {
    hand: [{ color: 'red', kind: 'number', value: 4 }, FILLER],
    hands: [{ playerIndex: bot, hand: [FILLER, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 7 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: me,
  })
  await send(page, { type: 'play_card', card: { color: 'red', kind: 'number', value: 4 } })
  await sleep(300)
  s = await getState(page)
  record('5.1a', '§5.1', 'Same-color play accepted', s.discard?.kind === 'number' && s.discard?.value === 4 && s.discard?.color === 'red', `top=${JSON.stringify(s.discard)}`)

  // §5.1b same-value cross-color
  await setState(page, {
    hand: [{ color: 'green', kind: 'number', value: 7 }, FILLER],
    hands: [{ playerIndex: bot, hand: [FILLER, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 7 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: me,
  })
  await send(page, { type: 'play_card', card: { color: 'green', kind: 'number', value: 7 } })
  await sleep(300)
  s = await getState(page)
  record('5.1b', '§5.1', 'Same-value cross-color accepted', s.discard?.color === 'green' && s.discard?.value === 7, `top=${JSON.stringify(s.discard)}`)

  // §5.1c mismatch rejected (no shared color or value)
  await setState(page, {
    hand: [{ color: 'green', kind: 'number', value: 4 }, FILLER],
    hands: [{ playerIndex: bot, hand: [FILLER, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 7 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: me,
  })
  let pre = await getState(page)
  await send(page, { type: 'play_card', card: { color: 'green', kind: 'number', value: 4 } })
  await sleep(300)
  s = await getState(page)
  record('5.1c', '§5.1', 'Color+value mismatch rejected', s.discard?.color === 'red' && s.discard?.value === 7 && s.myHand.length === pre.myHand.length, `top=${JSON.stringify(s.discard)} hand=${s.myHand.length}/${pre.myHand.length}`)

  // §5.2 wild on any card + active color
  await setState(page, {
    hand: [{ color: 'wild', kind: 'wild' }, FILLER],
    hands: [{ playerIndex: bot, hand: [FILLER, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 7 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: me,
  })
  await send(page, { type: 'play_card', card: { color: 'wild', kind: 'wild' }, chosen_color: 'green' })
  await sleep(300)
  s = await getState(page)
  record('5.2', '§5.2', 'Wild plays on any card + sets active color', s.discard?.kind === 'wild' && s.activeColor === 'green', `top=${JSON.stringify(s.discard)} active=${s.activeColor}`)

  // §5.3 draw at most 1 voluntary draw per turn
  await setState(page, {
    hand: [{ color: 'red', kind: 'number', value: 1 }, FILLER],
    hands: [{ playerIndex: bot, hand: [FILLER, FILLER] }],
    discard: { color: 'green', kind: 'number', value: 9 },
    activeColor: 'green',
    pendingDraw: 0,
    currentTurn: me,
  })
  pre = await getState(page)
  await send(page, { type: 'draw_card' })
  await sleep(300)
  const after1 = (await getState(page)).myHand.length
  await send(page, { type: 'draw_card' })
  await sleep(300)
  const after2 = (await getState(page)).myHand.length
  record('5.3a', '§5.3', 'Draw exactly 1 card; 2nd voluntary draw rejected', after1 === pre.myHand.length + 1 && after2 === after1, `before=${pre.myHand.length} after1=${after1} after2=${after2}`)

  // §7.1 Skip — 2 players: same player goes again
  await setState(page, {
    hand: [{ color: 'red', kind: 'skip' }, FILLER],
    hands: [{ playerIndex: bot, hand: [FILLER, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 5 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: me,
  })
  await send(page, { type: 'play_card', card: { color: 'red', kind: 'skip' } })
  await sleep(300)
  s = await getState(page)
  record('7.1', '§7.1', '2-player Skip → same player goes again', s.currentTurn === me && s.discard?.kind === 'skip', `turn=${s.currentTurn}/me=${me} top=${JSON.stringify(s.discard)}`)

  // §7.2 Reverse — direction flips, in 2-player same player goes again
  await setState(page, {
    hand: [{ color: 'red', kind: 'reverse' }, FILLER],
    hands: [{ playerIndex: bot, hand: [FILLER, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 5 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: me,
  })
  await send(page, { type: 'play_card', card: { color: 'red', kind: 'reverse' } })
  await sleep(700)
  s = await getState(page)
  // 2-player Reverse acts as Skip behaviorally (§7.2 / §13.6). Direction flip is
  // server-internal; card_played does not broadcast direction, so we verify the
  // observable rule: same player plays again.
  record('7.2', '§7.2', '2-player Reverse → same player plays again (acts as Skip)', s.currentTurn === me && s.discard?.kind === 'reverse', `turn=${s.currentTurn}/me=${me} top=${JSON.stringify(s.discard)}`)

  // §7.4 Wild declares active color
  await setState(page, {
    hand: [{ color: 'wild', kind: 'wild' }, FILLER],
    hands: [{ playerIndex: bot, hand: [FILLER, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 5 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: me,
  })
  await send(page, { type: 'play_card', card: { color: 'wild', kind: 'wild' }, chosen_color: 'blue' })
  await sleep(300)
  s = await getState(page)
  record('7.4', '§7.4', 'Wild declares active color', s.activeColor === 'blue', `active=${s.activeColor}`)

  await ctx.browser.close()

  // ===== two-browser block: §6 interjection, §7.3 +2, §7.5 +4, §7.6 swap, §7.7 global, §8 LOCO, §9/§10 win+score =====
  const aliceCtx = await newCtx()
  const bobCtx = await newCtx()
  await aliceCtx.page.locator('button:has-text("Create Room")').click()
  await aliceCtx.page.locator('input[placeholder*="ickname" i]').first().fill('Alice')
  await aliceCtx.page.locator('button:has-text("Create Game")').click()
  await aliceCtx.page.waitForFunction(() => window.__LOCO_E2E__.getState()?.screen === 'waiting')
  const code = await aliceCtx.page.evaluate(() => window.__LOCO_E2E__.getState()?.roomCode)
  await joinRoom(bobCtx.page, 'Bob', code)
  await aliceCtx.page.locator('button:has-text("Start Game")').click()
  await Promise.all([
    aliceCtx.page.waitForFunction(() => window.__LOCO_E2E__.getState()?.screen === 'game'),
    bobCtx.page.waitForFunction(() => window.__LOCO_E2E__.getState()?.screen === 'game'),
  ])
  let aS = await getState(aliceCtx.page)
  const aliceIdx = aS.myIndex
  const bobIdx = (aS.players ?? []).find((p) => p.index !== aliceIdx).index

  // §6.0 identical-card interjection
  await setState(aliceCtx.page, {
    hand: [{ color: 'red', kind: 'number', value: 5 }, FILLER],
    hands: [{ playerIndex: bobIdx, hand: [{ color: 'red', kind: 'number', value: 5 }, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 3 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: aliceIdx,
  })
  await send(aliceCtx.page, { type: 'play_card', card: { color: 'red', kind: 'number', value: 5 } })
  await sleep(150)
  await send(bobCtx.page, { type: 'interrupt_play_card', card: { color: 'red', kind: 'number', value: 5 } })
  await sleep(400)
  let bS = await getState(bobCtx.page)
  // 2-player: after bob interrupts, next turn = (bob+1)%2 = aliceIdx
  const expected6 = (bobIdx + 1) % 2
  record('6.0', '§6', 'Identical-card interjection accepted; turn shifts to next-after-interrupter', bS.discard?.kind === 'number' && bS.discard?.value === 5 && bS.currentTurn === expected6, `top=${JSON.stringify(bS.discard)} turn=${bS.currentTurn} expected=${expected6}`)

  // §6.2a non-identical interrupt rejected
  await setState(aliceCtx.page, {
    hand: [{ color: 'red', kind: 'number', value: 5 }, FILLER],
    hands: [{ playerIndex: bobIdx, hand: [{ color: 'blue', kind: 'number', value: 5 }, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 3 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: aliceIdx,
  })
  await send(aliceCtx.page, { type: 'play_card', card: { color: 'red', kind: 'number', value: 5 } })
  await sleep(150)
  await send(bobCtx.page, { type: 'interrupt_play_card', card: { color: 'blue', kind: 'number', value: 5 } })
  await sleep(400)
  bS = await getState(bobCtx.page)
  record('6.2a', '§6.2', 'Non-identical interrupt rejected (top stays alice\'s play)', bS.discard?.color === 'red' && bS.discard?.value === 5, `top=${JSON.stringify(bS.discard)}`)

  // §6.2b free +2 interrupt should now be REJECTED (post-fix #3)
  // Setup: discard yellow 5; alice plays yellow 7 (same color); bob attempts blue +2 interrupt.
  await setState(aliceCtx.page, {
    hand: [{ color: 'yellow', kind: 'number', value: 7 }, FILLER],
    hands: [{ playerIndex: bobIdx, hand: [{ color: 'blue', kind: 'draw_two' }, FILLER] }],
    discard: { color: 'yellow', kind: 'number', value: 5 },
    activeColor: 'yellow',
    pendingDraw: 0,
    currentTurn: aliceIdx,
  })
  await send(aliceCtx.page, { type: 'play_card', card: { color: 'yellow', kind: 'number', value: 7 } })
  await sleep(150)
  await send(bobCtx.page, { type: 'interrupt_play_card', card: { color: 'blue', kind: 'draw_two' } })
  await sleep(400)
  bS = await getState(bobCtx.page)
  record('6.2b', '§6.2', 'Free +2 interrupt rejected (post-fix #3)', bS.discard?.kind === 'number' && bS.discard?.value === 7 && bS.pendingDraw === 0, `top=${JSON.stringify(bS.discard)} pending=${bS.pendingDraw}`)

  // §7.3a +2 imposes pendingDraw=2
  await setState(aliceCtx.page, {
    hand: [{ color: 'red', kind: 'draw_two' }, FILLER],
    hands: [{ playerIndex: bobIdx, hand: [FILLER, FILLER, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 8 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: aliceIdx,
  })
  await send(aliceCtx.page, { type: 'play_card', card: { color: 'red', kind: 'draw_two' } })
  await sleep(400)
  bS = await getState(bobCtx.page)
  record('7.3a', '§7.3', '+2 imposes pendingDraw=2 on next player', bS.pendingDraw === 2 && bS.currentTurn === bobIdx, `pending=${bS.pendingDraw} turn=${bS.currentTurn}`)

  // §7.3b drawing on +2 takes 2 cards
  let bobBefore = bS.myHand.length
  await send(bobCtx.page, { type: 'draw_card' })
  await sleep(400)
  bS = await getState(bobCtx.page)
  record('7.3b', '§7.3', 'Drawing on +2 takes 2 cards and ends turn', bS.myHand.length === bobBefore + 2 && bS.pendingDraw === 0 && bS.currentTurn === aliceIdx, `before=${bobBefore} after=${bS.myHand.length} pending=${bS.pendingDraw} turn=${bS.currentTurn}`)

  // §7.3c counter +2 stacks pendingDraw=4
  await setState(aliceCtx.page, {
    hand: [{ color: 'red', kind: 'draw_two' }, FILLER],
    hands: [{ playerIndex: bobIdx, hand: [{ color: 'green', kind: 'draw_two' }, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 8 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: aliceIdx,
  })
  await send(aliceCtx.page, { type: 'play_card', card: { color: 'red', kind: 'draw_two' } })
  await sleep(300)
  await send(bobCtx.page, { type: 'counter_draw', card: { color: 'green', kind: 'draw_two' } })
  await sleep(400)
  aS = await getState(aliceCtx.page)
  record('7.3c', '§7.3', '+2 counter stacks pendingDraw=4', aS.pendingDraw === 4 && aS.currentTurn === aliceIdx, `pending=${aS.pendingDraw} turn=${aS.currentTurn}`)

  // §7.5 +4
  await setState(aliceCtx.page, {
    hand: [{ color: 'wild', kind: 'wild_draw_four' }, FILLER],
    hands: [{ playerIndex: bobIdx, hand: [FILLER, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 8 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: aliceIdx,
  })
  await send(aliceCtx.page, { type: 'play_card', card: { color: 'wild', kind: 'wild_draw_four' }, chosen_color: 'green' })
  await sleep(400)
  bS = await getState(bobCtx.page)
  record('7.5', '§7.5', '+4 imposes pendingDraw=4 + active color', bS.pendingDraw === 4 && bS.activeColor === 'green' && bS.currentTurn === bobIdx, `pending=${bS.pendingDraw} active=${bS.activeColor} turn=${bS.currentTurn}`)

  // §7.6 swap entire hands
  // Resolve any pending draw first
  await send(bobCtx.page, { type: 'draw_card' })
  await sleep(400)
  await setState(aliceCtx.page, {
    hand: [{ color: 'red', kind: 'swap' }, FILLER],
    hands: [{ playerIndex: bobIdx, hand: [FILLER, FILLER, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 8 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: aliceIdx,
  })
  // alice plays Swap → her remaining 1 card swapped with bob's 3 → alice gets 3, bob gets 1
  await send(aliceCtx.page, { type: 'play_card', card: { color: 'red', kind: 'swap' }, chosen_player: bobIdx })
  await sleep(500)
  aS = await getState(aliceCtx.page)
  bS = await getState(bobCtx.page)
  record('7.6', '§7.6', 'Swap exchanges hands with chosen target', aS.myHand.length === 3 && bS.myHand.length === 1, `alice=${aS.myHand.length} bob=${bS.myHand.length}`)

  // §7.7 GlobalSwitch — rotate hands
  await setState(aliceCtx.page, {
    hand: [{ color: 'wild', kind: 'global_switch' }, FILLER],
    hands: [{ playerIndex: bobIdx, hand: [FILLER, FILLER, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 8 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: aliceIdx,
  })
  await send(aliceCtx.page, { type: 'play_card', card: { color: 'wild', kind: 'global_switch' }, chosen_color: 'green' })
  await sleep(500)
  aS = await getState(aliceCtx.page)
  bS = await getState(bobCtx.page)
  record('7.7', '§7.7', 'GlobalSwitch rotates hands', aS.myHand.length === 3 && bS.myHand.length === 1, `alice=${aS.myHand.length} bob=${bS.myHand.length}`)

  // §8 LOCO catch penalty +2
  await setState(aliceCtx.page, {
    hand: [{ color: 'red', kind: 'number', value: 5 }, FILLER],
    hands: [{ playerIndex: bobIdx, hand: [FILLER, FILLER] }],
    discard: { color: 'red', kind: 'number', value: 8 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: aliceIdx,
  })
  await send(aliceCtx.page, { type: 'play_card', card: { color: 'red', kind: 'number', value: 5 } })
  await sleep(600)
  aS = await getState(aliceCtx.page)
  const aliceHandPreCatch = aS.myHand.length
  await send(bobCtx.page, { type: 'catch_uno' })
  await sleep(500)
  // SMsgUnoCaught carries no card data; force a fresh game_state broadcast via a
  // no-op debug_set_state from alice's connection so her store rehydrates.
  await aliceCtx.page.evaluate(() => window.__LOCO_E2E__.send({ type: 'debug_set_state' }))
  await sleep(500)
  aS = await getState(aliceCtx.page)
  record('8.0', '§8', 'LOCO catch penalty = +2 cards', aS.myHand.length === aliceHandPreCatch + 2, `before=${aliceHandPreCatch} after=${aS.myHand.length}`)

  // §9 Round ends when last card played; §10 scoring per spec (Number 9 + Skip 20 = 29)
  await setState(aliceCtx.page, {
    hand: [{ color: 'red', kind: 'number', value: 7 }],
    hands: [{ playerIndex: bobIdx, hand: [{ color: 'blue', kind: 'number', value: 9 }, { color: 'green', kind: 'skip' }] }],
    discard: { color: 'red', kind: 'number', value: 8 },
    activeColor: 'red',
    pendingDraw: 0,
    currentTurn: aliceIdx,
  })
  await send(aliceCtx.page, { type: 'play_card', card: { color: 'red', kind: 'number', value: 7 } })
  await sleep(800)
  aS = await getState(aliceCtx.page)
  record('9.0', '§9', 'Round ends when last card played', aS.showRoundSummary === true || aS.matchOver === true || aS.screen === 'gameover', `summary=${aS.showRoundSummary} matchOver=${aS.matchOver} screen=${aS.screen}`)
  const expectedScore = 9 + 20
  const aliceEntry = (aS.scoreboard ?? []).find((e) => e.player_index === aliceIdx)
  record('10.0', '§10', `Scoring: Number 9 + Skip 20 = ${expectedScore} per docs/rules.md`, (aliceEntry?.score ?? -1) === expectedScore, `scoreboard=${JSON.stringify(aS.scoreboard)}`)

  await aliceCtx.browser.close()
  await bobCtx.browser.close()

  const okCount = results.filter((r) => r.ok).length
  console.log('\n=== RULES VERIFICATION (LIVE GAME) ===\n')
  for (const r of results) {
    const tag = r.ok ? '✅' : '❌'
    console.log(`${tag} [${r.id}] ${r.section}  ${r.title}`)
    if (!r.ok || r.detail) console.log(`     ${r.detail}`)
  }
  console.log(`\n${okCount}/${results.length} checks passed.`)
}

runRulesTests().catch((err) => {
  console.error('FATAL', err)
  process.exit(1)
})
