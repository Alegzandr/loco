import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  MAPS,
  MAP_IDS,
  TIMES,
  WEATHERS,
  resolveMap,
  resolveScene,
  sceneKey,
  type MapId,
} from '../components/cards/maps'
import { lightRig, rigCssVars, isTime, isWeather, mix, scale, desaturate, hexCss } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'
import { tableRect } from '../components/cards/layout'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'

const REPO = path.resolve(__dirname, '..', '..', '..')
const mapsGo = readFileSync(path.join(REPO, 'server', 'game', 'maps.go'), 'utf8')

/**
 * The Go constants of one string type, in the order its All-slice lists them.
 * `var MapIDs = []MapID{MapNeon, ...}` names constants; `MapNeon MapID = "neon"`
 * gives each its value.
 */
function goList(sliceName: string, typeName: string): string[] {
  const slice = mapsGo.match(new RegExp(`var ${sliceName} = \\[\\]${typeName}\\{([^}]+)\\}`))
  expect(slice, `${sliceName} not found in server/game/maps.go`).toBeTruthy()
  return slice![1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => {
      const val = mapsGo.match(new RegExp(`${name}\\s+${typeName} = "([a-z]+)"`))
      expect(val, `${name} has no value in maps.go`).toBeTruthy()
      return val![1]
    })
}

/** `MapWeathers` off the Go source, id → weathers. */
function goMapWeathers(): Record<string, string[]> {
  const block = mapsGo.match(/var MapWeathers = map\[MapID\]\[\]Weather\{([\s\S]+?)\n\}/)
  expect(block, 'MapWeathers not found in server/game/maps.go').toBeTruthy()
  const out: Record<string, string[]> = {}
  for (const line of block![1].split('\n')) {
    const m = line.match(/(Map[A-Z][a-z]+):\s*\{([^}]+)\}/)
    if (!m) continue
    const id = mapsGo.match(new RegExp(`${m[1]}\\s+MapID = "([a-z]+)"`))![1]
    out[id] = m[2].split(',').map((w) => mapsGo.match(new RegExp(`${w.trim()}\\s+Weather = "([a-z]+)"`))![1])
  }
  return out
}

