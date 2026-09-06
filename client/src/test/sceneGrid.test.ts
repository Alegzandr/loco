/**
 * The street grid a room is laid out on, and what makes it a room a spectator
 * can rest their eyes on.
 *
 * Three things here were bugs on screen before they were rules: a car parked
 * on the flagstones round the table, because the grid knew nothing about the
 * paving in three of the six rooms; traffic driving through the crowd on a
 * road buried under the plaza; and every block built to the frame's edge,
 * which made every room a wall of façades. The grid answers all three now,
 * and these tests fail without it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { cityGrid, plazaRim, podium, screenOf, underTable, type Cell, type GridSpec } from '../components/scene/maps/common'
import { seededRng } from '../components/scene/rng'

const ANCHOR = { sx: 0, sy: -2, a: 27, b: 10 }
const MAPS = ['neon', 'rune', 'velvet', 'orbit', 'sakura', 'marina'] as const

/** A kit that records what the grid put where, and builds nothing. */
function probe(seed = 'grid') {
  const cars: [number, number][] = []
  const lamps: [number, number][] = []
  const kit = {
    anchor: ANCHOR,
    rng: seededRng(seed),
    rig: { lampsOn: true },
    road: () => {},
    slab: () => {},
    box: () => {},
    oval: () => {},
    halo: () => {},
    ground: (c: number) => c,
    claim: () => {},
    person: () => {},
    lamp: (x: number, z: number) => lamps.push([x, z]),
    car: (x: number, z: number) => cars.push([x, z]),
  }
  return { kit: kit as unknown as Parameters<typeof cityGrid>[0], cars, lamps }
}

/** True where the podium's paving lies, on screen, the way the grid tests it. */
function paved(x: number, z: number): boolean {
  const { sa, sb } = plazaRim({ anchor: ANCHOR } as Parameters<typeof plazaRim>[0])
  const [px, py] = screenOf(x, z)
  const dx = (px - ANCHOR.sx) / sa
  const dy = (py - ANCHOR.sy) / sb
  return dx * dx + dy * dy < 1
}

const BASE: Omit<GridSpec, 'fill'> = { block: 11, road: 3.6, roadColor: 0, cars: [0xff0000], carDensity: 1, lamp: {}, lampChance: 1 }

describe('nothing drives on the plaza', () => {
  it('parks no car on the paving, whatever the builder handed the grid about it', () => {
    // No `plaza` given: the grid solves the rim itself. This is the case three
    // rooms were in, with cars on the flagstones to show for it.
    const { kit, cars } = probe()
    cityGrid(kit, { ...BASE, fill: () => {} })
    expect(cars.length).toBeGreaterThan(10)
    for (const [x, z] of cars) {
      expect(paved(x, z), `car at ${x.toFixed(1)}, ${z.toFixed(1)} stands on the paving`).toBe(false)
      expect(underTable(kit, x, z, 3), `car at ${x.toFixed(1)}, ${z.toFixed(1)} stands under the table`).toBe(false)
    }
  })

  it('hands traffic no run that crosses the paving or the table', () => {
    const { kit } = probe()
    const plan = cityGrid(kit, { ...BASE, fill: () => {} })
    expect(plan.runs.length).toBeGreaterThan(4)
    for (const run of plan.runs) {
      for (let t = 0; t <= 1; t += 0.05) {
        const along = run.from + (run.to - run.from) * t
        const [x, z] = run.axis === 'x' ? [along, run.line] : [run.line, along]
        expect(paved(x, z), `run ${run.axis}:${run.line} crosses the paving`).toBe(false)
        expect(underTable(kit, x, z, 3), `run ${run.axis}:${run.line} runs under the table`).toBe(false)
      }
    }
  })

  it('stands no lamp on the paving either', () => {
    const { kit, lamps } = probe()
    cityGrid(kit, { ...BASE, fill: () => {} })
    expect(lamps.length).toBeGreaterThan(10)
    for (const [x, z] of lamps) expect(paved(x, z), `lamp at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(false)
  })

  it('solves the same rim the podium lays', () => {
    const { kit } = probe()
    const laid = podium(kit, { stone: 0, step: 0, floor: 0, floor2: 0, accent: 0, top: 0 })
    const solved = plazaRim(kit)
    expect(solved.sa).toBeCloseTo(laid.sa, 9)
    expect(solved.sb).toBeCloseTo(laid.sb, 9)
  })
})

describe('a room breathes', () => {
  it('leaves the share of blocks the builder asked for open, and hands them to `open`', () => {
    const built: Cell[] = []
    const left: Cell[] = []
    const { kit } = probe()
    cityGrid(kit, { ...BASE, cars: undefined, density: 0, fill: (c) => built.push(c), open: (c) => left.push(c) })
    expect(built).toHaveLength(0)
    expect(left.length).toBeGreaterThan(20)
  })

  it('builds everything when no density is given', () => {
    const built: Cell[] = []
    const left: Cell[] = []
    const { kit } = probe()
    cityGrid(kit, { ...BASE, cars: undefined, fill: (c) => built.push(c), open: (c) => left.push(c) })
    expect(left).toHaveLength(0)
    expect(built.length).toBeGreaterThan(20)
  })

  it('asks the density per block, so the ground can open up beside the table', () => {
    const near: boolean[] = []
    const { kit } = probe()
    cityGrid(kit, {
      ...BASE,
      cars: undefined,
      density: (c) => (c.dist < 40 ? 0 : 1),
      fill: (c) => near.push(c.dist < 40),
      open: () => {},
    })
    expect(near.length).toBeGreaterThan(0)
    expect(near.every((n) => !n)).toBe(true)
  })

  it('every room asks for one, and a small crowd', () => {
    // The numbers that turned six loud rooms into six quiet ones. A room
    // that fills every block again, or stands twenty people round the table
    // again, does it on purpose and moves these.
    for (const map of MAPS) {
      const src = readFileSync(join(process.cwd(), 'src', `components/scene/maps/${map}.ts`), 'utf8')
      expect(src, `${map} fills every block`).toMatch(/density:/)
      const crowd = src.match(/crowd\(k,\s*(\d+)/)
      expect(crowd, `${map} has no crowd`).not.toBeNull()
      expect(Number(crowd![1]), `${map} stands a crowd of ${crowd![1]} round the table`).toBeLessThanOrEqual(8)
      const people = src.match(/people:\s*([\d.]+)/)
      if (people) expect(Number(people[1]), `${map} scatters ${people[1]} people a block`).toBeLessThanOrEqual(0.5)
    }
  })

  it('no room walks anybody in circles: a person on the move is a pass with a heading', () => {
    // A stroller round the table was a sprite facing one diagonal walked
    // along a ring, sideways up the frame and back the way it came at the
    // turn — "people walking backwards". What is left walks a pavement one
    // way and is gone.
    const actors = readFileSync(join(process.cwd(), 'src', 'components/scene/maps/actors.ts'), 'utf8')
    expect(actors).not.toMatch(/export function (strollers|pacers)\(/)
    for (const map of MAPS) {
      const src = readFileSync(join(process.cwd(), 'src', `components/scene/maps/${map}.ts`), 'utf8')
      expect(src, `${map} walks somebody there and back`).not.toMatch(/walker\([^)]*motion:\s*'bounce'/)
    }
  })
})
