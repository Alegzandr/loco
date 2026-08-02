# Being findable: what is indexable, and what it is worth

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

## The honest premise

The obvious comparable is Gartic Phone, and looking at it closely argues against copying it.
51.76% of its traffic is **direct**, search is under 10%, and its top five organic keywords are all
brand terms ("gartic phone", "garticphone", "gartic" and their Russian spellings). Technically the
site is a Next.js shell with no content in it. What it actually owns is 70.9K backlinks across
5.18K referring domains and a social feed from Discord, YouTube and VK. Gartic Phone manufactured
its demand **off Google**, and Google merely harvests it.

LOCO has no brand demand to harvest, so it cannot run that play yet. What it can do is answer the
descriptive queries — the "free online card game with friends, no signup" family — which today are
served by thin but natively-optimised sites (unoonline.io, playunofree.com, pizz.uno,
scuffeduno.online, buddyboardgames.com/uno). They are beatable on quality, but only with pages, and
until this work the site had exactly one URL whose entire text lived in JavaScript.

So: the pages below are worth building and their ceiling is real but bounded. **The unbounded part
is off-site and is not an SEO task**: a table link that opens a game in one click from a Discord
paste, an IGDB entry so Twitch has a category to select at all, and browser-game directories. Those
are what produced the 5.18K referring domains, and none of them is a meta tag.

Two standing constraints on every page:

- **A content page never says UNO.** This is stricter than "do not claim to be UNO", and it is the
  same rule the game itself obeys (`CLAUDE.md`, Legal): the disclaimer that names the mark in order
  to disclaim it is only true while no other player-facing string carries it, and a page indexed by
  Google is about as player-facing as it gets. `legal.test.tsx` asserts this over the i18n copy;
  `seo.test.ts` extends it over `PAGES`, `UI` and every file under `src/content/` — except
  `legal.ts`, which carries the disclaimer that names the mark in order to disclaim it, and which is
  the reason the rule exists.

  It costs the single highest-volume keyword in the category, knowingly. The pages are written to
  answer the descriptive queries — "free online card game with friends, no signup" — which is the
  ground LOCO can hold anyway, since it cannot outrank Mattel on Mattel's own name.
- **The voice is the game's, not a website's** (`client.md`). Players open a **table**, French is
  tutoiement, and a page explains rather than sells.

## The registry is the single source

`client/src/seo/meta.ts` holds `PAGES`, and every page appears there once with its path, title and
description **per language**. The sitemap, the `hreflang` sets, the canonical and `src/test/seo.test.ts`
all read it. This shape exists because the failures in this area are silent by nature: a page
declared but never built, a `hreflang` set that does not point back, two pages sharing a title. None
of them shows up locally, none of them fails CI on its own, and all of them surface months later as
"the French page never got indexed".

`seo.test.ts` therefore asserts the properties that make one source worth having: every page has a
non-empty title and description in every language, no title or description is ever repeated (the
same string in both languages means one was never translated), every declared path is distinct and
slash-terminated, and **every declared path has a source file behind it**. That last one is the
point: the sitemap is generated from this list, so a page in the list and not on disk hands Google a
URL that 404s.

## URLs

English at the root, French under `/fr/`, via Astro's `i18n` with `prefixDefaultLocale: false`. The
game's own URL stays `/` deliberately: it is the address people paste, and moving it to `/en/` for
symmetry would break every link already shared.

`trailingSlash: 'always'`. Astro builds directories, so `/fr/` is `/fr/index.html`, and nginx serves
that at both `/fr` and `/fr/`. Pinning the slashed form in the registry means the canonical, the
sitemap and the `hreflang` set all name the same URL rather than competing as duplicates of each
other.

A redirect from the unslashed form would be the other way to fix that, and it is a trap worth
recording: `/nope` has no directory either, so redirecting on a `try_files` miss sends `/nope` to
`/nope/` to `/nope//` forever. The canonical link resolves the duplicate without that risk.

## hreflang

Reciprocal by construction, because both sides come out of the same `PageDef`. This matters more
than it looks: Google **ignores** a `hreflang` set whose pages do not point back at each other, which
is the single most common way to implement this and get nothing for it. There is exactly one
`x-default`, pointing at the default language.

