/**
 * One word per thing.
 *
 * A **table** is the group of seats a code is shared for. A **room** — *décor*
 * in French — is one of the four places a match is dealt in. Three words used to
 * name those two objects (`table`, `pièce`, `salle`) and the site navigation
 * made it worse by sending an entry labelled "Tables" to a page about the four
 * places, so a visitor could not tell which of the two anything meant.
 *
 * The internal naming is untouched and stays untouched: `maps`, `game/maps.go`,
 * `mapPreload`, `cardTheme`. This is a rule about copy a player reads.
 *
 * Same shape as the guard in `legal.test.ts` that keeps the other game's name
 * out of every player-facing string, and for the same reason: a rule about
 * wording is kept by a test or it is not kept.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { UI } from '../content/ui'
import { PAGES } from '../seo/meta'
import { fr } from '../i18n/fr'

/**
 * The venue-booking words. All three name a place you reserve rather than a
 * table you sit at, and each of them has been used here for one of the two
 * objects at some point.
 */
const BANNED = /\b(salles?|salons?|pièces?)\b/i

const CONTENT = join(process.cwd(), 'src', 'content')

/** Every string in a nested copy object, flattened with a path to it. */
function strings(value: unknown, at = ''): { at: string; text: string }[] {
  if (typeof value === 'string') return [{ at, text: value }]
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${at}[${i}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => strings(v, at ? `${at}.${k}` : k))
  }
  return []
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      walk(full, out)
      continue
    }
    if (/\.(ts|astro)$/.test(name)) out.push(full)
  }
  return out
}

describe('a table is the seats, a room is the place', () => {
  it('keeps the venue words out of the game’s own copy', () => {
    const offenders = strings(fr)
      .filter((s) => BANNED.test(s.text))
      .map((s) => `fr.${s.at}: ${s.text}`)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('keeps them out of the content pages’ copy', () => {
    const offenders = strings(UI)
      .filter((s) => BANNED.test(s.text))
      .map((s) => `UI.${s.at}: ${s.text}`)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('keeps them out of every title and description a search result shows', () => {
    const offenders = strings(PAGES)
      .filter((s) => BANNED.test(s.text))
      .map((s) => `PAGES.${s.at}: ${s.text}`)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  // The prose under `src/content/` is the rest of what a reader meets: the FAQ
  // answers, the legal documents and the articles' own inline copy. Scanned as
  // text rather than as data, because some of it is markup.
  it('keeps them out of the prose the content pages ship', () => {
    const offenders: string[] = []
    for (const file of walk(CONTENT)) {
      const src = readFileSync(file, 'utf8')
      for (const [i, line] of src.split('\n').entries()) {
        // Comments explain the rule and have to be allowed to name the words it
        // bans; every guard of this shape in the repo makes the same exception.
        // No `$` anchors: the files are CRLF, and `.` stops before the `\r`, so
        // an anchored pattern silently matches nothing and strips no comment.
        const code = line.replace(/\/\/.*/, '').replace(/^\s*\*.*/, '')
        if (BANNED.test(code)) offenders.push(`${file.slice(CONTENT.length + 1)}:${i + 1}: ${line.trim()}`)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('names the four places with the word the menu now uses', () => {
    // The other half of the rule: having banned the synonyms, the page about the
    // four places has to actually say the word, or it says nothing at all.
    expect(UI.tablesH1.fr).toContain('décor')
    expect(UI.tablesLede.fr).toContain('décor')
    expect(UI.tablesOutro.fr).toContain('décor')
    const tables = PAGES.find((p) => p.id === 'tables')!
    expect(tables.navLabel?.fr).toContain('décor')
    expect(tables.navLabel?.en).toBe('Rooms')
    // The URL and the title keep "tables": they carry the search value, and a
    // path is not copy.
    expect(tables.path.en).toBe('/tables/')
    expect(tables.path.fr).toBe('/fr/tables/')
  })
})
