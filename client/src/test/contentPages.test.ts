/**
 * The content pages restate things the game already knows: the rules, and what a
 * card is worth. Restating is the risk — two copies of one fact drift, and the
 * page is the copy nobody plays against, so it drifts silently and stays wrong
 * for as long as nobody reads it.
 *
 * So nothing here checks that the page "looks right". Each test pins the page to
 * the source it is a second view of: the rules to `t.rules`, which the in-game
 * modal maps, and the scoring to `server/crates/loco-game/src/card.rs`, which is the only
 * authority on points anywhere in the repo.
 *
 * That the *rendered* page carries every rule is asserted in
 * `e2e/tests/seo.spec.ts`, against the real page with JavaScript disabled, which
 * also proves it is readable by something that does not run scripts.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { CONTRASTS, HAND_SIZE, NUMBER_HIGH, NUMBER_LOW } from '../content/contrasts'
import { DECK, DECK_SIZE } from '../content/deck'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'
import type { CardKind } from '../types/protocol'
import { LANGS } from '../seo/meta'
import {
  readServer,
  serverCardValue,
  serverDeckBody,
  serverInt,
  serverKindAppends,
  serverLabel,
  serverNumberRange,
  serverNumberScoresFace,
} from './serverSource'

const CLIENT = path.resolve(__dirname, '..', '..')
const article = readFileSync(path.join(CLIENT, 'src', 'content', 'RulesArticle.svelte'), 'utf8')
/**
 * The game page, markup and document stylesheet together: under Astro they were
 * one `.astro` file with an `is:global` style; the component is markup now, and
 * the rules that style what it does not own (the app's mounted child, the
 * body) are `GamePage.css` beside it. The markup is the (game) route group's
 * layout now: the frame `/`, `/fr/` and `/i/` share.
 */
const GAME_LAYOUT = path.join(CLIENT, 'src', 'routes', '(game)', '+layout.svelte')
const CONTENT_LAYOUT = path.join(CLIENT, 'src', 'routes', '(content)', '+layout.svelte')
const gamePage = () =>
  readFileSync(GAME_LAYOUT, 'utf8') +
  '\n<style>\n' +
  readFileSync(path.join(CLIENT, 'src', 'layouts', 'GamePage.css'), 'utf8')

