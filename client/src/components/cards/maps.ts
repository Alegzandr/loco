/**
 * Map registry: the room a match is played in.
 *
 * A map is three things: a backdrop, a table, and an accent colour. It touches
 * no rule and no card. The *choice* is the server's (see server/game/maps.go),
 * so every seat at one table plays in one room; this file only says what each
 * id looks like.
 *
 * Deliberately not themed. The room does not follow light/dark like the rest of
 * the UI, for the same reason a card face does not: it is a place, not a
 * surface, and the same place in two colour schemes is two places.
 */

export type MapId = 'neon' | 'rune' | 'velvet' | 'orbit'

/**
 * Where the table's *playing surface* sits inside `table.webp`, as fractions of
 * the file.
 *
 * The board's whole geometry (the pile positions, the direction ring, the
 * felt's centre) is expressed against `tableRect()`, an axis-aligned ellipse in
 * board space. A map's table is a photograph of an object seen at an angle, and
 * its playing surface is neither centred in the file nor the same shape as the
 * file. This rectangle is the bridge: it names the sub-box of the image that the
 * board's ellipse has to land on, so `tableImageRect()` can solve for where to
 * draw the picture. Four numbers per map, measured off the art once.
 *
 * Get these wrong and nothing crashes: the cards simply stop sitting on the
 * table, and the direction chevrons drift off the felt onto the rim.
 */
export interface Playfield {
  /** Left edge of the playing surface, 0–1 of the image width. */
  x: number
  /** Top edge, 0–1 of the image height. */
  y: number
  /** Width of the playing surface, 0–1 of the image width. */
  w: number
  /** Height, 0–1 of the image height. */
  h: number
}

export interface MapDef {
  id: MapId
  /** The room behind the table. Fills the board, cropped to cover. */
  room: string
  /** The table itself, cut out against transparency. */
  table: string
  playfield: Playfield
  /**
   * The map's colour, used for the light the room casts on the board: the glow
   * pooled under the table, the ambient wash at the edges, and the direction
   * ring's chevrons.
   *
   * It deliberately does NOT reach the brand: the "your turn" pill, the active
   * seat's gold and the card faces are the same in every room. Those are what a
   * viewer reads the game state off, and a state cue that changes colour with
   * the scenery is a cue that has to be re-learned four times.
   */
  accent: string
  /** A dimmer companion to `accent`, for the wide low-opacity washes. */
  accentDeep: string
}

export const MAPS: Record<MapId, MapDef> = {
  neon: {
    id: 'neon',
    room: '/maps/neon/room.webp',
    table: '/maps/neon/table.webp',
    playfield: { x: 0.045, y: 0.252, w: 0.855, h: 0.442 },
    accent: '#c56bff',
    accentDeep: '#5a1e9c',
  },
  rune: {
    id: 'rune',
    room: '/maps/rune/room.webp',
    table: '/maps/rune/table.webp',
    playfield: { x: 0.125, y: 0.252, w: 0.76, h: 0.408 },
    accent: '#ffab52',
    accentDeep: '#6d3410',
  },
  velvet: {
    id: 'velvet',
    room: '/maps/velvet/room.webp',
    table: '/maps/velvet/table.webp',
    playfield: { x: 0.105, y: 0.325, w: 0.79, h: 0.31 },
    accent: '#f0c46a',
    accentDeep: '#5e3a12',
  },
  orbit: {
    id: 'orbit',
    room: '/maps/orbit/room.webp',
    table: '/maps/orbit/table.webp',
    playfield: { x: 0.135, y: 0.295, w: 0.74, h: 0.325 },
    accent: '#4fd6ff',
    accentDeep: '#123a63',
  },
}

export const MAP_IDS = Object.keys(MAPS) as MapId[]

/**
 * Resolves a wire `map_id` to its definition, or null.
 *
 * Null is a first-class answer, not a failure: a lobby has no map yet, and a
 * server that ships a new one before the client has its art must degrade to the
 * built-in felt rather than to a blank table.
 */
export function resolveMap(id: string | null | undefined): MapDef | null {
  if (!id) return null
  return MAPS[id as MapId] ?? null
}

/**
 * The two files a map needs before its table can be shown.
 *
 * Ordered table-first: it is the object the cards land on, and the one whose
 * absence would be read as a bug rather than as a plain background.
 */
export function mapAssets(map: MapDef): string[] {
  return [map.table, map.room]
}
