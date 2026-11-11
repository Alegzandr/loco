# Being findable: what is indexable, and what it is worth

## The premise

LOCO! has no brand demand to harvest, so search can only answer the descriptive queries — the "free
online card game with friends, no signup" family — currently served by thin, natively optimised
sites that are beatable on quality, but only with pages. The ceiling of the pages is real but
bounded. **The unbounded part is off-site and is not an SEO task**: a table link that opens a game in
one click from a Discord paste, an IGDB entry so Twitch has a category, browser-game directories.

Two constraints on every page:

- **A content page never says UNO.** The disclaimer that names the mark is only true while no other
  player-facing string carries it, and an indexed page is player-facing. `legal.test.ts` asserts it
  over the i18n copy; `seo.test.ts` over `PAGES`, `UI` and every file under `src/content/` except
  `legal.ts`, which carries the disclaimer. It costs the category's biggest keyword, knowingly: LOCO!
  cannot outrank Mattel on Mattel's name anyway.
- **The voice is the game's** (`client.md`): players open a **table**, French is tutoiement, a page
  explains rather than sells.

## The registry is the single source

`client/src/seo/meta.ts` holds `PAGES`: each page once, with path, title and description **per
language**. The sitemap, the `hreflang` sets, the canonical and `src/test/seo.test.ts` all read it,
because every failure here is silent: a page declared but never built, a `hreflang` set that does not
point back, two pages sharing a title — each surfaces months later as "the French page never got
indexed".

`seo.test.ts` asserts: a non-empty title and description in every language, none repeated (the same
string in both languages means one was never translated), every path distinct and slash-terminated,
and **every declared path has a source file behind it** — a page in the list and not on disk hands
Google a sitemap URL that 404s.

The registry is also imported in the browser (`state/tableInvite.ts` reads `HOME`, `DEFAULT_LANG`),
which is why `meta.ts` reads `process.env` behind a `typeof` guard: a bare access throws in a browser.

## URLs

English at the root, French under `/fr/` (`src/routes/(game)/fr/`, `src/routes/(content)/fr/`). The
game stays at `/`: it is the address people paste.

`trailingSlash: 'always'` (`src/routes/+layout.ts`). The build emits directories and nginx serves
`/fr/index.html` at both `/fr` and `/fr/`; pinning the slashed form makes the canonical, the sitemap
and `hreflang` name one URL. **Never fix the duplicate with a redirect on a `try_files` miss**: `/nope`
has no directory either, and goes `/nope` → `/nope/` → `/nope//` forever. The canonical resolves it.

## hreflang

Reciprocal by construction: both sides come out of the same `PageDef`, and Google ignores a set whose
pages do not point back at each other. One `x-default`, at the default language. The head links
(`layouts/Head.svelte`) are what Google reads most reliably; the sitemap (`src/seo/sitemap.ts`,
`sitemap-0.xml` with the `xhtml:link` pairs, prerendered by `routes/sitemap-0.xml/+server.ts`) is how
it discovers. Both are built from the registry, so every page carries both alternates.

## The language the page was served as