Both the page head and the sitemap carry the alternates. The head links are what Google reads most
reliably; the sitemap is what it discovers. `@astrojs/sitemap`'s `i18n` option emits the
`xhtml:link` pairs, and `src/seo/meta.ts` emits the head links.

## The language the page was served as

A French URL that renders in English wastes the click it just earned, so `/fr/` has to open in
French even for a browser set to English. The page declares itself with **`data-served-lang`**, and
`detectLang()` reads it second, after a stored choice and before `navigator.language`.

It is deliberately *not* `<html lang>`. The i18n provider writes that attribute on every language
change, so reading it back would make the app detect its own last output rather than the document it
was served — circular, and in jsdom (where one document is reused across a file's tests) it leaks the
previous test's language into the next one. `i18n.test.tsx` pins all three cases: the URL wins over
the browser, a stored choice wins over the URL, and `<html lang>` is never an input.

## The origin has to be decided at build time

Crawlers do not run JS and resolve `og:image` against nothing, so a relative URL is simply not
fetched. `VITE_PUBLIC_ORIGIN` therefore feeds both `astro.config.mjs`'s `site` and `meta.ts`'s
`ORIGIN`, and both default to production.

That default was a live bug: nothing passed the variable anywhere, so the image built for
`loco-d.kisukesaama.com` served a canonical and an `og:url` naming production. The `-d.` host's
`Disallow: /` hid it rather than fixing it. `client/Dockerfile` now takes it as an `ARG`, and
`.gitlab-ci.yml` passes `https://${APP_HOST}` — already `-d.` on `develop` and the bare host on a
`v*` tag.

## What nginx has to agree with

- `robots.txt` is generated from `$host`: production invites indexing and advertises
  `sitemap-index.xml`; `-d.` hosts disallow everything and, deliberately, advertise no sitemap —
  a host that disallows everything while pointing at a sitemap is a contradiction a crawler reports.
- `try_files $uri $uri/ =404` plus a real `404.html`. The old `try_files … /index.html` answered
  **200 with the game** for any URL: a soft 404, which Google reports as an error and which hides
  genuine broken links from everyone else. The 404 page is `noindex` and carries no canonical: a
  404 naming a canonical is claiming to be a real page.
- `gzip` on text, JS, JSON, XML and SVG only. webp and woff2 are already compressed, so a second
  pass costs CPU per request and saves nothing.
- `Cache-Control: immutable` for a year on `/_astro/`, whose names are content-hashed.

`seo.test.ts` asserts each of these against `nginx.conf`, because nothing else in the loop meets that
file: unit tests read sources and the E2E suite runs against a dev server that sends none of it.

## Structured data

`VideoGame` + `WebSite` on the game pages, stating the two properties this category is actually
searched on: that it is free, and that a group can play it in a browser. Saying it in prose alone
leaves it to be inferred.

The block is `is:inline`, which is required (Astro would otherwise bundle it away as a module) and
safe: `script-src` does not apply to a script whose type is not a JavaScript MIME type, because such
a block is data and is never executed. `csp.test.ts` allows `is:inline` for `application/ld+json`
and for nothing else.

## The content pages

`src/layouts/ContentPage.astro` is the shell: header, one column, footer bar. `src/content/` holds
the prose and the data behind it, and is **never imported by the app** — `en.ts` and `fr.ts` are
already 28 KB and 17 KB shipped to every player, and none of this is rendered inside the game.

### The shell: one width, one bar, no backdrop

Three things were wrong with the first version of it, and all three were the kind that make a page
read as cheap without any one element being obviously broken.

**Three container widths.** The header was 62rem, the column 46rem and the footer 62rem, so the logo,
the `<h1>` and the footer text each started at a different x and the page read as three unrelated
strips. `--shell` is declared once on `.page` and header, column and bar all take it. Nothing below
sets a max-width of its own except the two that are about *reading* rather than about alignment: the
lede and the body measure.

**A gradient pinned to the viewport.** `tokens.css` painted the candy gradient with
`background-attachment: fixed`, so the prose slid over a backdrop that never moved. The board earns
that gradient — it sits in a room. A page of prose does not, so `body.doc` is the flat canvas colour
and the attachment is gone from `tokens.css` entirely (the game page is one viewport, so it never
scrolled against it anyway). `contentPages.test.ts` fails if either comes back.

**Navigation in the header.** The home page puts its links in a footer row, and a player arriving
from `/` met a completely different arrangement one click later. The pages now live in a **fixed
footer bar** on every content page: the same five links, in the same order, at the same quiet weight,
with `Play` standing exactly where the home page's sheet button stands. It is `position: fixed`
because on `/` that row is always in sight — that page is exactly one viewport — and a page that
scrolls only keeps the promise by staying put. The bar is opaque rather than frosted, and the column
reserves `--bar` of bottom padding so no line of text ends up under it.

**And a header that stays.** The bar answers where the *pages* are; the header carries everything
else that leaves the document — the mark back to `/`, the `Play` CTA, and under 46rem the burger that
is the whole navigation, since the bar is hidden at that width. Scrolling it away meant a reader
three screens into the rules had to travel back to the top of the document to reach any of it, which
on a phone was the only route out of the page. `.headerBar` is `position: sticky` rather than fixed:
it is the first child of the flex column, so pinning it costs the column nothing and `--bar` stays
the only room the page has to reserve. The band is full-width and opaque, for the same reason the bar
is, and the `.siteHeader` row inside it keeps `--shell` so the logo still starts at the `<h1>`'s x.
Its vertical padding drops from 1.5rem to 0.85rem: a band that never leaves is height taken off every
screenful. `html:has(body.doc)` takes a `scroll-padding-top`, or the skip link and every in-page
anchor land on a heading the band is sitting on. `contentPages.test.ts` pins the sticky, the nesting
and the scroll padding.

The bar is written in `content.css` rather than shared with `GamePage.astro`. That copy has two jobs
this one does not — vanishing on `data-seated`, and keeping the whole page inside one viewport — and two
short rulesets that look alike beat one that has to be true of both.

**Privacy and terms sit at the right-hand end of both bars**, apart from the five: it is not a page
anybody came to read, it is the one that has to be findable from anywhere. On the home page that
meant giving the row three grid columns, because pushing one item right with `margin-left: auto`
inside a centred flex row drags everything else to the left edge; under 46rem the three collapse to
one so the five links do not wrap to five lines.

**And a way back up.** These pages are long and their navigation is pinned to the *bottom*, so the
return trip was a full scroll or a key a phone does not have. `.toTop` appears once the reader is
about a screenful down, above the bar and out of the column. It is `hidden` in the markup and
revealed by `theme-boot.ts` for the same reason the theme switch is: without a script it could
neither know it was wanted nor animate the return, and that reader still has the browser's own way
home. The `href="#top"` is real, so the control works even if the handler does not; the handler only
adds the smooth scroll (skipped when the system asks for reduced motion — there is no `data-motion`
here, that attribute is the game's) and moves focus back to the skip link.

`body.doc` also puts text selection back: the reset in `Base.astro` disables it for the board, where
dragging a card must not select the table, and a page of rules nobody can quote is a different kind
of broken.

### The phone: one burger, one drawer, both halves of the site

The bar above is right wherever its ten items fit on one line. Under 46rem they do not. It folded
into two rows of 12px text, jammed together at a 0.15rem gap, with **nothing on it taller than the
type** — six links, a legal link whose French label is 28 characters, and two icons, all sharing one
strip a thumb has to hit. Every fix that kept the bar made it worse: bigger targets pushed it to
three rows, and three rows of navigation on a phone is a third of the screen spent on getting
somewhere else.

So under 46rem the bar goes entirely and everything it held moves into a **drawer behind one burger,
top left**. The same control, in the same corner, on the content pages and on `/`:

- **Content pages**: the burger sits in the header, the drawer carries `Play`, the five pages,
  privacy, the theme switch and the globe — the whole bar, in order, as rows of 2.75rem.
- **The game page**: the burger is fixed over the board at the offsets `Lobby.module.css` gives
  `.topBar`, so it lands on the line the gear, the speaker and the "?" already sit on. The drawer
  carries the five pages, privacy, and then the prose the wide screen's sheet holds. **No `Play`** —
  this is where playing happens — and no theme or language, which are behind the lobby's own gear.
  The footer row costs the board no height at all at that width.

Both are `popover="auto"`, so Escape and a tap outside close them with **no script**, which is the
constraint these pages are built under. Four things about that are easy to get wrong, and three of
them fail silently:

- **`display` belongs on `:popover-open` and nowhere else.** A closed popover is hidden by
  `[popover]:not(:popover-open) { display: none }` in the UA stylesheet, and *any* author `display`
  on the element beats it — cascade **origin**, not specificity. `.navPop { display: flex }` left the
  drawer standing open over every page at every width. `.langPop` gets away with declaring none.
- **Height has to be stated.** The UA gives a popover `height: fit-content`, so `top: 0; bottom: 0`
  alone left the drawer stopping at its last link with the scrim carrying on underneath.
- **The bar may only be hidden inside `@supports selector([popover])`.** Without the API the drawer
  is an ordinary `<div>` in the middle of the page and the burger opens nothing; hiding the bar there
  would leave the page with no navigation whatsoever. Both the burger and the drawer are hidden in
  the `@supports not` branch instead, and the bar stays at every width — which is what the file did
  before the drawer existed.
- **Widening the window has to close it.** CSS cannot close a popover: drag a window out, or turn a
  tablet on its side, and the drawer stands over a page whose own bar is already showing underneath,
  with the button that closes it no longer on screen. `content/navMenu.ts` is the exception to these
  pages running no behaviour — one `matchMedia` listener calling `hidePopover()`, imported by
  `theme-boot.ts` for the content pages and by `homeSheet.ts` for `/`. It holds a **second copy of the
  46rem breakpoint**, which `contentPages.test.ts` asserts against the one in `content.css`.

Both renderings of the navigation are built from `NAV` and `LEGAL`, so the bar and the drawer cannot
list different pages; only one is ever on screen. That does put the same links in the document twice,
which is ordinary — a site with a header nav and a footer nav does the same — and it is why
`seo.spec.ts` scopes its home-page assertions to `.homeLinks` rather than to `.homeIntro`. The home
page's prose is rendered from `content/HomeProse.astro` for the same reason: the sheet and the drawer
are two presentations of it, not two copies.

The drawer's own prose is the only part of it `GamePage.astro` styles. Everything else — the panel,
the heading, the rows, the settings row — is `content.css`, so the two menus are one design.

### The white flash, and the switch

`tokens.css` used to key its dark palette on `[data-theme='dark']` and on nothing else. That
attribute is written by a script; a content page is a render-blocking stylesheet and a deferred
module, so the browser painted the light palette first and the module flipped it a frame later. On a
dark system, every step between two pages was a white flash.

The fix is CSS: the same palette, a second time, behind `@media (prefers-color-scheme: dark)` scoped
to `:root:not([data-theme='light'])`. The browser knows both at parse time, so the first frame is
already right, and the `:not()` is what keeps a stored choice above the system — once the script has
written an explicit `light`, the media query stops matching. Duplicating a palette inside the file
that calls itself the single source of truth is not free, and it is deliberate: CSS cannot add a
selector to a rule conditionally, and `light-dark()` would mean rewriting every token in the file
against a baseline two years old. `themeFlash.test.ts` compares the two blocks declaration by
declaration, so they cannot drift apart in silence.

What is left for the script is the stored choice and the switch itself — one button in the footer
bar, beside the globe. It is `hidden` in the markup and `theme-boot.ts` reveals it: with no
JavaScript it could neither persist a choice nor repaint, and a dead control is worse than none now
that the media query gives that reader the right theme anyway. It writes `loco_theme`, the key
`useTheme` reads, so a choice made on the rules page is the one the game opens with.

### The language chooser is a popover

`English` / `Français` sat in the bottom-right corner as raw text. It is a globe button and a modal
now, and the modal is a **native `[popover]`**: Escape and a click outside both dismiss it with no
script on the page, which is the constraint these pages are built under (`<dialog>` would need one).
The globe is drawn SVG, never `🌐` — same rule as the game's preference icons, and for the same
reason: an emoji is a different object on every platform.

In the bar the globe stands **alone**: the language name that used to sit beside it named the
language the reader was already reading, so it restated the page and added a third run of 12px text
next to the theme switch and the privacy link. The names belong on the two links inside the panel,
where the choice is actually made. The button keeps its `aria-label`, which is what a control with
no text owes a screen reader. The drawer's copy of the button keeps its label, because there it is a
row in a list of rows and an unlabelled icon in that column would be the only one.

It also carries its own **✕**, because the two native dismissals are both invisible and neither is
reachable on a phone: there is no Escape key, and the panel is centred on a scrim whose "outside" a
thumb has to find. The button is `popovertarget="langPop" popovertargetaction="hide"`, which is the
same native control in the other direction and therefore still costs no script — `seo.spec.ts`
presses it inside the JavaScript-disabled block. The `popover` attribute is written `popover="auto"`
in full rather than as a bare word: an invalid value on that attribute falls back to the *manual*
state, which silently has neither Escape nor light dismiss, and the failure looks exactly like a
panel that will not close.

What must not change is what is inside it. Both languages are ordinary `<a href>`s carrying
`hreflang` and `lang`, present in the document whether the panel is open or not, because a popover
hides its contents rather than withholding them — a crawler that has never heard of the API still
follows the link, and `seo.spec.ts` still finds it under `footer a[href$=…]` with scripts disabled.
`@supports not selector([popover])` degrades the panel to the row it would have opened, so a browser
without the API shows both languages in the bar rather than losing the switch.

The exceptions run the other way, and they are the point of the whole arrangement:

- **The rules page maps `t.rules`**, the same array `RulesModal.tsx` maps. It is not a copy: a rule
  reworded for the modal is reworded on the page in the same edit. `contentPages.test.ts` asserts
  both still map it.
- **`t.cardNames`** was added because `cardLabel()` only ever returns a glyph (`⊘ ⇄ +2 W +4 ⇋ ↻`)
  and the names existed nowhere but buried in the sentences of `t.rules`. Nothing could name a card
  in a table or a heading. It lives in the i18n bundle because the game has a use for it too.
- **The deck table is a second statement of facts the server owns**, which is the drift risk this
  page carries. `contentPages.test.ts` therefore reads `server/game/deck.go` and counts the deck it
  builds, and reads `server/game/card.go`'s `CardValue` and compares every point value. A scoring
  change made server-side without touching the page goes red.

The names in that table deliberately do **not** come from `docs/rules.md`: that file is the
implementation spec, still calls these by their SOLO names ("Miss a Turn", "Change Cards All Round")
and still describes a 600-point threshold that `CLAUDE.md` §14 abandoned. Only §2's composition and
§10's values were taken from it.

Every cell is `white-space: nowrap` and the wrapper scrolls. Letting the last column wrap is the
obvious-looking choice and is wrong on a phone: the narrow columns hold their width, the last absorbs
the whole squeeze, and every row grows to three or four lines.

### The cards page draws the real cards

`<Card />` is rendered with no client directive, so Astro turns the game's own component into static
markup at build time: the card on the page is the card in the hand, gradient, mark and glyph
included, and the page still ships no React. Its face is sized in container-query units against the
element, so passing a width and height as a style is all it takes to draw one bigger. This is why
`CardArt.tsx` importing no CSS module mattered enough to check before the migration.

36 numbers, 16 actions and 3 wilds: the deck without its duplicates, which is what a reference wants.
Rows scroll rather than wrap, because nine numbers in a suit are one run and a wrapped run reads as
two suits. The E2E counts row children rather than `<svg>` elements: one card draws several.

Each entry carries an `effect` sentence of its own rather than the matching line of `t.rules`. That
line is a rulebook bullet read in sequence ("Skip: the next player loses their turn."); this one is
read alone by somebody who arrived looking for one card. Mapping a kind to a bullet would mean
parsing a name out of a sentence, which breaks on the first rewording. The *facts* are not
duplicated: copies and points still come from `DECK` and are still checked against the server.

### The tables page

Names and taglines from `t.maps`, art from `MAPS` — the same copy the loading screen shows and the
same registry the board paints from. The room and the table are composited exactly as the board
stacks them, and the room's own `accent` is the frame's inner outline, so the border belongs to the
picture rather than to the page. All but the first pair are `loading="lazy"`: the page is eight large
photographs and one of them is on screen when it opens.

### The FAQ is data first

`FAQPage` is the one structured-data type on this site that can put content **directly** into a
result rather than decorate one, which is the whole reason a FAQ page earns its place: the questions
*are* the queries. So `src/content/faq.ts` is the schema.org payload and the page is rendered from
it, not the other way round — a question answered in the markup and not in the data, or the reverse,
cannot happen. The E2E parses the emitted `ld+json` and checks every question it declares is on the
page.

Every answer describes behaviour the server actually has: the 60-second hold on a dropped seat (15
in a matchmade 1v1), the turn clock and its four-timeout limit, the bots, the 2-to-10 range. That
makes the file a promise as much as copy, and one of the places that has to change when those do.

The friends page reuses three of those entries rather than answering them a second time. It leads
with three numbered steps because the order *is* the answer: whoever lands there is trying to get a
game going right now, not browsing a feature list.

### The footer under the game

`/` and `/fr/` are the pages everyone links to, and until this they had nothing to index. Markup that
Astro renders answers that: what LOCO is, the three things that make it different, and links to every
content page. It is in the served HTML, so it is read without running a script — and those links are
the **only** path from the game to the rest. The sitemap lists them; a link is what carries weight
between them.

It was a block under the fold, and that was the wrong shape. Nothing else in this game is reached by
scrolling, the entry screen is one viewport by design, and parking two hundred words below it made
the home page behave like a site that happened to have a game at the top. So the page is now exactly
one viewport, always: `body` is a flex column, `#root` takes what is left, and the footer is a quiet
row of links at the bottom. The prose moved into a sheet the row opens.

That sheet is a native `<details>`, not a React modal, and both halves of that matter. It is markup,
so the prose stays in the served HTML where a crawler reads it — content inside an expandable section
is indexed normally, and the alternative (the copy in `i18n/`, rendered by a component) would put it
behind a script *and* grow the bundle every player downloads. And it opens with no JavaScript at all,
which `seo.spec.ts` proves by clicking it in a context with scripts disabled. `src/homeSheet.ts` adds
only Esc and a click on the scrim; the sheet is fully usable without it. Open, the `<summary>` is the
close button, because a native `<details>` has exactly one control and a second one would need a
script to work.

Under 46rem none of that row is on screen: the burger described above replaces it, and the drawer
carries both the links and the prose, links first. The sheet is still the wide screen's half — one
control, one presentation each — and `HomeProse.astro` is what the two of them render, so they cannot
end up describing the game differently.

The footer disappears the moment a seat is taken. That is not React's to do — it is markup Astro
rendered — so `App.tsx` writes `data-seated` on `<html>` and CSS hides it. The burger and the drawer
sit inside that same element, so a seat takes them with it. The body no longer needs
`overflow: hidden` restoring, because it never lost it: a board that can be scrolled off-screen
mid-match is a bug, and now so is a lobby that can. `appSubscription.test.tsx` owns the attribute,
`seo.spec.ts` owns the CSS and the no-scroll guarantee.

### Zero JavaScript, with one exception

`<LocoLogo />` is a React component rendered with **no client directive**, so Astro turns it into
static markup at build time and ships none of React: the mark on the page is the mark in the game
rather than a redrawn copy, and it costs nothing to load.

The exception is `src/content/theme-boot.ts`. `tokens.css` keys its dark palette on
`[data-theme='dark']` and on nothing else, which is written by JS — so without it a player who chose
the dark theme and then tapped "Rules" landed on a bright white page. It imports `src/theme.ts`,
which was split out of `hooks/useTheme.ts` precisely so this does not drag React onto a page that
mounts nothing. `useTheme` re-exports it, so there is still one definition of what the theme is.

That file also wires the back-to-top button and calls `closeMenuWhenWidened()`, and it is the same
file on purpose: there is only ever **one** script on these pages, so a second behaviour is a few
more lines rather than a second request and a second thing to remember when counting what a content
page loads. `content/navMenu.ts` is a module both that script and `homeSheet.ts` import; it is not a
third request.

### The link out of the modal

`RulesModal` links to the page, `target="_blank"`, and the target is the whole point rather than a
preference: the modal opens mid-match, and following the link in place would unload the document,
drop the socket and cost the seat. The href comes from the page registry, which is why `meta.ts`
reads `process.env` through a `typeof` guard — a bare access throws "process is not defined" in a
browser, and hardcoding the URL beside the registry is exactly the drift the registry exists to stop.

## Images and icons

`make og` renders the preview card in both languages (`og.png`, `og.fr.png`), `make icons`
rasterises `favicon.svg` into the manifest sizes plus a `favicon.ico`. Both commit their output for
the same reason: CI builds the client with `npm run build` and has no browser.

`favicon.ico` is a 6-byte directory, one 16-byte entry and the PNG bytes verbatim — every browser
since Vista reads a PNG payload directly, so there is no re-encoding and no dependency. It exists
because crawlers and feed readers still request that exact path and read a 404 as "no icon".
