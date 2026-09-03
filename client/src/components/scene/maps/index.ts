/**
 * One builder per map id, and the model kits each room is built from.
 * `render.ts` looks the id up here, so a map that exists in `cards/maps.ts`
 * without a builder is a type error rather than a blank room; `sceneCache`
 * loads the kits before the builder runs, so every `k.model` it asks for is
 * there or is known to be missing.
 */
import type { MapId } from '../../cards/maps'
import type { Builder } from './common'
import type { KitName } from '../models/lib'
import { neon } from './neon'
import { rune } from './rune'
import { velvet } from './velvet'
import { orbit } from './orbit'
import { sakura } from './sakura'
import { marina } from './marina'

export const BUILDERS: Record<MapId, Builder> = { neon, rune, velvet, orbit, sakura, marina }

export const KITS: Record<MapId, readonly KitName[]> = {
  marina: ['pirate', 'suburb', 'city', 'roads', 'nature', 'cars', 'people'],
  neon: ['city', 'roads', 'cars', 'people', 'nature'],
  velvet: ['city', 'suburb', 'roads', 'cars', 'people', 'nature'],
  rune: ['fantasy', 'nature', 'people', 'holiday'],
  sakura: ['quaternius', 'nature', 'fantasy', 'people', 'holiday'],
  orbit: ['space', 'people'],
}
