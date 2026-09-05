import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { render, screen, within } from './render'
import ScoreTable from '../components/ScoreTable.svelte'
import { buildScoreRows, pingTier } from '../components/scoreTableModel'
import { en } from '../i18n/en'
import type { LatencyEntryDTO, PlayerDTO, ScoreboardEntryDTO } from '../types/protocol'

const players: PlayerDTO[] = [
  { index: 0, nickname: 'alice', hand_size: 4, connected: true },
  { index: 1, nickname: 'bob', hand_size: 7, connected: true },
  { index: 2, nickname: 'Bot1', hand_size: 2, connected: true },
]

const scoreboard: ScoreboardEntryDTO[] = [
  { player_index: 0, nickname: 'alice', score: 30, rounds_won: 1 },
  { player_index: 1, nickname: 'bob', score: 90, rounds_won: 1 },
  { player_index: 2, nickname: 'Bot1', score: 0, rounds_won: 0 },
]

// Only the finisher scores, so exactly one column per row is non-zero.
const roundHistory = [
  [30, 0, 0],
  [0, 90, 0],
]

const latencies: LatencyEntryDTO[] = [
  { player_index: 0, rtt_ms: 42 },
  { player_index: 1, rtt_ms: -1 },
  { player_index: 2, rtt_ms: -1, bot: true },
]

describe('pingTier', () => {
  it('bands a round trip by how much it costs in a race', () => {
    expect(pingTier(12)).toBe('good')
    expect(pingTier(59)).toBe('good')
    expect(pingTier(60)).toBe('ok')
    expect(pingTier(119)).toBe('ok')
    expect(pingTier(120)).toBe('poor')
    expect(pingTier(219)).toBe('poor')
    expect(pingTier(220)).toBe('bad')
    expect(pingTier(4000)).toBe('bad')
  })

  it('treats an unmeasured seat as unknown rather than as a perfect 0ms', () => {
    expect(pingTier(null)).toBe('unknown')
    expect(pingTier(undefined)).toBe('unknown')
    expect(pingTier(-1)).toBe('unknown')
  })
})

describe('buildScoreRows', () => {
  // The match is settled on rounds won, so the standings are too. Alice and Bob
  // are level on rounds here and Bob is ahead on points, so points break it —
  // and the fixture below proves the first key is the rounds, not the points.
  it('orders by rounds won, then score, then seat', () => {
    const rows = buildScoreRows(players, scoreboard, roundHistory, latencies)
    expect(rows.map((r) => r.nickname)).toEqual(['bob', 'alice', 'Bot1'])
  })

  it('puts the seat with more rounds above the seat with more points', () => {
    const behindOnRounds: ScoreboardEntryDTO[] = [
      { player_index: 0, nickname: 'alice', score: 20, rounds_won: 3 },
      { player_index: 1, nickname: 'bob', score: 500, rounds_won: 1 },
      { player_index: 2, nickname: 'Bot1', score: 0, rounds_won: 0 },
    ]
    const rows = buildScoreRows(players, behindOnRounds, roundHistory, latencies)
    expect(rows.map((r) => r.nickname)).toEqual(['alice', 'bob', 'Bot1'])
  })

  it('carries each seat its own column of the history', () => {
    const rows = buildScoreRows(players, scoreboard, roundHistory, latencies)
    const alice = rows.find((r) => r.index === 0)!
    expect(alice.perRound).toEqual([30, 0])
    expect(alice.total).toBe(30)
    expect(alice.wins).toBe(1)
  })

  it('reports an unmeasured ping as null and flags bots', () => {
    const rows = buildScoreRows(players, scoreboard, roundHistory, latencies)
    expect(rows.find((r) => r.index === 0)!.rtt).toBe(42)
    expect(rows.find((r) => r.index === 1)!.rtt).toBeNull()
    expect(rows.find((r) => r.index === 2)!.bot).toBe(true)
  })

  // The server holds the latency broadcast back until a human has answered a
  // ping, so for the first seconds of every match the table has a roster and no
  // pings at all. The bot's cell has to say BOT through that, not "no ping".
  it('labels a bot off the roster, before any ping has been broadcast', () => {
    const roster: PlayerDTO[] = [
      { index: 0, nickname: 'alice', hand_size: 8, connected: true },
      { index: 1, nickname: 'Bot1', hand_size: 8, connected: true, is_bot: true },
    ]
    const rows = buildScoreRows(roster, [], [], [])
    expect(rows.find((r) => r.index === 1)!.bot).toBe(true)
    expect(rows.find((r) => r.index === 0)!.bot).toBe(false)
  })

  // The roster arrives with game_state; the scoreboard and the latency
  // broadcast can each be a beat behind it, and a missing row is worse than a
  // zero: the player it belongs to disappears from the standings.
  it('keeps a row for a seat the scoreboard and the pings do not know yet', () => {
    const rows = buildScoreRows(players, [], [], [])
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.total === 0 && r.rtt === null && !r.bot)).toBe(true)
  })
})

