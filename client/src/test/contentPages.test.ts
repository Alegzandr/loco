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
    const modal = readFileSync(path.join(CLIENT, 'src', 'components', 'RulesModal.tsx'), 'utf8')
    expect(article, 'the page must map t.rules').toMatch(/t\.rules\.map/)
    expect(modal, 'the modal must map t.rules').toMatch(/t\.rules\.map/)
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
