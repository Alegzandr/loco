/**
 * Map registry: the room a match is played in.
 *
 * A map is a scene, a table and an accent colour. It touches no rule and no
 * card. The *choice* is the server's (see server/game/maps.go), so every seat at
 * one table plays in one room; this file only says what each id looks like.
 *
 * Nothing here is a picture. The scene is rendered in the browser by the
 * isometric engine in `components/scene/` from the three ids the server deals
 * (`map_id`, `time_of_day`, `weather`), and the table is drawn in CSS by
 * `GameBoard.svelte` from the materials named below. A map used to be two
 * photographs and a rectangle measured off them; what replaced that is a place
 * that has an hour and a sky, and a table whose felt and rim belong to it.
 *
 * Deliberately not themed. The room does not follow light/dark like the rest of
 * the UI, for the same reason a card face does not: it is a place, not a
 * surface, and the same place in two colour schemes is two places.
 */
import { TIMES, WEATHERS, isTime, isWeather, type TimeOfDay, type Weather } from '../scene/sky'

export type MapId = 'neon' | 'rune' | 'velvet' | 'orbit' | 'sakura' | 'marina'

/**
 * What the CSS table is made of, per room. Every value is a CSS colour.
 *
 * `felt` and `feltDeep` are the playing surface's gradient, `rim` the material
 * of the edge, `rimLight` the sheen it catches, `base` the plinth under it,
 * `inlay` the thin line set into the rim (a neon tube, a brass bead, a rune
 * groove). The hour tints the sheen (`--scene-tint`) and dims the whole object
 * (`--scene-dark`); the materials themselves never change with it, because a
 * table is a physical thing and night does not repaint it.
 */
export interface TableMaterials {
  felt: string
  feltDeep: string
  rim: string
  rimLight: string
  base: string
  inlay: string
}

export interface MapDef {
  id: MapId
  table: TableMaterials
  /**
   * The map's colour, used for the light the room casts on the board: the glow
   * pooled under the table, the ambient wash at the edges, and the direction
   * ring's chevrons.
   *
   * It deliberately does NOT reach the brand: the "your turn" pill, the active
   * seat's gold and the card faces are the same in every room. Those are what a
   * viewer reads the game state off, and a state cue that changes colour with
   * the scenery is a cue that has to be re-learned six times.
   */
  accent: string
  /** A dimmer companion to `accent`, for the wide low-opacity washes. */
  accentDeep: string
  /**
   * Nothing falls from this sky: a storm here is light and dust, never rain.
   * The overlay reads it; the server's weather list is unchanged by it.
   */
  dry?: boolean
  /**
   * The skies this room can be dealt under. A mirror of `game.MapWeathers`,
   * pinned to it by `maps.test.ts`: the server draws from its list, and this one
   * says which the client can draw, so the two must agree.
   */
  weathers: readonly Weather[]
}

export const MAPS: Record<MapId, MapDef> = {
  neon: {
    id: 'neon',
    table: {
      felt: '#1a1530',
      feltDeep: '#0a0816',
      rim: '#15121f',
      rimLight: '#6b4fb8',
      base: '#0b0912',
      inlay: '#c56bff',
    },
    accent: '#c56bff',
    accentDeep: '#5a1e9c',
    weathers: ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'],
  },
  rune: {
    id: 'rune',
    table: {
      felt: '#2b3a2e',
      feltDeep: '#121b15',
      rim: '#4a2e17',
      rimLight: '#a8713a',
      base: '#2c1a0c',
      inlay: '#ffab52',
    },
    accent: '#ffab52',
    accentDeep: '#6d3410',
    weathers: ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'],
  },
  velvet: {
    id: 'velvet',
    table: {
      felt: '#5a1424',
      feltDeep: '#2a0810',
      rim: '#3a2410',
      rimLight: '#e0b45a',
      base: '#1f1408',
      inlay: '#f0c46a',
    },
    accent: '#f0c46a',
    accentDeep: '#5e3a12',
    weathers: ['clear', 'cloudy', 'rain', 'snow', 'fog'],
  },
  orbit: {
    id: 'orbit',
    table: {
      felt: '#0e2a3a',
      feltDeep: '#061420',
      rim: '#5c6672',
      rimLight: '#c9d3dd',
      base: '#2b3239',
      inlay: '#4fd6ff',
    },
    accent: '#4fd6ff',
    accentDeep: '#123a63',
    dry: true,
    weathers: ['clear', 'fog', 'storm'],
  },
  sakura: {
    id: 'sakura',
    table: {
      felt: '#1f3a2a',
      feltDeep: '#0d1c14',
      rim: '#7a1f1f',
      rimLight: '#d94c4c',
      base: '#3a0e0e',
      inlay: '#ffb7d0',
    },
    accent: '#ff8fb8',
    accentDeep: '#7a2a4a',
    weathers: ['clear', 'cloudy', 'rain', 'snow', 'fog'],
  },
  marina: {
    id: 'marina',
    table: {
      felt: '#12304a',
      feltDeep: '#081726',
      rim: '#6e5232',
      rimLight: '#c9a06a',
      base: '#3a2a18',
      inlay: '#ffd166',
    },
    accent: '#5fc8ff',
    accentDeep: '#153f5e',
    weathers: ['clear', 'cloudy', 'rain', 'storm', 'fog'],
  },
}

export const MAP_IDS = Object.keys(MAPS) as MapId[]

/**
 * Resolves a wire `map_id` to its definition, or null.
 *
 * Null is a first-class answer, not a failure: a lobby has no map yet, and a
 * server that ships a new one before the client has its scene must degrade to
 * the built-in felt rather than to a blank table.
 */
export function resolveMap(id: string | null | undefined): MapDef | null {
  if (!id) return null
  return MAPS[id as MapId] ?? null
}

/** A room at an hour under a sky: everything the renderer is handed. */
export interface SceneSpec {
  map: MapDef
  time: TimeOfDay
  weather: Weather
}

/**
 * The three wire ids as one scene, or null for a map this client has no scene
 * for. The hour and the sky degrade one at a time rather than taking the scene
 * with them: a weather this build does not know, or one the map does not list,
 * is dealt clear, and an unknown hour is dealt in daylight. A reload must never
 * lose the room over a word.
 */
export function resolveScene(
  mapId: string | null | undefined,
  time: string | null | undefined,
  weather: string | null | undefined,
): SceneSpec | null {
  const map = resolveMap(mapId)
  if (!map) return null
  const t: TimeOfDay = isTime(time) ? time : 'day'
  const w: Weather = isWeather(weather) && map.weathers.includes(weather) ? weather : 'clear'
  return { map, time: t, weather: w }
}

/** One string per distinct scene: the render cache's key and the builders' seed. */
export function sceneKey(spec: SceneSpec): string {
  return `${spec.map.id}:${spec.time}:${spec.weather}`
}

export { TIMES, WEATHERS }
export type { TimeOfDay, Weather }