describe('<ScoreTable />', () => {
  it('shows one column per finished round plus the ping of every seat', () => {
    render(
      ScoreTable, { players: players, scoreboard: scoreboard, roundHistory: roundHistory, latencies: latencies, myIndex: 0, t: en },
    )
    expect(screen.getByText('R1')).toBeTruthy()
    expect(screen.getByText('R2')).toBeTruthy()
    expect(screen.getByText('42 ms')).toBeTruthy()
    expect(screen.getByText(en.scoreTableBot)).toBeTruthy()
    // bob has no measurement yet, so the cell must not claim a number.
    expect(screen.getByText(en.scoreTableNoPing)).toBeTruthy()
  })

  it('tags the local player row so it can be found at a glance', () => {
    render(
      ScoreTable, { players: players, scoreboard: scoreboard, roundHistory: roundHistory, latencies: latencies, myIndex: 1, t: en },
    )
    const row = screen.getByText('bob').closest('tr')!
    expect(within(row).getByText(en.scoreTableYou)).toBeTruthy()
  })

  it('says so instead of showing empty columns before the first round ends', () => {
    render(
      ScoreTable, { players: players, scoreboard: scoreboard, roundHistory: [], latencies: latencies, myIndex: 0, t: en },
    )
    expect(screen.getByText(en.scoreTableEmptyRounds)).toBeTruthy()
    expect(screen.queryByText('R1')).toBeNull()
  })
})

/**
 * The panel is opened in order to be read, which is a claim about layers before
 * it is a claim about anything else.
 *
 * It sat at 45 — the interrupt banner's layer and the catch banner's, both
 * rendered after it and so painted over it — under the catch capsule at 47 and
 * under the top-right chip row at 46. Every one of those is a cue about the
 * board, and the board is precisely what somebody holding TAB has stopped
 * looking at. So the rule is a floor rather than a number: nothing the board
 * puts on top of itself may cross this panel, whatever gets added next.
 *
 * jsdom applies no component styles and lays nothing out, so the layers are read
 * off the sources. Anything that outranks a read is named here and nowhere else.
 */
describe('nothing the board draws crosses the standings', () => {
  const read = (file: string) =>
    readFileSync(path.resolve(__dirname, '..', 'components', file), 'utf8')

  /**
   * Every `selector { … z-index: n … }` in a component's style block.
   *
   * Comments go first: they carry no braces, so a rule preceded by one reads as
   * a selector with a paragraph of prose in front of it — which matches nothing
   * by name and leaves the lookup below returning `undefined` rather than
   * failing.
   */
  function layers(file: string): [string, number][] {
    const src = read(file)
    // The style block alone: the markup above it holds no braces either, so a
    // rule at the top of it reads as a selector with the whole template in
    // front of it.
    const tag = src.slice(src.indexOf('<style'))
    const style = tag.slice(tag.indexOf('>') + 1).replace(/\/\*[\s\S]*?\*\//g, ' ')
    const out: [string, number][] = []
    const re = /([^{}]+)\{([^{}]*)\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(style))) {
      const z = /(?:^|[\s;])z-index:\s*(-?\d+)/.exec(m[2])
      if (z) out.push([m[1].trim().replace(/\s+/g, ' '), Number(z[1])])
    }
    return out
  }

  const panel = layers('ScoreTable.svelte').find(([sel]) => sel === '.overlay')?.[1]

  it('is a layer of its own, above the board and below the screen', () => {
    expect(panel, 'the overlay must declare its layer').toBeTypeOf('number')
    // Under the reconnect curtain, which says the table is not there at all,
    // and under the two pickers, which are a decision the player owes the table.
    expect(panel!).toBeLessThan(50)
  })

  /**
   * Read from the sources rather than listed by hand: a fifth banner added at
   * 46 fails here without anybody remembering this rule exists.
   *
   * `.reconnectOverlay` is GameView's one exception and is excluded by name.
   */
  const board: [string, string[]][] = [
    ['GameView.svelte', ['.reconnectOverlay']],
    ['CatchBanner.svelte', []],
    ['InterruptBanner.svelte', []],
    ['UnoTimer.svelte', []],
    ['RoundSummary.svelte', []],
    ['OpponentAway.svelte', []],
    ['ActionBar.svelte', []],
  ]

  for (const [file, exempt] of board) {
    it(`draws ${file} under it`, () => {
      const found = layers(file).filter(([sel]) => !exempt.includes(sel))
      // A file that stopped declaring any layer at all would pass an assertion
      // over an empty list forever.
      expect(found.length, `${file} declares no layer — is this reading the right file?`)
        .toBeGreaterThan(0)
      for (const [sel, z] of found) {
        expect(z, `${file} ${sel} is drawn over the standings`).toBeLessThan(panel!)
      }
    })
  }
})
