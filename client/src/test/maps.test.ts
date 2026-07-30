import { describe, it, expect } from 'vitest'
import { MAPS, MAP_IDS, resolveMap, mapAssets, MapId } from '../components/cards/maps'
import { tableImageRect, tableRect } from '../components/cards/layout'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'

describe('map registry', () => {
  it('ships art paths for every registered map', () => {
    for (const id of MAP_IDS) {
      const map = MAPS[id]
      expect(map.id).toBe(id)
      expect(map.room).toMatch(/^\/maps\/[a-z]+\/room\.webp$/)
      expect(map.table).toMatch(/^\/maps\/[a-z]+\/table\.webp$/)
    }
  })

  // The registry is the only thing that says where a table's playing surface is
  // inside its picture. A playfield outside 0–1, or an inverted one, silently
  // slides the cards off the table instead of failing.
  it('keeps every playfield inside its image', () => {
    for (const id of MAP_IDS) {
      const { x, y, w, h } = MAPS[id].playfield
      expect(w).toBeGreaterThan(0)
      expect(h).toBeGreaterThan(0)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x + w).toBeLessThanOrEqual(1)
      expect(y + h).toBeLessThanOrEqual(1)
    }
  })

  // The tables are photographed at an angle, so their surface is always a wide
  // ellipse. A playfield taller than it is wide would mean a mis-measurement.
  it('measures every playing surface as a wide ellipse', () => {
    for (const id of MAP_IDS) {
      const { w, h } = MAPS[id].playfield
      expect(w).toBeGreaterThan(h)
    }
  })

  it('resolves known ids and falls back to null for everything else', () => {
    expect(resolveMap('neon')).toBe(MAPS.neon)
    // A lobby, a map this build has no art for, a malformed payload: all mean
    // "use the built-in felt", never "crash" and never "blank table".
    expect(resolveMap('')).toBeNull()
    expect(resolveMap(null)).toBeNull()
    expect(resolveMap(undefined)).toBeNull()
    expect(resolveMap('atlantis')).toBeNull()
    expect(resolveMap('NEON')).toBeNull()
  })

  it('preloads the table before the room', () => {
    // The table is the object the cards land on; a missing room is a plain
    // background, a missing table reads as a broken game.
    expect(mapAssets(MAPS.orbit)).toEqual([MAPS.orbit.table, MAPS.orbit.room])
  })

  // A map with no name and no line is a loading screen with a bar and nothing
  // else, which is the version this feature exists to replace.
  it('is named and described in both languages', () => {
    for (const id of MAP_IDS) {
      for (const [lang, t] of [['en', en], ['fr', fr]] as const) {
        const copy = t.maps[id as MapId]
        expect(copy, `${lang}/${id}`).toBeTruthy()
        expect(copy.name.length, `${lang}/${id} name`).toBeGreaterThan(0)
        expect(copy.tagline.length, `${lang}/${id} tagline`).toBeGreaterThan(20)
      }
    }
  })
})

describe('tableImageRect', () => {
  const felt = { left: 100, top: 50, width: 600, height: 300 }

  // The whole contract: the sub-box of the picture named by the playfield has
  // to land exactly on the felt, because that is the ellipse the piles, the
  // seats and the direction ring are all placed against.
  it('lands the playfield exactly on the felt', () => {
    const pf = { x: 0.125, y: 0.25, w: 0.75, h: 0.4 }
    const img = tableImageRect(felt, pf)
    expect(img.left + pf.x * img.width).toBeCloseTo(felt.left, 6)
    expect(img.top + pf.y * img.height).toBeCloseTo(felt.top, 6)
    expect(pf.w * img.width).toBeCloseTo(felt.width, 6)
    expect(pf.h * img.height).toBeCloseTo(felt.height, 6)
  })

  it('draws the picture larger than the felt and overhanging it', () => {
    const img = tableImageRect(felt, MAPS.velvet.playfield)
    expect(img.width).toBeGreaterThan(felt.width)
    expect(img.height).toBeGreaterThan(felt.height)
    expect(img.left).toBeLessThan(felt.left)
    expect(img.top).toBeLessThan(felt.top)
  })

  it('reduces to the felt itself for a full-bleed playfield', () => {
    expect(tableImageRect(felt, { x: 0, y: 0, w: 1, h: 1 })).toEqual(felt)
  })

  // Degenerate input must not divide by zero and take the whole board with it.
  it('falls back to the felt for a zero-sized playfield', () => {
    expect(tableImageRect(felt, { x: 0, y: 0, w: 0, h: 0.4 })).toEqual(felt)
    expect(tableImageRect(felt, { x: 0, y: 0, w: 0.7, h: 0 })).toEqual(felt)
  })

  // The real geometry, at both ends of the board-scale range: every map's table
  // must still cover the felt on a phone and on a 1440p monitor.
  it('covers the felt at every board size, for every map', () => {
    for (const [w, h] of [[1920, 1080], [1440, 900], [390, 844], [360, 640]]) {
      const rect = tableRect(w, h, 90)
      for (const id of MAP_IDS) {
        const img = tableImageRect(rect, MAPS[id].playfield)
        expect(img.left, `${id} @${w}x${h}`).toBeLessThanOrEqual(rect.left)
        expect(img.top, `${id} @${w}x${h}`).toBeLessThanOrEqual(rect.top)
        expect(img.left + img.width).toBeGreaterThanOrEqual(rect.left + rect.width)
        expect(img.top + img.height).toBeGreaterThanOrEqual(rect.top + rect.height)
      }
    }
  })
})
