/**
 * One builder per map id, and the model kits each room is built from.
 * `render.ts` looks the id up here, so a map that exists in `cards/maps.ts`
 * without a builder is a type error rather than a blank room; `sceneCache`
 * loads the kits before the builder runs, so every `k.model` it asks for is
 * there or is known to be missing. Every room is seen from the table
 * (`view.ts`, `maps/vista.ts`).
 */
import type { MapId } from '../../cards/maps'
import type { Builder } from './vista'
import type { KitName } from '../models/lib'
import { neon } from './neon'
import { rune } from './rune'
import { velvet } from './velvet'
import { orbit } from './orbit'
import { sakura } from './sakura'
import { marina } from './marina'

export const BUILDERS: Record<MapId, Builder> = { neon, rune, velvet, orbit, sakura, marina }

/**
 * The kits each room places from. Only what `PLACED` names is fetched out of
 * them: every room used to load whole kits, most of which it never placed —
 * 17.5 MB and 205 requests for the marina, of which 7.9 MB stood in the room,
 * and the townsfolk for orbit, where a person is always an astronaut.
 */
export const KITS: Record<MapId, readonly KitName[]> = {
  // Seen from the table, a room is mostly drawn in blocks: the kits left are
  // the dinghy at the jetty, the bushes and palms, and velvet's street lamps.
  marina: ['pirate', 'nature'],
  neon: ['nature'],
  velvet: ['roads', 'nature'],
  rune: [],
  sakura: [],
  orbit: [],
}

const TOWNSFOLK = ['female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f', 'male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f']
const HOUSES = 'abcdefghijklmnopqrstu'.split('')

/**
 * Every model the kit and the builders can name, and so the only ones a room
 * fetches. `roomModels.test.ts` scans `kit.ts` and `maps/*.ts` for every id
 * they spell and fails on one missing here.
 */
export const PLACED: ReadonlySet<string> = new Set([
  ...TOWNSFOLK.map((w) => `people/character-${w}`),
  ...HOUSES.map((c) => `suburb/building-type-${c}`),
  'space/astronautA', 'space/astronautB',
  'quaternius/torii',
  'city/detail-parasol-a', 'city/detail-parasol-b',
  'roads/light-curved', 'roads/light-curved-double',
  'cars/sedan', 'cars/sedan-sports', 'cars/hatchback-sports', 'cars/suv', 'cars/suv-luxury', 'cars/van', 'cars/taxi', 'cars/delivery', 'cars/truck',
  'pirate/barrel', 'pirate/boat-row-large', 'pirate/crate', 'pirate/crate-bottles', 'pirate/palm-bend', 'pirate/rocks-a', 'pirate/rocks-b', 'pirate/rocks-c', 'pirate/ship-medium', 'pirate/ship-small',
  'nature/plant_bush', 'nature/plant_bushDetailed', 'nature/plant_bushLarge', 'nature/plant_bushSmall',
  'nature/rock_largeA', 'nature/rock_largeB', 'nature/rock_smallA', 'nature/rock_smallB', 'nature/rock_tallA', 'nature/stone_smallA',
  'nature/tree_default', 'nature/tree_detailed', 'nature/tree_fat', 'nature/tree_oak', 'nature/tree_simple', 'nature/tree_tall', 'nature/tree_plateau',
  'nature/tree_palm', 'nature/tree_palmBend', 'nature/tree_palmDetailedShort', 'nature/tree_palmDetailedTall',
  'nature/tree_pineDefaultA', 'nature/tree_pineRoundA', 'nature/tree_pineSmallA', 'nature/tree_pineTallA',
])
