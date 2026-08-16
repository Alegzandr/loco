/**
 * Every glyph a player sees is one this repository drew.
 *
 * The rule is already written down in three places (`CLAUDE.md`: "drawn SVG,
 * never a font character"; `RulesModal.svelte` and `Preferences.svelte` on the
 * ✕ they share), and six places broke it anyway: the game-over card headed
 * itself with a nested ternary of 🏆 / 😔 / 🏳️ / 🚪, the round summary carried a
 * second trophy, the audio chip was 🔇/🔊 beside a drawn gear, a disconnected
 * seat appended `✗` to its own nickname, and the two pickers closed on a `✕`
 * character while every other panel in the game closed on a path.
 *
 * What that costs is not tidiness. An emoji is drawn by the reader's OS, so it
 * arrives at a weight and a hue nothing here chose, in full colour on Windows
 * and flat on Android, and it cannot be given the ink outline and hard bottom
 * shadow that make every other raised object in this UI read as a physical
 * thing. On the game-over screen, the one frame most likely to be clipped for
 * a stream, the mark was the only part nobody here had drawn.
 *
 * A rule about what renders is kept by a test or it is not kept. Same shape as
 * `vocabulary.test.ts` and `legal.test.ts`, and the same scope: player-facing
 * surfaces only. The audio tracks keep their `♯` and `♭`, which are comments
 * about music theory, and nobody reads them off a screen.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const SRC = join(process.cwd(), 'src')

/**
 * Emoji, dingbats and the arrows-and-symbols block, plus U+FE0F on its own.
 *
 * U+FE0F is the variation selector: the invisible codepoint that turns an
 * otherwise textual character into a colour emoji, and the reason the white flag
 * rendered as three different things on three platforms. It is matched as an
 * alternative rather than inside the class because a combining mark in a
 * character class is its own bug (`no-misleading-character-class`): the class
 * would be reading it as a member instead of as the modifier it is.
 */
const GLYPH =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}]|\u{FE0F}/u

/** Surfaces a player reads. Not `audio/`, not `dev/`, not `test/`. */
const SCANNED = /\.(svelte|astro)$/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'test' || name === 'dev') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      walk(full, out)
      continue
    }
    if (SCANNED.test(name)) out.push(full)
  }
  return out
}

/**
 * What is left once the parts nobody renders are gone: HTML comments, `<style>`
 * blocks, block comments and line comments. A `//` inside a URL is left alone,
 * because cutting there would hide the tail of a real string.
 */
function renderedText(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('every glyph a player sees is drawn', () => {
  it('renders no emoji or dingbat character in any component or page', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const lines = renderedText(readFileSync(file, 'utf8')).split('\n')
      lines.forEach((line, i) => {
        const hit = line.match(GLYPH)
        if (hit) {
          offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}  ${hit[0]}  ${line.trim()}`)
        }
      })
    }
    expect(offenders, `draw these instead:\n${offenders.join('\n')}`).toEqual([])
  })

  it('keeps the copy itself clear of them too', async () => {
    const { en } = await import('../i18n/en')
    const { fr } = await import('../i18n/fr')
    const walkStrings = (v: unknown, at = ''): { at: string; text: string }[] => {
      if (typeof v === 'string') return [{ at, text: v }]
      if (Array.isArray(v)) return v.flatMap((x, i) => walkStrings(x, `${at}[${i}]`))
      if (v && typeof v === 'object') {
        return Object.entries(v).flatMap(([k, x]) => walkStrings(x, at ? `${at}.${k}` : k))
      }
      return []
    }
    const offenders = [...walkStrings(en, 'en'), ...walkStrings(fr, 'fr')]
      .filter((s) => GLYPH.test(s.text))
      .map((s) => `${s.at}: ${s.text}`)
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