describe('map registry', () => {
  // The server draws from its lists and the client renders from its own. A map,
  // an hour or a sky on one side and not the other is a match dealt into a room
  // this client cannot draw — and it fails as a plain felt, silently.
  it('lists the same maps, hours and skies as the server, in the same order', () => {
    expect(MAP_IDS).toEqual(goList('MapIDs', 'MapID'))
    expect([...TIMES]).toEqual(goList('TimesOfDay', 'TimeOfDay'))
    expect([...WEATHERS]).toEqual(goList('Weathers', 'Weather'))
  })

  it('allows each map exactly the skies the server can deal it', () => {
    const server = goMapWeathers()
    for (const id of MAP_IDS) {
      expect([...MAPS[id].weathers], id).toEqual(server[id])
    }
  })

  it('names every material of every table as a CSS colour', () => {
    for (const id of MAP_IDS) {
      const m = MAPS[id]
      expect(m.id).toBe(id)
      for (const [name, value] of Object.entries(m.table)) {
        expect(value, `${id}.table.${name}`).toMatch(/^#[0-9a-f]{6}$/)
      }
      expect(m.accent).toMatch(/^#[0-9a-f]{6}$/)
      expect(m.accentDeep).toMatch(/^#[0-9a-f]{6}$/)
      expect(m.weathers.length).toBeGreaterThan(0)
      expect(m.weathers).toContain('clear')
    }
  })

  it('resolves known ids and falls back to null for everything else', () => {
    expect(resolveMap('neon')).toBe(MAPS.neon)
    // A lobby, a map this build has no scene for, a malformed payload: all mean
    // "use the built-in felt", never "crash" and never "blank table".
    expect(resolveMap('')).toBeNull()
    expect(resolveMap(null)).toBeNull()
    expect(resolveMap(undefined)).toBeNull()
    expect(resolveMap('atlantis')).toBeNull()
    expect(resolveMap('NEON')).toBeNull()
  })

  // The hour and the sky degrade one at a time, never the room with them: a
  // reload must not lose the whole scene over a word this build does not know.
  it('resolves a scene, defaulting the hour and the sky rather than dropping the room', () => {
    expect(resolveScene('neon', 'night', 'rain')).toEqual({ map: MAPS.neon, time: 'night', weather: 'rain' })
    expect(resolveScene('neon', 'noon', 'rain')?.time).toBe('day')
    expect(resolveScene('neon', 'night', 'hail')?.weather).toBe('clear')
    expect(resolveScene('neon', undefined, undefined)).toEqual({ map: MAPS.neon, time: 'day', weather: 'clear' })
    // A sky the server never deals this map is treated like an unknown one.
    expect(resolveScene('orbit', 'day', 'snow')?.weather).toBe('clear')
    expect(resolveScene('atlantis', 'day', 'clear')).toBeNull()
    expect(resolveScene('', 'day', 'clear')).toBeNull()
  })

  it('keys a scene on its three ids', () => {
    expect(sceneKey({ map: MAPS.rune, time: 'dusk', weather: 'snow' })).toBe('rune:dusk:snow')
    expect(sceneKey(resolveScene('rune', 'dusk', 'snow')!)).not.toBe(sceneKey(resolveScene('rune', 'dusk', 'fog')!))
  })

  // A map with no name and no line is a loading screen with a bar and nothing
  // else, which is the version this feature exists to replace. The hour and
  // the sky are read beside the name, so they need words too.
  it('is named and described in both languages, hours and skies included', () => {
    for (const [lang, t] of [['en', en], ['fr', fr]] as const) {
      for (const id of MAP_IDS) {
        const copy = t.maps[id as MapId]
        expect(copy, `${lang}/${id}`).toBeTruthy()
        expect(copy.name.length, `${lang}/${id} name`).toBeGreaterThan(0)
        expect(copy.tagline.length, `${lang}/${id} tagline`).toBeGreaterThan(20)
      }
      for (const time of TIMES) expect(t.mapTimes[time], `${lang}/${time}`).toBeTruthy()
      for (const w of WEATHERS) expect(t.mapWeathers[w], `${lang}/${w}`).toBeTruthy()
    }
  })
})

describe('the light rig', () => {
  it('lights every hour under every sky with finite numbers', () => {
    for (const time of TIMES) {
      for (const weather of WEATHERS) {
        const rig = lightRig(time, weather)
        expect(rig.time).toBe(time)
        expect(rig.weather).toBe(weather)
        expect(rig.sun.intensity).toBeGreaterThan(0)
        expect(rig.ambient.intensity).toBeGreaterThan(0)
        expect(rig.dark).toBeGreaterThanOrEqual(0)
        expect(rig.dark).toBeLessThanOrEqual(1)
        expect(rig.windowsLit).toBeGreaterThanOrEqual(0)
        expect(rig.windowsLit).toBeLessThanOrEqual(1)
        expect(rig.tintCss).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  // The four hours have to be four moods, or a match at midnight and one at
  // noon in the same room are the same room.
  it('is darker at night than at noon, and lights the lamps after dark', () => {
    expect(lightRig('night', 'clear').dark).toBeGreaterThan(lightRig('day', 'clear').dark)
    expect(lightRig('night', 'clear').sun.intensity).toBeLessThan(lightRig('day', 'clear').sun.intensity)
    expect(lightRig('day', 'clear').lampsOn).toBe(false)
    expect(lightRig('night', 'clear').lampsOn).toBe(true)
    expect(lightRig('dusk', 'clear').lampsOn).toBe(true)
  })

  // Each sky changes something the kit reads: what settles, what soaks, what
  // veils. A weather that changed only the overlay would be a filter, not a sky.
  it('answers each sky with the flag the kit builds from', () => {
    expect(lightRig('day', 'snow').snow).toBe(true)
    expect(lightRig('day', 'clear').snow).toBe(false)
    expect(lightRig('day', 'rain').wet).toBe(true)
    expect(lightRig('day', 'storm').wet).toBe(true)
    expect(lightRig('day', 'fog').fog).not.toBeNull()
    expect(lightRig('day', 'clear').fog).toBeNull()
    expect(lightRig('day', 'storm').sun.intensity).toBeLessThan(lightRig('day', 'cloudy').sun.intensity)
    expect(lightRig('day', 'rain').lampsOn).toBe(true)
  })

  it('writes the four variables the board and the overlay read', () => {
    const css = rigCssVars(lightRig('dusk', 'clear'))
    for (const v of ['--sky-top', '--sky-horizon', '--scene-tint', '--scene-dark']) expect(css).toContain(v)
  })

  it('narrows the wire strings', () => {
    expect(isTime('dawn')).toBe(true)
    expect(isTime('Dawn')).toBe(false)
    expect(isTime(undefined)).toBe(false)
    expect(isWeather('fog')).toBe(true)
    expect(isWeather('hail')).toBe(false)
  })

  it('does colour arithmetic on plain numbers', () => {
    expect(hexCss(mix(0x000000, 0xffffff, 0.5))).toBe('#808080')
    expect(hexCss(scale(0x808080, 2))).toBe('#ffffff')
    expect(hexCss(desaturate(0xff0000, 1))).toBe('#4d4d4d')
    expect(hexCss(0x0a0b0c)).toBe('#0a0b0c')
  })
})

describe('the scene rng', () => {
  // A diorama is placed with hundreds of small decisions, and every one of them
  // has to come out the same for every seat and the same after a reload.
  it('is deterministic per seed', () => {
    const a = seededRng('rune:dusk:snow')
    const b = seededRng('rune:dusk:snow')
    const c = seededRng('rune:dusk:fog')
    const runA = Array.from({ length: 20 }, () => a.next())
    const runB = Array.from({ length: 20 }, () => b.next())
    const runC = Array.from({ length: 20 }, () => c.next())
    expect(runA).toEqual(runB)
    expect(runA).not.toEqual(runC)
    for (const v of runA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('stays inside the ranges it is asked for', () => {
    const r = seededRng(7)
    for (let i = 0; i < 200; i++) {
      const n = r.int(3, 5)
      expect(n).toBeGreaterThanOrEqual(3)
      expect(n).toBeLessThanOrEqual(5)
      const f = r.range(-2, 2)
      expect(f).toBeGreaterThanOrEqual(-2)
      expect(f).toBeLessThan(2)
      expect(['a', 'b']).toContain(r.pick(['a', 'b']))
    }
  })
})

describe('the table stays where the geometry puts it', () => {
  // The scene replaces how the table is painted and nothing else: the felt is
  // still `tableRect()`, at every size, so the piles and the ring do not move.
  it('keeps the felt a wide oval on a desktop and rounder on a phone', () => {
    const desk = tableRect(1920, 1080, 90)
    expect(desk.width / desk.height).toBeGreaterThan(1.8)
    const phone = tableRect(390, 844, 90)
    expect(phone.width / phone.height).toBeLessThan(1.3)
    expect(phone.width).toBeLessThanOrEqual(390 - 20)
  })
})