describe('the rules page is the rules modal, at a URL', () => {
  it('renders the same array the in-game modal maps', () => {
    // Not a copy of the rules: both read `t.rules`, so a rule reworded for the
    // modal is reworded on the page in the same edit and neither can go stale
    // against the other. Inlining the prose into the page would be the drift.
    const modal = readFileSync(path.join(CLIENT, 'src', 'components', 'RulesModal.svelte'), 'utf8')
    expect(article, 'the page must walk t.rules').toMatch(/#each t\.rules as/)
    // Both iterate the same array — the single source is the thing being
    // pinned here.
    expect(modal, 'the modal must walk t.rules').toMatch(/#each t\.rules as/)
  })

  it('names cards from the shared copy rather than spelling them out', () => {
    expect(article).toMatch(/t\.cardNames\[/)
    for (const lang of LANGS) {
      const t = lang === 'fr' ? fr : en
      for (const kind of Object.keys(t.cardNames) as CardKind[]) {
        expect(t.cardNames[kind]?.trim(), `${lang}/${kind}`).toBeTruthy()
      }
    }
  })

  it('translates every card name rather than leaving the English through', () => {
    // A `Record<CardKind, string>` is satisfied by copying the English in, and
    // TypeScript would never say a word. The symbols are the same in both
    // languages, so only the named ones can be compared.
    const symbolic: CardKind[] = ['draw_two', 'wild_draw_four']
    for (const kind of Object.keys(en.cardNames) as CardKind[]) {
      if (symbolic.includes(kind)) {
        expect(fr.cardNames[kind], kind).toBe(en.cardNames[kind])
      } else {
        expect(fr.cardNames[kind], `${kind} is still in English`).not.toBe(en.cardNames[kind])
      }
    }
  })
})

describe('the content stylesheet', () => {
  it('only names design tokens that exist', () => {
    // How this test came to exist: `.tableWrap` asked for `--color-surface`,
    // which is not a token. The declaration fell back to `#fff`, so the deck
    // table rendered as a white box — with the dark theme's pale ink on it, and
    // therefore unreadable, in the one theme nobody had screenshotted yet.
    //
    // A fallback is what made that silent, which is why there are none left in
    // this file: an undefined var with no fallback drops the declaration, and a
    // missing background is obvious. This makes it obvious before that.
    const css = readFileSync(path.join(CLIENT, 'src', 'content', 'content.css'), 'utf8')
    const tokens = readFileSync(path.join(CLIENT, 'src', 'styles', 'tokens.css'), 'utf8')

    // A page may also set a property itself — `--accent` is written per room
    // from the map registry, so it is defined in the markup rather than in the
    // token file. Both count as defined; nothing else does.
    const contentDir = path.join(CLIENT, 'src', 'content')
    const local = readdirSync(contentDir)
      .filter((f) => f.endsWith('.svelte'))
      .map((f) => readFileSync(path.join(contentDir, f), 'utf8'))
      // The table's materials are written by one module for the board and the
      // rooms page alike (`tableCssVars`), so its declarations count too.
      .concat(readFileSync(path.join(CLIENT, 'src', 'components', 'cards', 'tableSurface.ts'), 'utf8'))
      .join('\n')

    const used = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1])
    expect(used.length, 'no tokens found — is this reading the right file?').toBeGreaterThan(5)

    // The stylesheet may also declare its own — `--shell` and `--bar` are the
    // page's own measurements, not design tokens the game shares. Declared and
    // used in the same file, they still cannot go missing without a typo, which
    // this catches all the same.
    const missing = [...new Set(used)].filter(
      (name) =>
        !tokens.includes(`${name}:`) && !local.includes(`${name}:`) && !css.includes(`${name}:`),
    )
    expect(missing, 'custom properties used by content.css but defined nowhere').toEqual([])
  })

  it('styles no bare table element, because the game loads this file too', () => {
    // The game's layout imports this stylesheet for the footer row and the burger
    // drawer, so a bare `table`/`th`/`td` rule here reaches every table the game
    // draws. `thead th { background: var(--color-stroke) }` is what that cost:
    // an ink band landed behind the score table's column heads and the evening
    // recap's, both of which set `--color-muted` believing they sat on their own
    // panel — 2.2:1, in both themes, on two surfaces nobody had thought to look
    // at because the rule was written for a third.
    //
    // Every table on a content page is inside `.tableWrap`, so the scope costs
    // nothing here and is the whole fix.
    const css = readFileSync(path.join(CLIENT, 'src', 'content', 'content.css'), 'utf8')
    const bare = [...css.matchAll(/^\s*((?:t(?:able|head|body|foot|[rdh])|caption)[\s,{][^{]*)\{/gm)]
      .map((m) => m[1].trim())
      .filter((sel) => !sel.includes('.'))
    expect(bare, 'selectors in content.css must be scoped to a class').toEqual([])
  })

  it('lines the header, the column and the bar up on one width', () => {
    // They were 62rem, 46rem and 62rem: the logo, the <h1> and the footer each
    // started at a different x, and the page read as three unrelated strips.
    const css = readFileSync(path.join(CLIENT, 'src', 'content', 'content.css'), 'utf8')
    const block = (selector: string) =>
      new RegExp(`\\${selector}\\s*\\{[^}]*\\}`).exec(css)?.[0] ?? ''

    for (const selector of ['.siteHeader', '.content']) {
      expect(block(selector), `${selector} must take --shell`).toMatch(
        /max-width:\s*var\(--shell\)/,
      )
    }
    // The bar spans the viewport, so its width is not the shell's — what it owes
    // the column is the room to clear it.
    expect(block('.siteFooter')).toMatch(/position:\s*fixed/)
    expect(block('.content')).toMatch(/var\(--bar\)/)
  })

  it('keeps the header in sight, and stops jumps landing under it', () => {
    // Everything that leaves a content page is in the header, and under 46rem
    // the burger in it *is* the navigation, because the footer bar is hidden at
    // that width. A header that scrolled away sent a reader three screens into
    // the rules back to the top of the document to reach any of it.
    const css = readFileSync(path.join(CLIENT, 'src', 'content', 'content.css'), 'utf8')
    const block = (selector: string) =>
      new RegExp(`\\${selector}\\s*\\{[^}]*\\}`).exec(css)?.[0] ?? ''
    const layout = readFileSync(CONTENT_LAYOUT, 'utf8')

    expect(layout, 'the header row must sit inside the pinned band').toMatch(
      /class="headerBar"[\s\S]{0,200}class="siteHeader"/,
    )
    expect(block('.headerBar')).toMatch(/position:\s*sticky/)
    expect(block('.headerBar')).toMatch(/top:\s*0/)
    // The band covers the top of the viewport, so an anchor scrolled flush with
    // it arrives hidden: the skip link, the rules page's jump list and `#top`
    // all land on a heading the header is sitting on.
    expect(css, 'in-page jumps must clear the pinned header').toMatch(/scroll-padding-top:/)
  })

  it('never publishes the skip link to a reader who tapped', () => {
    // "Back to top" focuses the skip link so a keyboard reader lands at the top
    // of the document rather than in the middle of the header. On a phone that
    // press is a tap, and both halves of the guard are needed: a bare `:focus`
    // rule parked "Skip to content" over the logo, and `:focus-visible` alone did
    // not save it either, because Safari calls a programmatic `focus()` keyboard
    // focus whatever the gesture was. So the focus move is fenced behind a
    // keyboard activation, `detail === 0`.
    const css = readFileSync(path.join(CLIENT, 'src', 'content', 'content.css'), 'utf8')
    const boot = readFileSync(path.join(CLIENT, 'src', 'layouts', 'ToTop.svelte'), 'utf8')
    expect(boot, 'back-to-top is what moves focus there').toMatch(
      /\.skip'\)\?\.focus\(\{ preventScroll: true \}\)/,
    )
    expect(boot, 'a pointer press must move no focus at all').toMatch(
      /if \(e\.detail === 0\)[\s\S]{0,120}\.skip'\)\?\.focus\(/,
    )
    expect(css, 'the skip link must reveal on :focus-visible only').toMatch(
      /\.skip:focus-visible\s*\{/,
    )
    expect(css, 'a bare :focus reveals it on tap too').not.toMatch(/\.skip:focus\s*\{/)
  })

  it('glides to an anchor, and only for a reader who did not ask for less', () => {
    // A fragment jump on a page this long teleports the reader with nothing to
    // say the page did not change under them. The two halves of the wiring live
    // in two files, and either alone is silent: the stylesheet with no attribute
    // never glides, the attribute with no rule does nothing.
    const css = readFileSync(path.join(CLIENT, 'src', 'content', 'content.css'), 'utf8')
    const boot = readFileSync(CONTENT_LAYOUT, 'utf8')

    expect(css, 'the smooth rule must hang off the attribute').toMatch(
      /html\[data-scroll="smooth"\][^{]*\{[^}]*scroll-behavior:\s*smooth/,
    )
    // One declaration, and the assertion above says which rule carries it: a
    // second one anywhere would be smooth scrolling nothing can take back.
    expect(
      [...css.matchAll(/scroll-behavior:\s*smooth/g)],
      'the guarded rule is the only one allowed to declare it',
    ).toHaveLength(1)
    expect(boot, 'the preference is what writes it').toMatch(
      /prefers-reduced-motion[\s\S]{0,400}dataset\.scroll = 'smooth'/,
    )
    expect(boot, 'and it has to come back off when the reader flips it').toMatch(
      /delete document\.documentElement\.dataset\.scroll/,
    )
  })

  it('pins nothing behind the text', () => {
    // `background-attachment: fixed` made the prose slide over a gradient that
    // never moved. The board earns that gradient because it sits in a room; a
    // page of rules does not, and the effect dates a page instantly.
    for (const file of [
      path.join(CLIENT, 'src', 'content', 'content.css'),
      path.join(CLIENT, 'src', 'styles', 'tokens.css'),
    ]) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/background-attachment:\s*fixed/)
    }
  })

  it('keeps the landings flat: no gradient and no colour orb behind the prose', () => {
    // The den's gradient and its three colour orbs were tried twice on these
    // pages and refused both times: a landing is a page to read, and a glow
    // behind prose is ambience competing with it. `/` and the 404 are flat for
    // the same reason, so `body.doc` paints the canvas colour and nothing else.
    const css = readFileSync(path.join(CLIENT, 'src', 'content', 'content.css'), 'utf8')
    const doc = css.match(/body\.doc\s*\{[^}]*\}/)?.[0]
    expect(doc, 'body.doc declares the page').toBeTruthy()
    expect(doc).toMatch(/background:\s*var\(--color-canvas\);/)
    expect(doc).not.toMatch(/radial-gradient|linear-gradient|--bg-gradient/)
  })

  it('leaves no fallback to hide a missing one behind', () => {
    const css = readFileSync(path.join(CLIENT, 'src', 'content', 'content.css'), 'utf8')
    const withFallback = [...css.matchAll(/var\(--[\w-]+\s*,[^)]*\)/g)].map((m) => m[0])
    expect(withFallback).toEqual([])
  })
})

/*
 * The site has one bar and one drawer (layouts/SiteFooter.svelte,
 * layouts/SiteDrawer.svelte), rendered by both page layouts. They were written
 * twice once — a footer row under the game and a bar on the content pages, a
 * drawer in each layout — and the copies drifted into two sites. Every way that
 * can come back fails silently, and so does every way the phone's swap from bar
 * to drawer can fail: a drawer that never hides, a bar hidden on a browser whose
 * popover support was the only thing opening the drawer, or a menu that has
 * quietly stopped listing a page the bar still lists.
 */
describe('the mobile menu', () => {
  const css = readFileSync(path.join(CLIENT, 'src', 'content', 'content.css'), 'utf8')
  const layouts = path.join(CLIENT, 'src', 'layouts')
  const footer = readFileSync(path.join(layouts, 'SiteFooter.svelte'), 'utf8')
  const drawer = readFileSync(path.join(layouts, 'SiteDrawer.svelte'), 'utf8')
  const content = readFileSync(CONTENT_LAYOUT, 'utf8')
  const block = (selector: string) =>
    new RegExp(`\\${selector}\\s*\\{[^}]*\\}`).exec(css)?.[0] ?? ''

  it('is one bar and one drawer, rendered by both layouts', () => {
    // The two copies drifted once — different padding, the legal link in two
    // places, a globe on one side only — and crossing between the game and a
    // content page read as crossing between two sites.
    const game = readFileSync(GAME_LAYOUT, 'utf8')
    for (const [name, src] of [['(game)', game], ['(content)', content]] as const) {
      expect(src, `${name} renders the bar`).toMatch(/<SiteFooter\b/)
      expect(src, `${name} renders the drawer`).toMatch(/<SiteDrawer\b/)
      expect(src, `${name} must not write a drawer of its own`).not.toMatch(/id="navPop"/)
      expect(src, `${name} must not write a bar of its own`).not.toMatch(/class="siteFooter/)
    }
    expect(game, 'the game page asks for the home variants').toMatch(/<SiteFooter[^>]*\bhome\b/)
    expect(game).toMatch(/<SiteDrawer[^>]*\bhome\b/)
    // And content.css styles both whole: a `.navPop*` rule or a bar's look in
    // the game page's own stylesheet is how they drift apart again.
    const gameCss = readFileSync(path.join(layouts, 'GamePage.css'), 'utf8')
    expect(gameCss, 'content.css owns the drawer whole').not.toMatch(/^\s*\.navPop[\w-]*\s*[,{]/m)
    expect(gameCss, 'content.css owns the bar whole').not.toMatch(/^\s*\.siteFooter\s*[,{]/m)
  })

  it('declares the drawer visible only while it is open', () => {
    // How this came to exist: `.navPop { display: flex }`. A closed popover is
    // hidden by `[popover]:not(:popover-open) { display: none }` in the UA
    // stylesheet, and *any* author `display` beats it — cascade origin, not
    // specificity — so the drawer stood open over every page at every width.
    expect(block('.navPop'), '.navPop must not declare display').not.toMatch(/[^-]display:/)
    expect(block('.navPop:popover-open')).toMatch(/display:\s*flex/)
  })

  it('never hides the bar on a browser that cannot open the drawer', () => {
    const hidesBar = /@media[^{]*max-width[^{]*\{\s*@supports\s+selector\(\[popover\]\)/.test(css)
    expect(hidesBar, 'the bar may only be hidden inside @supports selector([popover])').toBe(true)
    expect(css).toMatch(/@supports not selector\(\[popover\]\)[\s\S]*?\.menuBtn,\s*\n\s*\.navPop/)
  })

  it('keeps the language panel out of the subtree the phone hides', () => {
    // `#langPop` lives inside the bar, and on a phone the drawer's globe is the
    // only way to it. Hiding the bar with `display: none` took the panel with
    // it: a popover under a hidden ancestor is promoted to the top layer and
    // still renders nothing. The bar's *row* goes; the bar stays box-less.
    const start = footer.indexOf('<footer class="siteFooter"')
    expect(start, 'the bar must exist').toBeGreaterThan(-1)
    const inBar = footer.slice(start, footer.indexOf('</footer>', start))
    expect(inBar, 'this test only matters while the panel is inside the bar').toContain('id="langPop"')
    const row = inBar.slice(inBar.indexOf('class="footerRow"'))
    expect(row.indexOf('id="langPop"'), 'the panel sits after the row, not in it').toBeGreaterThan(
      row.lastIndexOf('class="footerEnd"'),
    )

    const phone =
      /@media\s*\(max-width:\s*[\d.]+rem\)\s*\{\s*@supports\s+selector\(\[popover\]\)[\s\S]*$/.exec(css)?.[0] ?? ''
    expect(phone, 'the phone block must exist').toBeTruthy()
    const phoneRule = (selector: string) =>
      new RegExp(`\\${selector}\\s*\\{[^}]*\\}`).exec(phone)?.[0] ?? ''
    expect(phoneRule('.siteFooter'), 'the bar must keep rendering its subtree').toMatch(/display:\s*contents/)
    for (const selector of ['.footerPlay', '.footerNav', '.footerEnd']) {
      expect(phone, `${selector} must be hidden on a phone`).toMatch(new RegExp(`\\${selector}[,\\s]`))
    }
  })

  it('lists every page the bar lists, and the same way on both pages', () => {
    for (const [name, src] of [['bar', footer], ['drawer', drawer]] as const) {
      expect(src, `the ${name} must walk NAV`).toMatch(/#each NAV as/)
      expect(src, `the ${name} must carry the legal page`).toMatch(/LEGAL\.path\[lang\]/)
      expect(src, `the ${name} must carry the language`).toMatch(/popovertarget="langPop"/)
    }
    expect(drawer, 'the content drawer carries Play').toMatch(/HOME\.path\[lang\]/)
  })

  it('opens the drawer with the wordmark rather than the word "Menu"', () => {
    expect(drawer).toMatch(/class="navPopTitle"><LocoLogo/)
  })

  it('gives each drawer exactly one action, and the accent that comes with it', () => {
    // "Play" on a content page, where it is where you are going; "Preferences"
    // on the game page, where it is what you came into the menu to change. One
    // component, two branches, never both.
    const links = /<nav class="navPopLinks"[\s\S]*?<\/nav>/.exec(drawer)?.[0] ?? ''
    expect(links, 'Play is the content branch').toMatch(/\{:else\}[\s\S]*class="navPopCta navPopPlay"[\s\S]*\{\/if\}/)
    expect(links).not.toMatch(/\{#if home\}[^]*?class="navPopCta[^]*?\{:else\}/)
    const end = drawer.slice(drawer.indexOf('class="navPopEnd"'))
    const navPrefs = /<button\b[^>]*id="navPrefs"[^>]*>/.exec(end)?.[0] ?? ''
    expect(navPrefs, 'the game drawer has a Preferences row').not.toBe('')
    expect(navPrefs).toMatch(/class="navPopCta"/)
    expect(navPrefs).toMatch(/\bhidden\b/)
    expect(end, 'and only on the game page').toMatch(/\{#if home\}\s*<button\b[^>]*id="navPrefs"/)
    expect(block('.navPop .navPopCta'), 'the CTA is scoped past .navPopLinks a').toMatch(
      /color:\s*var\(--color-on-primary\)/,
    )
  })

  /*
   * The sheet and the rules modal are the same object seen from two screens, and
   * the way they come apart is one of them being restyled on its own. What is
   * pinned here is the shape they share and the two things that made the sheet
   * a *native* one: a <summary> that closes it with no bundle in flight, and a
   * scrim that is not inside the card it darkens.
   */
  it('opens the prose as the rules modal, and closes it with no script', () => {
    const game = gamePage()
    const modal = readFileSync(path.join(CLIENT, 'src', 'components', 'RulesModal.svelte'), 'utf8')
    const rule = (src: string, selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`).exec(src)?.[0] ?? ''

    const card = rule(game, '.homeSheet[open]')
    expect(card, 'the open sheet must be a card').toMatch(/border:\s*4px solid var\(--color-stroke\)/)
    expect(card).toMatch(/border-radius:\s*var\(--radius-xl\)/)
    expect(card).toMatch(/box-shadow:\s*var\(--shadow-pop\)/)
    expect(rule(modal, '.modal'), 'read off the modal, not invented here').toMatch(
      /border:\s*4px solid var\(--color-stroke\)/,
    )
    expect(game).toMatch(/class="homeSheetHead"/)
    expect(rule(game, '.homeSheetCard'), 'the prose is the only part that moves').toMatch(/overflow-y:\s*auto/)
    expect(rule(game, '.homeSheet[open] .homeSheetBtn'), 'the summary is the footer').toMatch(/order:\s*1/)
    expect(game, 'the scrim is a sibling of the sheet').toMatch(/<\/details>[\s\S]*?class="homeSheetScrim"/)
    expect(game).toMatch(/\.homeSheet\[open\]\s*~\s*\.homeSheetScrim/)
    // The ✕ is the scripted second way out: hidden until a script runs, and
    // `hidden` has to be stated in the CSS as well, or the `display: flex` that
    // draws it wins over the attribute.
    expect(game).toMatch(/class="homeSheetX"\s*\n?\s*hidden=\{!hydrated\}/)
    expect(rule(game, '.homeSheetX[hidden]')).toMatch(/display:\s*none/)
    expect(game, 'and it closes the sheet').toMatch(/class="homeSheetX"[\s\S]{0,200}onclick=\{closeSheet\}/)
    // The native control stays the native control: the open state is bound,
    // never driven, so the <summary> still opens it with no script.
    expect(game).toMatch(/<details class="homeSheet" bind:open=\{sheetOpen\}>/)
  })

  it('becomes the rulebook\'s own sheet on a phone', () => {
    const game = gamePage()
    const modal = readFileSync(path.join(CLIENT, 'src', 'components', 'RulesModal.svelte'), 'utf8')
    const phone = (src: string) => src.slice(src.indexOf('@media (max-width: 46rem)'))
    const rule = (src: string, selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`).exec(src)?.[0] ?? ''

    expect(game).toMatch(/@media \(max-width: 46rem\)/)
    expect(modal, 'read off the rulebook, not invented here').toMatch(/@media \(max-width: 46rem\)/)
    const card = rule(phone(game), '.homeSheet[open]')
    expect(card, 'the sheet must be re-anchored at this width').toBeTruthy()
    expect(card, 'up from the bottom edge').toMatch(/inset:\s*auto 0 0 0/)
    expect(card).toMatch(/width:\s*100%/)
    const radius = /border-radius:\s*([^;]+);/
    expect(radius.exec(card)?.[1]).toBe(radius.exec(rule(phone(modal), '.modal'))?.[1])
    expect(rule(phone(game), '.homeSheetTitle')).toMatch(/font-size:\s*20px/)
    expect(rule(phone(game), '.homeSheetX')).toMatch(/width:\s*40px/)
    expect(rule(phone(game), '.homeSheet[open] .homeSheetBtn'), 'the footer clears the home indicator').toMatch(
      /--safe-bottom/,
    )
    expect(rule(phone(modal), '.footer')).toMatch(/--safe-bottom/)
    // The burger opened this and opens nothing while it is up.
    expect(phone(game)).toMatch(/:root:has\(\.homeSheet\[open\]\)\s+\.homeBurger\s*\{[^}]*display:\s*none/)
  })

  it('gives the phone a way to the prose at all', () => {
    // Under 46rem the bar's row is gone and the drawer deliberately carries no
    // prose, so the drawer's first row on the game page is what opens it.
    expect(drawer, 'the row is first in the game drawer').toMatch(
      /<nav class="navPopLinks"[^>]*>\s*\{#if home\}[\s\S]*?<button\b[^>]*id="navAbout"/,
    )
    expect(drawer).toMatch(/id="navAbout"[^>]*hidden=\{!hydrated\}/)
    expect(gamePage(), 'and the game page hands it the sheet').toMatch(/onAbout=\{openSheetFrom\}/)
    // Only the *closed* sheet's button goes at this width: the open sheet is
    // fixed and must survive the row it lives in being hidden.
    const game = gamePage()
    const phone = game.slice(game.indexOf('@media (max-width: 46rem)'))
    expect(phone).toMatch(/\.homeSheet:not\(\[open\]\)\s*\{[^}]*display:\s*none/)
  })

  it('never ships the drawer a button that opens nothing', () => {
    expect(drawer).toMatch(/id="navPrefs"[^>]*hidden=\{!hydrated\}/)
    expect(drawer, 'and asks the game for the panel').toMatch(/loco:preferences/)
  })

  it('makes the bar one height on both pages, held still between them', () => {
    // The point of having one: the router cross-fades the page and the bar
    // stays exactly where it was. In the flow on `/`, pinned elsewhere, and the
    // same box either way — the closed sheet's <details> took the body's line
    // box and made the home bar 8px taller until it was a flex box itself.
    expect(block('.siteFooter')).toMatch(/view-transition-name:\s*site-footer/)
    expect(block('.siteFooter.onHome')).toMatch(/position:\s*static/)
    expect(block('.siteFooter.onHome'), 'never above the game panels').toMatch(/z-index:\s*auto/)
    const gameCss = readFileSync(path.join(layouts, 'GamePage.css'), 'utf8')
    expect(gameCss).toMatch(/\.homeSheet:not\(\[open\]\)\s*\{\s*display:\s*flex/)
    // And no glass: DESIGN.md keeps backdrop blur for the modal scrim alone.
    expect(block('.siteFooter')).not.toMatch(/backdrop-filter/)
    expect(block('.headerBar')).not.toMatch(/backdrop-filter/)
  })

  it('brings the served half and the mounted half up on the same frame', () => {
    const game = gamePage()
    const gate = /@media\s*\(scripting:\s*enabled\)\s*\{([\s\S]*?)\n\}/.exec(game)?.[1]
    expect(gate, 'the reveal must be gated on there being a script to wait for').toBeTruthy()
    // What fades is what arrives, never the surface it arrives onto: `#root`
    // and the bar are both filled with --color-canvas.
    for (const selector of ['#root > \\*', '\\.onHome \\.footerRow', '\\.homeBurger']) {
      expect(gate, `${selector} must hold`).toMatch(new RegExp(`:root:not\\(\\[data-booted\\]\\)\\s+${selector}`))
    }
    expect(gate, 'the mount point itself never fades').not.toMatch(/:root:not\(\[data-booted\]\)\s+#root\s*[,{]/)
    expect(gate, 'nor does the bar it paints').not.toMatch(/:root:not\(\[data-booted\]\)\s+\.siteFooter/)
    expect(game, 'the reveal is a state, not the whole attribute').toMatch(/:root\[data-booted='in'\]/)
    const delay = /animation:\s*homeBootIn[^;]*?\s([\d.]+)s\s+both/.exec(gate ?? '')?.[1]
    expect(Number(delay), 'a bundle that never lands still reveals the page').toBeGreaterThan(0)
    const frames = /@keyframes homeBootIn\s*\{([\s\S]*?)\}\s*\n/.exec(game)?.[1] ?? ''
    expect(frames).toMatch(/opacity/)
    expect(frames, 'no transform in the reveal').not.toMatch(/transform/)

    const entry = readFileSync(path.join(CLIENT, 'src', 'boot.ts'), 'utf8')
    expect(entry, 'boot.ts writes the attribute the CSS waits on').toMatch(/dataset\.booted/)
    expect(entry, 'and does it after the commit has been painted').toMatch(
      /requestAnimationFrame\(\(\) => \{\s*requestAnimationFrame/,
    )
    expect(entry, "it opens the reveal with 'in'").toMatch(/dataset\.booted = 'in'/)
    expect(entry, 'and blanks it once the fade is over').toMatch(/dataset\.booted = ''/)
  })

  it('closes the drawer at the width the CSS stops drawing it', () => {
    const script = drawer
    const inScript = /\(max-width:\s*([\d.]+)rem\)/.exec(script)?.[1]
    const inCss = /@media\s*\(max-width:\s*([\d.]+)rem\)\s*\{\s*@supports\s+selector\(\[popover\]\)/.exec(css)?.[1]
    expect(inScript, 'SiteDrawer.svelte must name a phone breakpoint').toBeTruthy()
    expect(inCss, 'content.css must gate the burger on one').toBeTruthy()
    expect(inScript).toBe(inCss)
  })

  it('gives every row in it something to aim at', () => {
    for (const selector of ['.navPopLinks a', '.navPopEnd .langBtn']) {
      const rule = new RegExp(`\\${selector.replace(/ /g, '\\s+')}[^{]*\\{[^}]*\\}`).exec(css)?.[0]
      expect(rule, `${selector} must be sized as a row`).toMatch(/min-height:\s*2\.75rem/)
    }
  })
})

describe('the block that answers "what is different"', () => {
  it('opens the rules page, before the rules themselves', () => {
    // The reader arrived with a model of another card game and is looking for
    // the delta. Putting it after ten sections of rules is putting it after the
    // point they gave up.
    const contrast = article.indexOf('#each CONTRASTS as')
    const rules = article.indexOf('#each t.rules as')
    expect(contrast, 'the page must render CONTRASTS').toBeGreaterThan(-1)
    expect(rules, 'the page must still map t.rules').toBeGreaterThan(-1)
    expect(contrast, 'the contrast block comes first').toBeLessThan(rules)
  })

  it('stays out of the in-game rules modal', () => {
    // The modal is a reference read standing up in the middle of a round. This
    // is an argument read before the first one, and it is not the same object.
    const modal = readFileSync(path.join(CLIENT, 'src', 'components', 'RulesModal.svelte'), 'utf8')
    expect(modal).not.toMatch(/CONTRASTS|contrasts/)
  })

  it('takes its hand size from the server rather than from a memory of it', () => {
    // Same rule as the deck table: a number typed here is right on the day it is
    // written, and this is the copy nobody plays against, so it goes wrong
    // silently.
    const size = serverInt(readServer('game', 'room'), 'initialHandSize')
    expect(Number.isInteger(size), `initialHandSize not found in ${serverLabel('game', 'room')}`).toBe(true)
    expect(HAND_SIZE).toBe(size)
  })

  it('takes the number range from the deck the server builds', () => {
    const body = serverDeckBody()
    expect(body, `the deck builder not found in ${serverLabel('game', 'deck')}`).toBeTruthy()
    const range = serverNumberRange(body!)
    expect(range, 'the number loop not found').toBeTruthy()
    expect(NUMBER_LOW).toBe(range!.low)
    expect(NUMBER_HIGH).toBe(range!.high)
  })

  it('states the numbers it claims, in both languages', () => {
    // The constants are interpolated, so this is what catches a line that
    // quietly stopped using them.
    const en = CONTRASTS.map((c) => c.en).join(' ')
    const fr = CONTRASTS.map((c) => c.fr).join(' ')
    for (const text of [en, fr]) {
      expect(text).toContain(String(HAND_SIZE))
      expect(text).toContain(String(DECK_SIZE))
      expect(text).toContain(String(NUMBER_HIGH))
    }
  })

  it('says all eight things, in both languages, and says them differently', () => {
    expect(CONTRASTS).toHaveLength(8)
    for (const line of CONTRASTS) {
      for (const lang of LANGS) {
        expect(line[lang]?.trim(), lang).toBeTruthy()
      }
      // A `Record<Lang, string>` is satisfied by pasting the English in twice.
      expect(line.fr, `still in English: ${line.en}`).not.toBe(line.en)
    }
  })
})

describe('the deck table', () => {
  it('describes the deck the server actually builds', () => {
    // `NewDeck()` is the deck. Reading it here rather than trusting the table is
    // what makes this a check instead of a restatement of the fixture.
    const body = serverDeckBody()
    expect(body, `the deck builder not found in ${serverLabel('game', 'deck')}`).toBeTruthy()

    // The loop is `for _, col := range [4 colours]`, values 1..9, and a fixed
    // `for i := 0; i < 4` for the three wilds, so a kind's total is how many
    // times it is appended inside a loop body times that loop's span.
    const appends = (goKind: string) => serverKindAppends(body!, goKind)
    const expected: Record<CardKind, number> = {
      number: appends('Number') * 4 * 9,
      skip: appends('Skip') * 4 * 2,
      reverse: appends('Reverse') * 4 * 2,
      draw_two: appends('DrawTwo') * 4 * 2,
      swap: appends('Swap') * 4,
      wild: appends('WildCard') * 4,
      wild_draw_four: appends('WildDrawFour') * 4,
      global_switch: appends('GlobalSwitch') * 4,
    }
    for (const entry of DECK) {
      expect(entry.copies, entry.kind).toBe(expected[entry.kind])
    }
    expect(DECK_SIZE).toBe(112)
  })

  it('says what every card does, in both languages', () => {
    for (const e of DECK) {
      for (const lang of LANGS) {
        const effect = e.effect[lang]
        expect(effect?.trim(), `${e.kind}/${lang}`).toBeTruthy()
        // A sentence, not a label: this is the answer somebody arrives on when
        // they searched for one card, and it is the whole body of that entry.
        expect(effect.length, `${e.kind}/${lang} is too short to be an answer`).toBeGreaterThan(40)
      }
      // A `Record<Lang, string>` is satisfied by pasting the English in twice.
      expect(e.effect.fr, `${e.kind} effect is still in English`).not.toBe(e.effect.en)
      expect(e.detail.fr, `${e.kind} detail is still in English`).not.toBe(e.detail.en)
    }
  })

  it('lists every kind of card exactly once', () => {
    const kinds = DECK.map((e) => e.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    // Every kind the protocol knows about: a card added to the game and not to
    // the table would leave the page quietly incomplete.
    const known = Object.keys(en.cardNames) as CardKind[]
    expect([...kinds].sort()).toEqual([...known].sort())
  })

  it('scores exactly as the server does', () => {
    // The server's card module is the only authority on points in the repo; the
    // page is a second statement of it, free to drift. This is what stops it.
    /** What the server's CardValue returns for a domain card-kind name. */
    const goValue = (goKind: string): number => {
      const v = serverCardValue(goKind)
      expect(v, `CardValue has no case for ${goKind} in ${serverLabel('game', 'card')}`).toBeDefined()
      return v!
    }

    const goName: Record<Exclude<CardKind, 'number'>, string> = {
      reverse: 'Reverse',
      skip: 'Skip',
      draw_two: 'DrawTwo',
      swap: 'Swap',
      global_switch: 'GlobalSwitch',
      wild: 'WildCard',
      wild_draw_four: 'WildDrawFour',
    }

    for (const entry of DECK) {
      if (entry.kind === 'number') {
        // Face value: no single figure, and the server returns the card's value.
        expect(entry.points).toBeNull()
        expect(serverNumberScoresFace()).toBe(true)
        continue
      }
      expect(entry.points, entry.kind).toBe(goValue(goName[entry.kind]))
    }
  })
})
