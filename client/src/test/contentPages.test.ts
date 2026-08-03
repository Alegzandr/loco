/**
 * The content pages restate things the game already knows: the rules, and what a
 * card is worth. Restating is the risk — two copies of one fact drift, and the
 * page is the copy nobody plays against, so it drifts silently and stays wrong
 * for as long as nobody reads it.
 *
 * So nothing here checks that the page "looks right". Each test pins the page to
 * the source it is a second view of: the rules to `t.rules`, which the in-game
 * modal maps, and the scoring to `server/game/card.go`, which is the only
 * authority on points anywhere in the repo.
 *
 * That the *rendered* page carries every rule is asserted in
 * `e2e/tests/seo.spec.ts`, against the real page with JavaScript disabled, which
 * also proves it is readable by something that does not run scripts.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { DECK, DECK_SIZE } from '../content/deck'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'
import type { CardKind } from '../types/protocol'
import { LANGS } from '../seo/meta'

const REPO = path.resolve(__dirname, '..', '..', '..')
const CLIENT = path.resolve(__dirname, '..', '..')
const article = readFileSync(path.join(CLIENT, 'src', 'content', 'RulesArticle.astro'), 'utf8')

describe('the rules page is the rules modal, at a URL', () => {
  it('renders the same array the in-game modal maps', () => {
    // Not a copy of the rules: both read `t.rules`, so a rule reworded for the
    // modal is reworded on the page in the same edit and neither can go stale
    // against the other. Inlining the prose into the page would be the drift.
    const modal = readFileSync(path.join(CLIENT, 'src', 'components', 'RulesModal.svelte'), 'utf8')
    expect(article, 'the page must map t.rules').toMatch(/t\.rules\.map/)
    // The page is Astro and maps; the modal is Svelte and iterates. Different
    // spelling, same single source — which is the thing being pinned here.
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
      .filter((f) => f.endsWith('.astro'))
      .map((f) => readFileSync(path.join(contentDir, f), 'utf8'))
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
    const layout = readFileSync(path.join(CLIENT, 'src', 'layouts', 'ContentPage.astro'), 'utf8')

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
    // press is a tap, and a bare `:focus` rule parked "Skip to content" over the
    // logo with nothing offering to close it.
    const css = readFileSync(path.join(CLIENT, 'src', 'content', 'content.css'), 'utf8')
    const boot = readFileSync(path.join(CLIENT, 'src', 'content', 'theme-boot.ts'), 'utf8')
    expect(boot, 'back-to-top is what moves focus there').toMatch(
      /\.skip'\)\?\.focus\(\{ preventScroll: true \}\)/,
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
    const boot = readFileSync(path.join(CLIENT, 'src', 'content', 'theme-boot.ts'), 'utf8')

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

  it('leaves no fallback to hide a missing one behind', () => {
    const css = readFileSync(path.join(CLIENT, 'src', 'content', 'content.css'), 'utf8')
    const withFallback = [...css.matchAll(/var\(--[\w-]+\s*,[^)]*\)/g)].map((m) => m[0])
    expect(withFallback).toEqual([])
  })
})

/*
 * On a phone the bar is replaced by a drawer, and every way that swap can fail
 * fails silently: a drawer that never hides, a bar hidden on a browser whose
 * popover support was the only thing opening the drawer, or a menu that has
 * quietly stopped listing a page the bar still lists.
 */
