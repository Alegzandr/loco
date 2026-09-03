import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { LIVE, NAV, PAGES } from '../seo/meta'
import { LIVE_PATH } from '../lang'
import { UI } from '../content/ui'

const CLIENT = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(CLIENT, p), 'utf8')

const article = read('src/content/LiveArticle.astro')
const list = read('src/content/liveList.ts')
const boot = read('src/content/page-boot.ts')

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
  // downloads. Pinned here so the copy cannot drift from the page Astro emits.
  it('is where the game thinks it is', () => {
    expect(LIVE_PATH.en).toBe(LIVE.path.en)
    expect(LIVE_PATH.fr).toBe(LIVE.path.fr)
  })

  // A content page mounts nothing. The list is filled by the one script these
  // pages already load, so this article is markup like every other one.
  it('ships no island and no inline script', () => {
    expect(article).not.toMatch(/client:(load|idle|visible|media|only)/)
    expect(article).not.toMatch(/is:inline/)
  })

  // The paragraph that stands in for the list is *served*, not written by the
  // script, and it answers two readers at once: somebody arriving on a quiet
  // evening, and somebody whose browser runs no scripts. Neither is ever shown
  // the word "loading" — a page that says it is loading and then never loads is
  // worse than one that explains itself.
  it('serves the sentence that stands in for an empty list', () => {
    expect(article).toContain("ui('liveNowNote', lang)")
    expect(article).toContain('class="liveNote"')
    // The list itself starts hidden and is revealed only once there are rows.
    expect(article).toMatch(/class="liveList"[^>]*hidden/)
    for (const lang of ['en', 'fr'] as const) {
      expect(UI.liveNowNote[lang].toLowerCase()).not.toMatch(/loading|chargement/)
    }
  })

  // Every one of these names was written by a stranger. textContent is the
  // whole construction, and this is the assertion that keeps it that way.
  it('builds the list without innerHTML', () => {
    expect(code(list)).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
    expect(list).toContain('createElement')
    expect(list).toContain('textContent')
  })

  // Same origin, which is what leaves connect-src alone, and a preview that is
  // not a path on this origin is not drawn at all.
  it('fetches from this origin and draws previews from it', () => {
    expect(list).toContain("fetch('/live.json'")
    expect(list).not.toMatch(/fetch\(\s*['"`]https?:/)
    expect(list).toContain("startsWith('/live-thumb/')")
  })

  // One script on these pages, still. The list is a few more lines in it rather
  // than a second request, which is the rule page-boot.ts states about itself.
  it('is wired from the one script a content page loads', () => {
    expect(boot).toContain('fillLiveList')
    // And it is a no-op everywhere else: the guard is in the module, so every
    // other page pays a function call and nothing more.
    expect(list).toContain("getElementById('liveNow')")
  })

  // The category link is the one thing on this page that leaves for Twitch, and
  // it is assembled in the single module allowed to name that host.
  it('links out through the one module that names the host', () => {
    expect(article).toContain('twitchCategory()')
    expect(code(article)).not.toMatch(/https?:\/\//)
    expect(article).toContain('EXTERNAL_REL')
  })
})
