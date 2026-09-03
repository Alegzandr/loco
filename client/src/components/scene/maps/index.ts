/**
 * One builder per map id. `render.ts` looks the id up here, so a map that
 * exists in `cards/maps.ts` without a builder is a type error rather than a
 * blank room.
 */
import type { MapId } from '../../cards/maps'
import type { Builder } from './common'
import { neon } from './neon'
import { rune } from './rune'
import { velvet } from './velvet'
import { orbit } from './orbit'
import { sakura } from './sakura'
import { marina } from './marina'

export const BUILDERS: Record<MapId, Builder> = { neon, rune, velvet, orbit, sakura, marina }