describe('the mobile menu', () => {
  const css = readFileSync(path.join(CLIENT, 'src', 'content', 'content.css'), 'utf8')
  const layout = readFileSync(path.join(CLIENT, 'src', 'layouts', 'ContentPage.astro'), 'utf8')
  const block = (selector: string) =>
    new RegExp(`\\${selector}\\s*\\{[^}]*\\}`).exec(css)?.[0] ?? ''

  it('declares the drawer visible only while it is open', () => {
    // How this came to exist: `.navPop { display: flex }`. A closed popover is
    // hidden by `[popover]:not(:popover-open) { display: none }` in the UA
    // stylesheet, and *any* author `display` beats it — cascade origin, not
    // specificity — so the drawer stood open over every page at every width.
    expect(block('.navPop'), '.navPop must not declare display').not.toMatch(/[^-]display:/)
    expect(block('.navPop:popover-open')).toMatch(/display:\s*flex/)
  })

  it('never hides the bar on a browser that cannot open the drawer', () => {
    // The bar goes away on a phone because the drawer replaces it. Where
    // `popover` is missing the drawer cannot open at all, so hiding the bar
    // there would leave the page with no navigation whatsoever.
    const hidesBar = /@media[^{]*max-width[^{]*\{\s*@supports\s+selector\(\[popover\]\)/.test(css)
    expect(hidesBar, 'the bar may only be hidden inside @supports selector([popover])').toBe(true)
    expect(css).toMatch(/@supports not selector\(\[popover\]\)[\s\S]*?\.menuBtn,\s*\n\s*\.navPop/)
  })

  it('keeps the language panel out of the subtree the phone hides', () => {
    // `#langPop` lives inside the footer bar, and on a phone the drawer's globe
    // is the only way to it. Hiding the bar with `display: none` took the panel
    // with it: a popover under a hidden ancestor is promoted to the top layer
    // and still renders nothing, so the button did nothing at all — the one
    // control that switches language on a phone. The bar's *contents* go; the
    // bar itself stays as a box-less wrapper so the panel can still open.
    const start = layout.indexOf('<footer class="siteFooter">')
    expect(start, 'the footer bar must exist').toBeGreaterThan(-1)
    expect(
      layout.slice(start, layout.indexOf('</footer>', start)),
      'this test only matters while the panel is inside the bar',
    ).toContain('id="langPop"')

    const phone =
      /@media\s*\(max-width:\s*[\d.]+rem\)\s*\{\s*@supports\s+selector\(\[popover\]\)[\s\S]*$/.exec(
        css,
      )?.[0] ?? ''
    expect(phone, 'the phone block must exist').toBeTruthy()
    const phoneRule = (selector: string) =>
      new RegExp(`\\${selector.replace(/,\s*\n\s*/g, ',\\s*\\n\\s*')}\\s*\\{[^}]*\\}`).exec(
        phone,
      )?.[0] ?? ''
    expect(phoneRule('.siteFooter'), 'the bar must keep rendering its subtree').toMatch(
      /display:\s*contents/,
    )
    for (const selector of ['.footerPlay', '.footerNav', '.footerEnd']) {
      expect(phone, `${selector} must be hidden on a phone`).toMatch(
        new RegExp(`\\${selector}[,\\s]`),
      )
    }
  })

  it('lists every page the bar lists', () => {
    // Two renderings of one navigation, both built from `NAV` and `LEGAL`, so a
    // page added to the registry cannot appear in the bar alone. The drawer
    // carries "Play" too — it is the whole bar, not a subset of it.
    const drawer = /<nav class="navPopLinks"[\s\S]*?<\/nav>/.exec(layout)?.[0] ?? ''
    expect(drawer, 'the drawer must map NAV').toMatch(/NAV\.map/)
    expect(drawer, 'the drawer must carry the legal page').toMatch(/LEGAL\.path\[lang\]/)
    expect(drawer, 'the drawer must carry Play').toMatch(/HOME\.path\[lang\]/)
  })

  it('is the same drawer on the game page, with that page\'s items', () => {
    // One menu across the site, not two that happen to look alike: the game
    // page renders the same `#navPop` and is styled by the same rules in
    // content.css. What differs is what is in it — no "Play" on the page you
    // play on, and no theme or language, which are behind the lobby's gear.
    const home = readFileSync(path.join(CLIENT, 'src', 'layouts', 'GamePage.astro'), 'utf8')
    expect(home).toMatch(/id="navPop"[^>]*popover="auto"[^>]*class="navPop"/)
    expect(home).toMatch(/class="navPopLinks"/)
    // Sliced by index rather than matched: the drawer's closing tag is one of
    // several in the markup, and a regex that found the right one would be
    // matching this file's indentation.
    const start = home.indexOf('id="navPop"')
    expect(start, 'the drawer must exist').toBeGreaterThan(-1)
    const drawer = home.slice(start, home.indexOf('</footer>', start))
    expect(drawer, 'the game page must not offer to take a player to the game').not.toMatch(
      /HOME\.path\[lang\]/,
    )
    expect(drawer, 'theme and language belong to the lobby gear here').not.toMatch(/themeBtn/)

    // And nothing but the list. The drawer used to end with `<HomeProse />`,
    // which made the menu on `/` a taller, wordier object than the one a
    // content page opens one tap later: same button, same corner, two menus.
    // The prose keeps the sheet, which is still in this file and still what
    // puts it in front of a crawler.
    expect(drawer, 'the drawer is a list of destinations, not a document').not.toMatch(/HomeProse/)
    expect(home, 'the sheet still renders the prose').toMatch(/HomeProse/)

    // The other half of "one menu": the game page contributes no styling to it.
    // A `.navPop*` rule here is how the two drift apart while both keep passing
    // every assertion above.
    expect(home, 'content.css owns the drawer whole').not.toMatch(/^\s*\.navPop[\w-]*\s*[,{]/m)
  })

  it('opens both drawers with the wordmark rather than the word "Menu"', () => {
    // It named the panel the reader had just opened and was looking at, and it
    // was the one branded surface on either half of the site with no brand on
    // it — on the game page especially, where the drawer covers the board and
    // there is no header behind it. Static <LocoLogo />, so it is the same
    // drawing as the one on the cards and it costs the page no JavaScript.
    for (const file of ['ContentPage.astro', 'GamePage.astro']) {
      const src = readFileSync(path.join(CLIENT, 'src', 'layouts', file), 'utf8')
      expect(src, `${file}: the drawer opens with the mark`).toMatch(
        /class="navPopTitle"><LocoLogo/,
      )
      expect(src, `${file}: rendered statically, never as an island`).not.toMatch(
        /<LocoLogo[^>]*client:/,
      )
    }
  })

  it('gives each drawer exactly one action, and the accent that comes with it', () => {
    // The drawers were `Play` plus five destinations on one side and six
    // destinations on the other, so one menu had the game's colour in it and the
    // other was a grey corridor. They carry the same object now, at opposite
    // ends because it means opposite things: where you are going, versus what
    // you came into the menu to change.
    const content = readFileSync(path.join(CLIENT, 'src', 'layouts', 'ContentPage.astro'), 'utf8')
    const game = readFileSync(path.join(CLIENT, 'src', 'layouts', 'GamePage.astro'), 'utf8')
    // Matched on the attribute, not the bare name: both files talk about the
    // other one's CTA in a comment, which is the point of the pairing.
    expect(content.match(/class="navPopCta/g), 'one CTA on a content page').toHaveLength(1)
    expect(game.match(/class="navPopCta/g), 'one CTA on the game page').toHaveLength(1)
    expect(content).toMatch(/class="navPopCta navPopPlay"/)
    expect(game).toMatch(/id="navPrefs" class="navPopCta" hidden/)

    // Its colour has to survive `.navPopLinks a`, which is a class *and* a type
    // and therefore wins on specificity however far down the file the CTA sits.
    // It went unseen while the only CTA was white-on-pink against an ink colour
    // that is also near white in the dark theme.
    expect(block('.navPop .navPopCta'), 'the CTA is scoped past .navPopLinks a').toMatch(
      /color:\s*var\(--color-on-primary\)/,
    )
  })

  /*
   * The sheet and the rules modal are the same object seen from two screens, and
   * the way they come apart is one of them being restyled on its own — nothing
   * fails, the game simply has two ideas of what a panel over the board is. What
   * is pinned here is the shape they share and the two things that made the
   * sheet a *native* one: a <summary> that closes it with no bundle in flight,
   * and a scrim that is not inside the card it darkens.
   */
  it('opens the prose as the rules modal, and closes it with no script', () => {
    const game = readFileSync(path.join(CLIENT, 'src', 'layouts', 'GamePage.astro'), 'utf8')
    const modal = readFileSync(path.join(CLIENT, 'src', 'components', 'RulesModal.svelte'), 'utf8')
    // Escaped whole: these selectors carry an attribute, so the `[open]` in them
    // is a character class the moment it reaches a regex unescaped — and one
    // that matches nothing, which is a test that passes by finding no rule.
    const rule = (src: string, selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`).exec(
        src,
      )?.[0] ?? ''

    // The card: the modal's border, radius and shadow, on the <details> itself.
    const card = rule(game, '.homeSheet[open]')
    expect(card, 'the open sheet must be a card').toMatch(/border:\s*4px solid var\(--color-stroke\)/)
    expect(card).toMatch(/border-radius:\s*var\(--radius-xl\)/)
    expect(card).toMatch(/box-shadow:\s*var\(--shadow-pop\)/)
    expect(rule(modal, '.modal'), 'read off the modal, not invented here').toMatch(
      /border:\s*4px solid var\(--color-stroke\)/,
    )

    // A headed title and a footer, both held while the prose scrolls between
    // them — the modal's arrangement, and the reason the way out never moves.
    expect(game).toMatch(/class="homeSheetHead"/)
    expect(rule(game, '.homeSheetCard'), 'the prose is the only part that moves').toMatch(
      /overflow-y:\s*auto/,
    )

    // The one control a player without a bundle can press. `order` is what puts
    // it at the foot: a <summary> must come first in the markup, and losing this
    // rule would leave the footer button sitting above the title.
    expect(rule(game, '.homeSheet[open] .homeSheetBtn'), 'the summary is the footer').toMatch(
      /order:\s*1/,
    )

    // Outside the <details>, or it would be painted over the card's own
    // background: the card here *is* the element the scrim would be a child of.
    expect(game, 'the scrim is a sibling of the sheet').toMatch(
      /<\/details>[\s\S]*?class="homeSheetScrim"/,
    )
    expect(game).toMatch(/\.homeSheet\[open\]\s*~\s*\.homeSheetScrim/)

    // The ✕ is the scripted second way out, so it ships hidden — and `hidden`
    // has to be stated in the CSS as well, or the `display: flex` that draws it
    // wins over the attribute and it is on screen with nothing behind it.
    expect(game).toMatch(/class="homeSheetX"\s*\n?\s*hidden/)
    expect(rule(game, '.homeSheetX[hidden]')).toMatch(/display:\s*none/)
    const script = readFileSync(path.join(CLIENT, 'src', 'homeSheet.ts'), 'utf8')
    expect(script, 'the script reveals it and wires it').toMatch(/homeSheetX/)
  })

  it('never ships the drawer a button that opens nothing', () => {
    // The Preferences row opens a React panel, so with no script it would be a
    // control that does nothing — worse than one that is not there. Same
    // contract as the content pages' theme switch: `hidden` in the markup, and
    // the script that can honour it is the script that reveals it.
    const game = readFileSync(path.join(CLIENT, 'src', 'layouts', 'GamePage.astro'), 'utf8')
    expect(game).toMatch(/id="navPrefs"[^>]*hidden/)
    const script = readFileSync(path.join(CLIENT, 'src', 'homeSheet.ts'), 'utf8')
    expect(script, 'the script reveals it').toMatch(/navPrefs/)
    expect(script, 'and asks React for the panel').toMatch(/loco:preferences/)
  })

  it('brings the served half and the mounted half up on the same frame', () => {
    // The footer and the burger are markup; the game is a bundle. Nothing tied
    // them together, so `/` arrived twice — background plus chrome, then the
    // lobby. Both now hold at opacity 0 until entry.ts says React has painted.
    const game = readFileSync(path.join(CLIENT, 'src', 'layouts', 'GamePage.astro'), 'utf8')
    const gate = /@media\s*\(scripting:\s*enabled\)\s*\{([\s\S]*?)\n\s{2}\}/.exec(game)?.[1]
    expect(gate, 'the reveal must be gated on there being a script to wait for').toBeTruthy()

    // What fades is what arrives, never the surface it arrives onto. `#root` and
    // `.homeIntro` are both filled with --color-canvas, and that flat fill is
    // the only reason the body's candy gradient is never seen: fading either of
    // them let it through for a third of a second, and the load flashed a
    // gradient that belongs to no screen in the game.
    for (const selector of ['#root > \\*', '\\.homeIntroMain', '\\.homeBurger']) {
      expect(gate, `${selector} must hold`).toMatch(
        new RegExp(`:root:not\\(\\[data-booted\\]\\)\\s+${selector}`),
      )
    }
    expect(gate, 'the mount point itself never fades').not.toMatch(
      /:root:not\(\[data-booted\]\)\s+#root\s*[,{]/,
    )
    expect(gate, 'nor does the footer it paints').not.toMatch(
      /:root:not\(\[data-booted\]\)\s+\.homeIntro\s*[,{]/,
    )

    // The reveal is spent rather than left standing: every screen is a fresh
    // child of #root, so a live rule would replay the fade on every screen
    // change for the rest of the match. The bare attribute lifts the hold.
    expect(game, 'the reveal is a state, not the whole attribute').toMatch(
      /:root\[data-booted='in'\]/,
    )

    // Without a script there is no mount to wait for, and the prose behind the
    // sheet is the only thing on this page a crawler reads: hiding it behind a
    // reveal that cannot fire would take the indexable half of `/` off the page.
    // The delay inside the gate is the same promise for a bundle that 404s.
    const delay = /animation:\s*homeBootIn[^;]*?\s([\d.]+)s\s+both/.exec(gate ?? '')?.[1]
    expect(Number(delay), 'a bundle that never lands still reveals the page').toBeGreaterThan(0)

    // Opacity, never a transform: each of these would become the containing
    // block for the fixed burger and for every panel the app renders while it
    // ran.
    const frames = /@keyframes homeBootIn\s*\{([\s\S]*?)\}\s*\n/.exec(game)?.[1] ?? ''
    expect(frames).toMatch(/opacity/)
    expect(frames, 'no transform in the reveal').not.toMatch(/transform/)

    const entry = readFileSync(path.join(CLIENT, 'src', 'entry.ts'), 'utf8')
    expect(entry, 'entry.ts writes the attribute the CSS waits on').toMatch(/dataset\.booted/)
    expect(entry, 'and does it after the commit has been painted').toMatch(
      /requestAnimationFrame\(\(\) => \{\s*requestAnimationFrame/,
    )
    expect(entry, "it opens the reveal with 'in'").toMatch(/dataset\.booted = 'in'/)
    expect(entry, 'and blanks it once the fade is over').toMatch(/dataset\.booted = ''/)
  })

  it('closes the drawer at the width the CSS stops drawing it', () => {
    // Two copies of one breakpoint — a media query cannot close a popover, and
    // a script cannot read a media query it was not told about. Drifted apart,
    // the drawer either shuts while it is still the navigation or stands over a
    // page that has its bar back.
    const script = readFileSync(path.join(CLIENT, 'src', 'content', 'navMenu.ts'), 'utf8')
    const inScript = /\(max-width:\s*([\d.]+)rem\)/.exec(script)?.[1]
    const inCss = /@media\s*\(max-width:\s*([\d.]+)rem\)\s*\{\s*@supports\s+selector\(\[popover\]\)/
      .exec(css)?.[1]
    expect(inScript, 'navMenu.ts must name a phone breakpoint').toBeTruthy()
    expect(inCss, 'content.css must gate the burger on one').toBeTruthy()
    expect(inScript).toBe(inCss)
  })

  it('gives every row in it something to aim at', () => {
    // 12px of text is not a touch target, and the bar folding into two rows of
    // it on a phone is the whole reason the drawer exists. Anything below
    // 2.75rem here means the drawer has drifted back towards being a list of
    // words.
    for (const selector of ['.navPopLinks a', '.navPopEnd .themeBtn']) {
      const rule = new RegExp(`\\${selector.replace(/ /g, '\\s+')}[^{]*\\{[^}]*\\}`).exec(css)?.[0]
      expect(rule, `${selector} must be sized as a row`).toMatch(/min-height:\s*2\.75rem/)
    }
  })
})

describe('the deck table', () => {
  it('describes the deck the server actually builds', () => {
    // `NewDeck()` is the deck. Reading it here rather than trusting the table is
    // what makes this a check instead of a restatement of the fixture.
    const src = readFileSync(path.join(REPO, 'server', 'game', 'deck.go'), 'utf8')
    const body = /func NewDeck\(\)[^]*?\n}/.exec(src)?.[0]
    expect(body, 'NewDeck() not found — this test is reading the wrong file').toBeTruthy()

    // The loop is `for _, col := range [4 colours]`, values 1..9, and a fixed
    // `for i := 0; i < 4` for the three wilds, so a kind's total is how many
    // times it is appended inside a loop body times that loop's span.
    const appends = (goKind: string) =>
      (body!.match(new RegExp(`Kind: ${goKind}\\b`, 'g')) ?? []).length
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
    // server/game/card.go is the only authority on points in the repo; the page
    // is a second statement of it, free to drift. This is what stops it.
    const src = readFileSync(path.join(REPO, 'server', 'game', 'card.go'), 'utf8')
    const fn = /func CardValue\([^]*?\n}/.exec(src)?.[0]
    expect(fn, 'CardValue() not found — this test is reading the wrong file').toBeTruthy()

    /** What the Go switch returns for a Go card-kind name. */
    const goValue = (goKind: string): number => {
      const m = new RegExp(`case[^:\\n]*\\b${goKind}\\b[^:\\n]*:\\s*\\n\\s*return (\\d+)`).exec(fn!)
      expect(m, `CardValue has no case for ${goKind}`).toBeTruthy()
      return Number(m![1])
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
        // Face value: no single figure, and the Go switch returns c.Value.
        expect(entry.points).toBeNull()
        expect(fn).toMatch(/case Number:\s*\n\s*return c\.Value/)
        continue
      }
      expect(entry.points, entry.kind).toBe(goValue(goName[entry.kind]))
    }
  })
})
