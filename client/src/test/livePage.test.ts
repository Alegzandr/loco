import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { LIVE, NAV, PAGES } from '../seo/meta'
import { LIVE_PATH } from '../lang'
import { UI } from '../content/ui'

const CLIENT = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(CLIENT, p), 'utf8')

const article = read('src/content/LiveArticle.svelte')
const list = read('src/content/liveList.ts')

/**
 * The file with its comments taken out.
 *
 * Needed because the prose in these files names the very things the rules
 * forbid — the header of `liveList.ts` explains why nothing there is built with
 * innerHTML — and a scan that could not tell the two apart would be a rule
 * nobody can document. Same treatment `vocabulary.test.ts` gives its own scan.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the live page', () => {
  it('is in the registry and in the navigation', () => {
    expect(PAGES).toContain(LIVE)
    expect(NAV).toContain(LIVE)
  })

  // The game links to this page from the home screen's strip, and it does it
  // through two constants rather than by importing the whole registry — which
  // carries every page's copy and is read at build time by markup no player
  // downloads. Pinned here so the copy cannot drift from the page the build emits.
  it('is where the game thinks it is', () => {
    expect(LIVE_PATH.en).toBe(LIVE.path.en)
    expect(LIVE_PATH.fr).toBe(LIVE.path.fr)
  })

  // The page is prerendered, and its prose has to be in the served HTML for a
  // reader with no script and a crawler alike. What the browser adds is the
  // list, and only the list: the one piece of state is the rows, the one thing
  // drawn from them is under `#each rows`, and nothing is raw HTML.
  it('renders its prose on the server, and only the list in the browser', () => {
    const markup = article.slice(article.indexOf('</script>'))
    expect(markup).not.toMatch(/<script|\{@html/)
    const state = [...article.matchAll(new RegExp('\\$' + 'state', 'g'))]
    expect(state, 'the rows are the only state').toHaveLength(1)
    expect(article).toMatch(/let rows = /)
    expect(markup).toMatch(/\{#each rows as row/)
    // The prose is outside every block that waits on the browser.
    for (const key of ['liveWhyH2', 'liveHowH2', 'liveListedH2']) {
      expect(markup.indexOf(`ui('${key}', lang)`), key).toBeGreaterThan(markup.indexOf('{/each}'))
    }
  })

  // The paragraph that stands in for the list is *served*, not written by the
  // script, and it answers two readers at once: somebody arriving on a quiet
  // evening, and somebody whose browser runs no scripts. Neither is ever shown
  // the word "loading" — a page that says it is loading and then never loads is
  // worse than one that explains itself.
  it('serves the sentence that stands in for an empty list', () => {
    expect(article).toContain("ui('liveNowNote', lang)")
    expect(article).toContain('class="liveNote"')
    // The list itself is hidden until there are rows, and the sentence after.
    expect(article).toMatch(/class="liveList" hidden=\{rows\.length === 0\}/)
    expect(article).toMatch(/class="liveNote" hidden=\{rows\.length > 0\}/)
    for (const lang of ['en', 'fr'] as const) {
      expect(UI.liveNowNote[lang].toLowerCase()).not.toMatch(/loading|chargement/)
    }
  })

  // Every one of these names was written by a stranger. They are rendered as
  // Svelte text and attributes, escaped by construction, and nothing anywhere
  // builds markup out of them.
  it('builds the list without markup from a string', () => {
    expect(code(list)).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
    expect(article.slice(article.indexOf('</script>'))).not.toMatch(/\{@html/)
    expect(article).toMatch(/<span class="liveName">\{row\.name\}<\/span>/)
  })

  // Same origin, which is what leaves connect-src alone, and a preview that is
  // not a path on this origin is not drawn at all.
  it('fetches from this origin and draws previews from it', () => {
    expect(list).toContain("fetch('/live.json'")
    expect(list).not.toMatch(/fetch\(\s*['"`]https?:/)
    expect(list).toContain("startsWith('/live-thumb/')")
  })

  // Asked for once, by the article on mount, and only on this page: the
  // module is the article's import and nobody else's.
  it('is asked for by this page alone', () => {
    expect(article).toMatch(/onMount\(\(\) => \{[\s\S]{0,80}fetchLiveRows\(\)/)
  })

  // The category link is the one thing on this page that leaves for Twitch, and
  // it is assembled in the single module allowed to name that host.
  it('links out through the one module that names the host', () => {
    expect(article).toContain('twitchCategory()')
    expect(code(article)).not.toMatch(/https?:\/\//)
    expect(article).toContain('EXTERNAL_REL')
  })
})
