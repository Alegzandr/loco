/**
 * The rooms page shows the rooms, and the two lists behind it are one.
 *
 * A content page ships no script, so the room it shows is a still `make rooms`
 * shot of the render (`tools/rooms/shoot.mjs`) and committed. Two things about
 * that fail silently: a room with no still falls back to its sky, and the page
 * still builds; and the hour the still was shot at is written twice — in the
 * `room-still-*` scenes the tool opens, and in `SIGNATURE`, which paints the
 * sky behind the still and names the hour beside the room — so the two can
 * disagree without anything noticing.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { MAP_IDS } from '../components/cards/maps'

const CLIENT = path.resolve(__dirname, '..', '..')
const read = (p: string) => readFileSync(path.join(CLIENT, 'src', p), 'utf8')

/** `id → hour` off a `['id', 'hour']` list in a source file. */
function pairs(src: string, from: number, to: number): Record<string, string> {
  const block = src.slice(from, to)
  return Object.fromEntries([...block.matchAll(/(\w+):\s*'(dawn|day|dusk|night)'|\['(\w+)', '(dawn|day|dusk|night)'\]/g)].map((m) => [m[1] ?? m[3], m[2] ?? m[4]]))
}

describe('the rooms page', () => {
  it('has a still for every room the game can deal', () => {
    const missing = MAP_IDS.filter((id) => !existsSync(path.join(CLIENT, 'src', 'assets', 'rooms', `${id}.webp`)))
    expect(missing, 'run `make rooms` and commit the result').toEqual([])
  })

  it('shoots each still at the hour the page says it was shot at', () => {
    const article = read('content/TablesArticle.astro')
    const scenes = read('dev/scenes.ts')
    const sig = pairs(article, article.indexOf('SIGNATURE: Record'), article.indexOf('}', article.indexOf('SIGNATURE: Record')))
    const shot = pairs(scenes, scenes.indexOf('The stills the rooms page'), scenes.indexOf('as const', scenes.indexOf('The stills the rooms page')))
    // Both lists know every room, and agree on the hour of each.
    expect(Object.keys(sig).sort()).toEqual([...MAP_IDS].sort())
    expect(shot).toEqual(sig)
  })

  it('lays the board\'s table over the still, and no plinth', () => {
    // The render carries the podium under exactly the ellipse the CSS table
    // draws (`src/dev/RoomStill.svelte`); a CSS plinth under a rendered drum
    // would be two bases for one table.
    const article = read('content/TablesArticle.astro')
    expect(article).toMatch(/class="roomStill"/)
    expect(article).toMatch(/class="roomTable"/)
    expect(article).not.toMatch(/roomPlinth/)
    const still = read('dev/RoomStill.svelte')
    expect(still).toMatch(/rx: size\.current\.width \* 0\.35/)
    expect(still).toMatch(/ry: size\.current\.height \* 0\.25/)
    const css = read('content/content.css')
    const table = css.match(/\.roomTable \{[^}]*\}/)?.[0]
    expect(table).toMatch(/left: 15%/)
    expect(table).toMatch(/top: 25%/)
    expect(table).toMatch(/width: 70%/)
    expect(table).toMatch(/height: 50%/)
  })
})