A French URL must open in French even in an English browser. The page declares itself with
**`data-served-lang`**, which `chooseLang()` (`src/lang.ts`) reads after a stored choice. **Never
`<html lang>`**: the i18n provider writes it, so reading it back detects the app's own last output
(and in jsdom leaks one test's language into the next). `i18n.test.ts` pins the three cases: the URL
beats the browser, a stored choice beats the URL, `<html lang>` is never an input.

### Except at `/`, where the browser decides

`/` is the root and the canonical English page at once, and a visitor arriving there has said
nothing, so `navigator.language` outranks the served language there and only there. Everywhere else
the URL is the request.

**It is not a redirect.** Google's multilingual guidance asks sites not to redirect on presumed
language, and a crawler session with a French locale would see the root canonicalising itself away.
It is a client-side navigation (`src/langRoute.ts`, [`client.md`](client.md)) replacing the history
entry. A crawler asking for `/` gets the English page with its self-referential canonical and its
`hreflang` pair. The destination is a real emitted page, so a reload or a shared link reproduces it.
**Nothing is persisted**: a stored value is a choice, a choice outranks the URL, and persisting a
detection would make every French link that player is later sent open in English.

## The two hosts

Production is `ohloco.com`, development `loco-d.kisukesaama.com`, declared once each as `PROD_HOST`
and `DEV_HOST` in `.gitlab-ci.yml`; everything else reads `APP_HOST`.

`APP_SUBDOMAIN` (`loco`) **names the stack, not the address**: compose project, Traefik router,
internal network, deploy directory. Never derive a host from it or use it as a hostname.

**The dev host keeps its `-d.` prefix.** `client/nginx.conf` keys `robots.txt` on `~*-d\.`, and it is
all that keeps dev out of the index: a dev host without it falls into the `default` branch, invites
crawlers and advertises a sitemap naming the wrong origin. `seo.test.ts` pins the branch; nothing can
pin a host name that does not exist yet.

## The apex is canonical and `www.` is a redirect

`www.ohloco.com` is only a 301 to the apex, done at the edge (a Cloudflare redirect rule), reaching
neither Traefik nor nginx. One of the two must be canonical or the duplicate splits authority; the
apex is short, fits a stream overlay, and is what people type.

The quiet failure: an origin carrying `www.` while the redirect points the other way makes every
canonical, `hreflang` and sitemap entry name a redirect, which Google reports as an invalid canonical
while both URLs load fine for humans. `seo.test.ts` asserts `ORIGIN` has no `www.`; the redirect rule
is documented in `docs/deployment.md`. (When last measured, the `www.` DNS record did not exist at
all; nothing here points at it, so it costs only a typed hostname, and the fix is at the edge.)

## The origin is decided at build time

Crawlers run no JS and never fetch a relative `og:image`. `VITE_PUBLIC_ORIGIN` feeds both
`vite.config.ts`'s `site` and `meta.ts`'s `ORIGIN`, defaulting to production. `client/Dockerfile`
takes it as an `ARG` and `.gitlab-ci.yml` passes `https://${APP_HOST}` (`DEV_HOST` on `develop`,
`PROD_HOST` on a `v*` tag); without it the dev image would name production in its canonical and
`og:url`.

## What nginx has to agree with

- **`robots.txt` from `$host`**: production allows indexing and advertises `sitemap-index.xml`; `-d.`
  hosts disallow everything and advertise **no** sitemap (disallowing while pointing at one is a
  contradiction crawlers report).
- **`try_files $uri $uri/ =404` plus a real `404.html`**, never a fallback to the game: a 200 for any
  URL is a soft 404, an error to Google and a hiding place for real broken links. The 404 is
  `noindex` with no canonical. It is drawn like the game (the mark as a way home, a hand of four
  `<CardBack />`s, two ledged controls: a table, the other language), prerendered with `csr = false`,
  so it ships **no JavaScript at all** and depends on nothing the build might not have emitted. It
  builds to `404.html` (`trailingSlash = 'never'` on that route).
- **`gzip`** on text, JS, JSON, XML and SVG only; webp and woff2 are already compressed.
- **`Cache-Control: immutable`** for a year on `/_app/immutable/` (content-hashed), and not on the rest
  of `/_app/`: `version.json` has a fixed name and must stay fresh.

`seo.test.ts` asserts each against `nginx.conf`: nothing else meets that file (the E2E dev server
sends none of it).

### Redirects name a path, never an origin

`nginx.conf` declares no redirect, but `try_files $uri $uri/` resolving `/fr` to a directory makes the
static module answer `301` to `/fr/`, and by default (`absolute_redirect on`) it writes
`$scheme://$host/fr/`. **`$scheme` is `http` for every request this container sees**: TLS ends at
Cloudflare and again at Traefik, and the hop to nginx is plain HTTP. So `https://ohloco.com/fr` was
answered `http://ohloco.com/fr/`, out of https and back only if the edge upgraded it — one dashboard
toggle away from an `ERR_TOO_MANY_REDIRECTS` loop.

| URL | `absolute_redirect on` | `absolute_redirect off` |
| --- | --- | --- |
| `/fr` | `301 → http://ohloco.com/fr/` | `301 → /fr/` |
| `/privacy` | `301 → http://ohloco.com/privacy/` | `301 → /privacy/` |
| `/fr/confidentialite` | `301 → http://ohloco.com/fr/confidentialite/` | `301 → /fr/confidentialite/` |

**`absolute_redirect off;`**: the client keeps its scheme and host, and the chain is one hop. Rejected:

- **An explicit `rewrite ^(.*[^/])$ $1/ permanent;`** — the `/nope//` loop above.
- **Rebuilding the scheme from `X-Forwarded-Proto`** — every redirect would trust a header a client
  writes itself when it reaches Traefik bypassing the CDN, the trust problem `privacy::client_net`
  keeps out of address handling. A relative `Location` needs to know nothing.
- **Relying on the edge's "Always Use HTTPS"** — not in this repository, not tested here.

`client/src/test/redirects.test.ts` reads the emitted page tree, replays every public URL (both
spellings, `PAGES` plus the invitation) through a model of nginx's rules and an edge that upgrades
plaintext, and fails on a chain that revisits a URL, leaves https, or ends anywhere but an existing
page. With `absolute_redirect on` it fails 17 of them.

## Titles and descriptions have a length

A title past ~60 characters and a description past ~155 are cut mid-word in results. `seo.test.ts`:
title ≤ 60, description 100–155, both languages. The floor matters too: Google rewrites a thin
description, and then authors the pitch. French runs ~15% longer, so it is **written to** the ceiling,
not translated into it.

## The home page's `<h1>` is served markup, and it is not the wordmark

`/` is a game, and the logotype is a drawing (`role="img"`), so without help a crawler sees no
heading on the most important URL. The game's layout (`routes/(game)/+layout.svelte`) serves one
`<h1>` in text with `.sr-only` (`tokens.css`) before anything mounts, in words somebody would type —
never the word LOCO alone. `.sr-only` clips rather than `display: none`, so screen readers get it too.

**It stays the only one**: app screens (`Lobby`, `Searching`, `MapLoadingScreen`) head at `<h2>`, and
`seo.test.ts` fails on an `<h1>` under `src/components/`. Googlebot renders JS, and a second `<h1>`
mounting later makes the descriptive one lose.

## Structured data

`VideoGame` + `WebSite` + `WebPage` on the game pages, stating what this category is searched on: free,
and playable by a group in a browser.

- **Free is `isAccessibleForFree`, never an `Offer`.** `offers`, `applicationCategory` and
  `operatingSystem` make a validator treat the `VideoGame` as a `SoftwareApplication`, which then
  requires `aggregateRating` — ratings nobody has left. `seo.test.ts` fails on those four property
  names.
- **A content page is a `WebPage`, never an `Article`.** `Article` requires `author`, `datePublished`
  and `image`, which this site has no honest value for: no editorial identity ([`legal.md`](legal.md)),
  evergreen pages.
- What renders in results is the **breadcrumb** (`LOCO › Rules` in place of the URL) and the FAQ's
  `FAQPage`. The FAQ's `FAQPage` replaces its `WebPage` node and still reads `breadcrumbJsonLd`.
- **Every node joins the one `#website` and `#game`** the home page declares, so a crawler reads one
  entity across pages. The `@id`s are strings on both sides, so a typo is silent; the test compares
  them.

The block is written inline by `layouts/Head.svelte`, `<` escaped so no string closes the element.
`script-src` does not apply to a non-JavaScript MIME type: the block is data and never executes.
`csp.test.ts` refuses every other hand-written inline script.

## The content pages

`src/routes/(content)/+layout.svelte` is the shell; `src/content/` holds the prose and data and is
**never imported by the app** — `en.ts` and `fr.ts` are already shipped to every player.

### The shell

**One width.** `--shell` is declared once on `.page`; header, column and bar all take it, so the
logo, the `<h1>` and the bar's text start at the same x. Only the lede and the body measure set their
own max-width (reading, not alignment).

**Flat canvas, opaque chrome.** `body.doc` paints `--color-canvas` and nothing else; no gradient, no
`background-attachment: fixed`. The header band and the bar are **opaque canvas**: backdrop blur
belongs to the modal scrim alone (DESIGN.md's No-Glass Rule). `contentPages.test.ts` fails if either
comes back. **The landings are flat: the den's gradient and colour orbs behind content pages are
refused — a landing is a page to read, and glow behind prose competes with it.** `/` (`#root`) and the
404 (`.page`) are flat for the same reason.

**The prose sits on the game's panels**: every top-level `<section>`, FAQ entry and room is the game's
card (`--color-surface-card`, ink outline, `--shadow-pop`, `--radius-xl`). Raised things inside a panel
(deck tables, the live page's steps, card entries) drop to the sunken slot treatment, so a ledge never
stands on a ledge; the friends page's opening steps keep their own panels. The header's `Play` and the
live page's link to the Twitch category are `Lobby.svelte`'s primary button (`.cta`, `.btnPrimary`):
it is the one thing on the page somebody came to press.

**The header stays.** `.headerBar` is `position: sticky` (first child of the flex column, so it costs
nothing and `--bar` remains the only reserved room), full-width, opaque, its `.siteHeader` row on
`--shell`, vertical padding 0.85rem. It carries the mark back to `/`, `Play`, and under 46rem the
burger. `html:has(body.doc)` takes a `scroll-padding-top`, or the skip link and every anchor land under
the band. `contentPages.test.ts` pins the sticky, the nesting and the scroll padding.

**One bar for the whole site** (`layouts/SiteFooter.svelte`, one ruleset in `content.css`, rendered by
both layouts): same destinations, **privacy at the right-hand end in `.footerEnd` beside the globe**,
the hairline, opaque canvas. Each page passes its left-hand end: `Play` on a content page, the sheet
of prose on `/`. On a content page it is `position: fixed` and the column reserves `--bar` of bottom
padding; on `/` it is in the flow (`.onHome`), closing the one viewport, and unpositioned so the
game's panels open above it. **The two are one height** (the closed sheet's `<details>` is a flex box,
or it takes the body's line box and adds 8px), and `view-transition-name: site-footer` holds the bar
still across the router's cross-fade (`routes/+layout.svelte`). The seated case is one rule in
`GamePage.css` (`:root[data-seated] .siteFooter.onHome`).

**A way back up.** `.toTop` (`layouts/ToTop.svelte`) appears about a screenful down, above the bar. It
ships `hidden` and is revealed on mount; `href="#top"` is real, so it works without the handler. The
handler adds the smooth scroll and moves focus to the skip link with **`focus({ preventScroll: true })`**:
`.skip` sits far off-screen, and focusing it without that scrolls instantly, cancelling the smooth
scroll in flight.

**Anchors glide.** `scroll-behavior: smooth` on the scrolling element covers fragment links, the skip
link, `#top` and `scrollTo`. It hangs off `html[data-scroll="smooth"]`, written live by the content
layout from the system preference, because `@media` on that preference is refused client-wide
(`reducedMotionCss.test.ts`) and `data-motion` is the game's. Without a script nothing glides, the
safe fallback. `contentPages.test.ts` pins both halves.

`body.doc` restores text selection, which `styles/base.css` disables for the board.

### The phone: one burger, one drawer

Under 46rem the bar's ten items do not fit one line, and every version that kept the bar either missed
thumbs or spent a third of the screen. So under 46rem the bar goes and everything moves into a
**drawer behind one burger, top left**, the same component on the content pages and on `/`
(`layouts/SiteDrawer.svelte`):

- **Content pages**: the burger in the header; the drawer carries `Play`, every page, privacy and the
  globe, as 2.75rem rows.
- **`/`**: the burger fixed over the board on the line the chip row sits on (`Lobby.svelte`'s
  `.topBar` offsets). No `Play`; `home` swaps it for the `About` row (`#navAbout`, which opens the
  sheet) and adds the `Preferences` action (`#navPrefs`). It ends on the same globe as every drawer.

**The drawers differ in their list and nothing else.** No prose inside a drawer: a menu is a list of
destinations, and the prose keeps its own control, the sheet.

**Both open on the wordmark and carry exactly one action** (`.navPopCta`): `Play` where you are going,
`Preferences` what you came to change. The head is `<LocoLogo />` inside a **`<div class="navPopTitle">`,
never a `<p>`**: the logo renders a `<div>`, the parser closes the paragraph before it, and the mark
becomes a sibling that `space-between` centres wrongly (`mobile.spec.ts` measures the rendered box).
Scope the action as `.navPop .navPopCta`: `.navPopLinks a` (class + type) beats a bare class.

`#navPrefs` ships `hidden` and is revealed on hydration (`hidden={!hydrated}`): the panel belongs to
the game. It closes the popover and dispatches `loco:preferences`, which `<Preferences />` listens for
— an event, because the drawer is the page's and the panel the root layout's, and neither is in the
other's tree.

Both are `popover="auto"`, so Escape and a tap outside close them with **no script**. Five ways to get
it wrong, four silent:

- **`display` belongs on `:popover-open` only.** Any author `display` beats the UA's
  `[popover]:not(:popover-open) { display: none }` (cascade origin, not specificity), and the drawer
  stands open on every page.
- **Height must be stated.** The UA gives a popover `height: fit-content`; `top: 0; bottom: 0` alone
  stops the drawer at its last link.
- **The bar may only be hidden inside `@supports selector([popover])`.** Without the API the burger
  opens nothing; in the `@supports not` branch the burger and drawer hide and the bar stays.
- **The bar is hidden with `display: contents`, never `display: none`.** `#langPop` lives in the
  footer, and a `none` ancestor removes its subtree from rendering even in the top layer, so the
  phone's only language switch would show nothing. The rows (`.footerPlay`, `.footerNav`,
  `.footerEnd`) go; the `<footer>` stays as a box-less wrapper. Same trap for anything else moved
  into that element.
- **Widening the window closes it.** CSS cannot close a popover; `SiteDrawer.svelte` calls
  `hidePopover()` from a `matchMedia` effect (checked once on arrival, since the native drawer can open
  before hydration) and after every navigation (`afterNavigate`). That **second copy of the 46rem
  breakpoint** is asserted against `content.css` by `contentPages.test.ts`.

Bar and drawer are both built from `NAV` and `LEGAL`, so they cannot list different pages; the links
are in the document twice, which is why `seo.spec.ts` scopes home-page assertions to `.footerRow`.
**`GamePage.css` styles no part of the drawer**: a `.navPop*` rule there is a divergence by definition.

### One palette

The site has one palette (`visual.md`, "One palette"): nothing keys on a theme and
`noLightTheme.test.ts` fails on any theme machinery.

### The language chooser is a popover

A globe button (drawn SVG, never `🌐`) opening a native `[popover]`: Escape and an outside click
dismiss it with no script (`<dialog>` would need one). In the bar the globe stands **alone** with an
`aria-label`; the language names belong on the two links inside the panel. In the drawer it keeps its
text label, as a row among rows.

It carries its own **✕** (`popovertarget="langPop" popovertargetaction="hide"`, still no script;
`seo.spec.ts` presses it with JavaScript disabled), because a phone has neither Escape nor an easy
"outside". Write **`popover="auto"` in full**: an invalid value falls back to `manual`, which has
neither dismissal and looks like a panel that will not close.

Both languages are ordinary `<a href>`s with `hreflang` and `lang`, in the document open or shut
(a popover hides, it does not withhold), so crawlers follow them and `seo.spec.ts` finds them under
`footer a[href$=…]` with scripts off. `@supports not selector([popover])` degrades the panel to the
row it would have opened.

### Pages that restate what the game knows

- **The rules page maps `t.rules`**, the same array `RulesModal.svelte` maps; `contentPages.test.ts`
  asserts both do. It opens on `content/contrasts.ts`, whose numbers come from the server.
- **`t.cardNames`** names every card (`cardLabel()` only returns a glyph); it lives in the i18n bundle
  because the game uses it too.
- **The deck table restates facts the server owns.** `contentPages.test.ts` reads
  `loco-game/src/deck.rs` and counts the deck, and compares every point value with `card.rs`'s
  `card_value` (through `src/test/serverSource.ts`). A server-side scoring change goes red here.
- Card names do **not** come from `docs/rules.md`, which keeps SOLO's names ("Miss a Turn", "Change
  Cards All Round") and describes SOLO's 600-point game that its §14 replaces; only its §2
  composition and §10 values are used.

Every table cell is `white-space: nowrap` and the wrapper scrolls; wrapping the last column on a phone
grows every row to three or four lines.

### The cards page draws the real cards

`<Card />`, prerendered: the card on the page is the card in the hand, in the served HTML. Its face is
sized in container-query units, so a width and height are all it takes. 36 numbers, 16 actions and 3
wilds — the deck without duplicates. Rows scroll rather than wrap (nine numbers in a suit are one
run). The E2E counts row children, not `<svg>`s (one card draws several). Each entry has its own
`effect` sentence, written to be read alone; copies and points still come from `DECK`, checked
against the server.

### The tables page

Names and taglines from `t.maps`, materials and accents from `MAPS`, hours and skies from the lists
the server draws from: nothing describes a room twice.

**Each room is a photograph of the render, with nothing over it.** A content page cannot render the
room, so `make rooms` (`tools/rooms/shoot.mjs`) opens each `room-still-<id>` showcase scene at the
room's signature hour, 16:9, table included, and writes `src/assets/rooms/<id>.webp`, committed
because CI has no browser. The page serves it through `@sveltejs/enhanced-img` (three widths, lazy,
the hour's sky gradient behind it while it loads); `.roomTable` / `.roomGlow` are drawn only when a
still is missing. `roomsPage.test.ts` pins the hour on the page to the hour shot and fails on a room
with no still; the E2E counts six.

**Hours and skies are two named rows of values, not chips**: a definition list (label then plates;
label above its row under 46rem), so a wrap on a phone never leaves "Ciel dégagé" with nothing saying
the subject changed. Nothing is pressable, so nothing wears the ink outline and ledge; the plates are
filled. Labels are the page's (`tablesHours` / `tablesSkies` in `content/ui.ts`), values the game's.
`roomsPage.test.ts` fails on a plate with a border or ledge, or a label written into the markup.

### The FAQ is data first

`FAQPage` can put content directly into a result, and the questions are the queries. So
`src/content/faq.ts` is the schema.org payload and the page renders from it; the E2E parses the
emitted `ld+json` and checks every question is on the page. Every answer describes real server
behaviour (the 60-second seat hold, 15 in a matchmade 1v1; the turn clock and its four-timeout limit;
bots; 2–10 players), so **this file changes when that behaviour does**. The friends page reuses three
entries and leads with three numbered steps, because the order is the answer.

### The home page's prose: a sheet in the bar

`/` and `/fr/` are what everyone links to, so they carry prerendered prose — what LOCO! is, three
things that make it different, links to every content page (the only path from the game to the rest).
**The page is exactly one viewport**: `body.game` is a flex column, `#root` takes what is left, and the
bar closes it. The prose is in a sheet the bar's left-hand end opens.

The sheet is a **native `<details>`**: the prose stays in served HTML (content inside a disclosure is
indexed normally) and out of the bundle, and it opens with no JavaScript (`seo.spec.ts` clicks it with
scripts disabled). `routes/(game)/+layout.svelte` adds only Esc, the scrim click and the ✕, via
`bind:open` — never driving it. `HomeProse.svelte` is rendered once, in the sheet, and heads its
sections at `<h3>` under the sheet's `<h2>`.

**Open, it is the rules modal**: `components/RulesModal.svelte` is where every measurement comes from,
and `contentPages.test.ts` reads them off that file (desktop and phone halves). A player who opens
both meets one idea of a panel. Under 46rem that means the game's sheet (`client.md`). Three details
fail silently if undone:

- **The card is the `<details>` itself.** `<summary>` must be its first child, so `order: 1` sends it to
  the foot where the modal's button is.
- **The scrim is a sibling of the `<details>`**, never a child: a child `z-index: -1` scrim paints over
  the card's own background.
- **The ✕ ships `hidden={!hydrated}`**: the summary closes the sheet without a script, the ✕ cannot.
  `.homeSheetX[hidden] { display: none }` is load-bearing; its `display: flex` otherwise beats the
  attribute.

`:root:has(.homeSheet[open]) .homeBurger` takes the burger off screen while the sheet is up, or it
paints over the card's corner. Under 46rem only the *closed* sheet's button goes, so the sheet opened
from the drawer's `About` row still shows.

The bar and the burger vanish at a seat: they are the page's markup, so `App.svelte` writes
`data-seated` on `<html>` and `GamePage.css` hides both (no `data-seated` while the game is parked
behind a content page: `state/gameShown.svelte.ts`). A board or a lobby that can scroll is a bug.
`appSubscription.test.ts` owns the attribute, `seo.spec.ts` the CSS and the no-scroll guarantee.

### Readable with no script

A content page loads the router and its chunk (that is what makes the move to the game a navigation),
but **it is prerendered whole and reads the same with scripts off**: `<LocoLogo />`, every `<Card />`,
the drawer, the language panel and the prose are in the served HTML, the drawer and panel are native
popovers, and an article carries no effect, no `{@html}` and no inline script (`livePage.test.ts`,
`legal.test.ts`) — an effect draws nothing at prerender.

What a script adds belongs to the component that renders it, never to a script finding markup by
selector: `layouts/ToTop.svelte`, `layouts/SiteDrawer.svelte` (closing on a wider window),
`layouts/SiteFooter.svelte` (recording the language choice on the press),
`routes/(content)/+layout.svelte` (the smooth-scroll attribute), `content/LiveArticle.svelte` (the
live list). Every control only a script can honour ships `hidden` and is revealed on mount.

The live list is the one fetched thing: same-origin `/live.json`, so `connect-src 'self'` and
`img-src 'self'` are untouched; nothing built with `innerHTML`; deliberately not indexable, served
with a sentence instead of a spinner. See [`live.md`](live.md).

### `content.css` is loaded by the game, so nothing in it may be a bare element

Both route-group layouts import `content.css` (the game needs the bar, the drawer and the sheet), and a
loaded stylesheet stays loaded for the life of the document. A bare `table`/`th`/`td` rule there
styles the score table and the evening recap too (a bare `thead th` once put muted labels on ink at
2.2:1). Every content-page table is inside `.tableWrap`, and `contentPages.test.ts` fails on any bare
element selector in the file.

### No link out of the rules modal

`RulesModal` opens mid-match, and a link — in place or in a new tab — is an invitation to leave the
table. `rulesModal.test.ts` asserts zero links. What the deck page would be reached for is the modal's
own Cards half ([`client.md`](client.md)).

## Images and icons

`make og` renders the preview cards and `make icons` rasterises `favicon.svg` into the manifest sizes
plus `favicon.ico`. Both commit their output: CI has no browser.

Four preview cards: the site's (`og.png`, `og.fr.png`) and the invitation's (`og.invite.png`,
`og.invite.fr.png`). `make og` with no argument re-shoots all four, because a change to the mark or a
card face lands in every one. The invitation's line is `INVITE.ogTitle`, the same string as its
`og:title`.

**The scene is mounted on `/`, so `content.css` reaches into it.** Svelte scopes a component's own
selectors but not a global rule reaching in (a global `.brand` once turned the card's column into a
row). The card's classes are prefixed, and `ogCard.test.ts` fails on any class it shares with
`content.css`.

`favicon.ico` is a 6-byte directory, one 16-byte entry and the PNG bytes verbatim (every browser since
Vista reads a PNG payload); crawlers and feed readers still request that path.

## The page an invitation points at

`/i/?t=CODE` is what the waiting room hands out (`client.md` has the client half and why the code is a
query parameter). It is `INVITE` in the registry and **not in `PAGES`**: no `hreflang`, no navigation,
`noindex`, no canonical (a duplicate of the home document must not compete with it). Staying out of
`PAGES` keeps it out of the sitemap (`src/seo/sitemap.ts`); `src/test/invitePage.test.ts` runs the
sitemap to prove it.

It is a document of its own because an unfurler reads served HTML and runs no JavaScript: at `/?t=CODE`
an invitation could only preview as the home page. Its `<head>` is the invitation's; the game frame
(`routes/(game)/+layout.svelte`) renders it with no chrome — the bar, the sheet and the burger are the
indexable half of `/`, and this page is not indexed.

## What an audit sees

Accessibility failures here are properties of a *file* or a number nobody can eyeball, so
`client/src/test/a11y.test.ts` pins them against the source rather than waiting for a checker run on
a deployed URL.

### The wordmark is a logotype

axe reads `-webkit-text-stroke` as the text's colour, and the ink outline on the dark canvas scored
the wordmark 1.07:1. WCAG 1.4.3 exempts logotypes, but the tool does not:

- `<LocoLogo />` carries `role="img"` and `aria-label="LOCO!"`, the word `aria-hidden` (which also stops
  a screen reader reading it twice).
- **The word carries no stroke; `.word::before` paints the outline over it.** LOCO Red alone is 5.4:1
  on the canvas and passes, and the drawing is unchanged. `role="img"` and `aria-hidden` do not silence
  the check — it is about pixels.

`a11y.test.ts` asserts the outline on the pseudo-element and no stroke on the word.

### White on LOCO Red is 3.43:1

A pass for large text only (≥ 14pt bold, 18.66px). `.cta` and `.navPopCta` are 1.2rem; darkening the
brand red on the brand's own controls is the rejected alternative.

### The viewport never forbids zooming

The tag is `width=device-width, initial-scale=1.0, viewport-fit=cover` and nothing else;
`touch-action: manipulation` on `body` drops the double-tap and keeps the pinch. The board's pinch is
answered at the seat: under `:root[data-seated]` the reset is `touch-action: pan-x pan-y`, and
`client/src/pinchGuard.ts` refuses WebKit's `gesturestart` under the same attribute — two halves for
two engines, since iOS treats pinch as a browser gesture `touch-action` never reaches (every iPhone
browser is WebKit). What stays zoomable is what is read: `/`, its prose, every content page.
`user-scalable=no` would be global and Safari has ignored it since iOS 10. `a11y.test.ts` pins the
tag, the scoped declaration and the guard.

### A box that scrolls needs a way in

The deck table and the card rows scroll sideways and hold nothing focusable, so both carry
`tabindex="0"` and a `:focus-visible` outline.

### Tap targets

Anything drawn under 44px (`--touch-target`) gets its target from `.hit-target`, which needs a
positioned box. `.menuBtn`, the burger (the whole navigation under 46rem), is drawn at
`--touch-target` outright; `.brand` takes a `min-height`; `RulesButton` needs `position: relative` or
the class does nothing. Measure the rendered box rather than reading the CSS.

### Performance

- `inlineStyleThreshold: Infinity` in `vite.config.ts`: the stylesheets are small and were
  render-blocking. `style-src` allows `'unsafe-inline'` in `client/nginx.conf`; **scripts do not**
  and stay external or hashed (`csp.test.ts`).
- The tables page's images through `@sveltejs/enhanced-img`.
- **Do not preload the Latin `woff2` files.** With the preload, Chrome reported no LCP candidate on
  `/`; it buys nothing anyway, since inlined CSS puts `@font-face` in the document.

### NO_LCP scores 0, and a fade is how you get one

Chrome takes the LCP candidate at an element's **first** paint and skips anything at `opacity: 0`; an
element fading up from zero is not reconsidered. No candidate is `NO_LCP` (and `NO_FCP`), and
Lighthouse scores performance **0** however fast the page is. On `/`, the boot fade holding
`#root > *`, the bar's row and `.homeBurger` at `opacity: 0` until `data-booted` measured **perf 0, no
LCP**; with it neutralised, **perf 95, LCP 2.6 s**. The fix is to fade a canvas-coloured veil *off
the top* and leave the content opaque on the first frame. Nothing about the failure is visible.
**Open:** `layouts/GamePage.css` (`homeBootIn`) still fades the content itself from 0, not a veil.

### Re-running it

No `make` target: Lighthouse needs a Chrome and CI has none. Against a build:

```
cd client && npm run build && npx serve build -l 4399
CHROME_PATH=<a chromium> npx lighthouse@12 http://localhost:4399/rules/ --output=json --quiet
```

For accessibility alone, axe against the built pages is faster and covers more than one width (check
412 and 1440) with the `wcag2a`/`wcag2aa` tags; axe's best-practice rules (`region`,
`landmark-one-main`) are not what Lighthouse scores.
