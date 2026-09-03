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
import { PAGES, SITE_NAME } from '../seo/meta'
import { fr } from '../i18n/fr'
import { en } from '../i18n/en'

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

/**
 * The name carries its own exclamation mark, always.
 *
 * `LOCO!` is the mark; `LOCO` on its own is a Spanish adjective and the name of
 * a dozen other card games, which is exactly the problem it was chosen to solve
 * — a category nobody can search for is a category nobody finds. So the mark is
 * written whole everywhere a player reads it: the wordmark, every `<title>`, the
 * prose, and the call itself.
 *
 * **In French it stays glued.** The exclamation is part of the name and not the
 * punctuation of the sentence around it, so the no-break space French would
 * normally put in front of an exclamation mark spells the name wrong - the same
 * reason nobody has ever written `Yahoo` with a space before its own mark.
 * `fr.ts` used to carry that spelling on six strings, and they are the ones this
 * guard would catch first if they came back.
 *
 * Internal naming is untouched, as it is for the rule above: `LOCO_MARK_PATH`,
 * `LOCO_ALLOWED_ORIGINS`, `LOCO Red`, `locoMark.ts`. This is a rule about copy.
 */
describe('the name is LOCO!, and the mark is part of it', () => {
  /**
   * `LOCO` with no `!` behind it. The lookahead is what lets `Contre-LOCO!` and
   * `LOCO!,` through while still catching a bare `LOCO` mid-sentence.
   */
  const BARE = /LOCO(?!!)/

  /**
   * The spacing this name must never be written with. `\s` already covers the
   * no-break and narrow-no-break spaces French would reach for here (U+00A0 and
   * U+202F are both whitespace to a JS regex), so this needs no character class
   * of its own - and writing one meant pasting invisible characters into a
   * source file, which `no-irregular-whitespace` refuses on sight.
   */
  const SPACED = /LOCO\s+!/

  const offendersIn = (value: unknown, prefix: string) =>
    strings(value)
      .filter((s) => BARE.test(s.text) || SPACED.test(s.text))
      .map((s) => `${prefix}.${s.at}: ${s.text}`)

  it('is written whole in the game’s own copy, in both languages', () => {
    for (const [prefix, copy] of [
      ['en', en],
      ['fr', fr],
    ] as const) {
      const offenders = offendersIn(copy, prefix)
      expect(offenders, offenders.join('\n')).toEqual([])
    }
  })

  it('is written whole on the content pages', () => {
    const offenders = offendersIn(UI, 'UI')
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('is written whole in every title and description a search result shows', () => {
    // The one place the cost of the extra character is real: a `<title>` is
    // capped at 60 and `seo.test.ts` holds that line, so a name that grows has
    // to be paid for in the copy rather than by letting a title be truncated.
    const offenders = offendersIn(PAGES, 'PAGES')
    expect(offenders, offenders.join('\n')).toEqual([])
    expect(SITE_NAME).toBe('LOCO!')
  })

  it('is written whole in the prose the content pages ship', () => {
    const offenders: string[] = []
    for (const file of walk(CONTENT)) {
      const src = readFileSync(file, 'utf8')
      for (const [i, line] of src.split('\n').entries()) {
        // Same exception as the guard above: a comment has to be able to explain
        // the rule, which means naming the thing it bans.
        const code = line.replace(/\/\/.*/, '').replace(/^\s*\*.*/, '')
        if (BARE.test(code) || SPACED.test(code)) {
          offenders.push(`${file.slice(CONTENT.length + 1)}:${i + 1}: ${line.trim()}`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('is what the wordmark says, in the markup and in the outline repaint', () => {
    // `a11y.test.ts` owns why the outline is painted by a pseudo-element;
    // this owns what it spells. The outline and the span both carry the mark,
    // so a rename that reaches only the markup fails here.
    const logo = readFileSync(join(process.cwd(), 'src', 'components', 'LocoLogo.svelte'), 'utf8')
    expect(logo).toContain('aria-label="LOCO!"')
    expect(logo).toContain('>LOCO!</span>')
    expect(logo.match(/content: 'LOCO!' \/ ''/g) ?? []).toHaveLength(1)
  })
})
