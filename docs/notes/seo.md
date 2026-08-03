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
  Google is about as player-facing as it gets. `legal.test.ts` asserts this over the i18n copy;
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
previous test's language into the next one. `i18n.test.ts` pins all three cases: the URL wins over
the browser, a stored choice wins over the URL, and `<html lang>` is never an input.

## The two hosts, and why production has its own domain

Production is `ohloco.com`, development is `loco-d.kisukesaama.com`. They are declared once each, as
`PROD_HOST` and `DEV_HOST` in `.gitlab-ci.yml`'s global `variables:` block, and everything else reads
`APP_HOST`.

`APP_SUBDOMAIN` stayed `loco` and is **not** the address any more. It names the *stack*: the compose
project, the Traefik router, the internal network and the deploy directory under `DEPLOY_DIR`. That
separation is the whole reason the move cost two lines instead of a rename of every container on the
box — but it also means the two are now free to drift, so a host is never derived from the subdomain
and the subdomain is never used as a hostname.

The dev host has to keep the `-d.` prefix. `client/nginx.conf` keys `robots.txt` on that exact
pattern (`~*-d\.`), and it is the only thing standing between the dev deployment and the index: a dev
host renamed without it falls into the `default` branch and starts inviting crawlers, advertising a
sitemap of URLs that name the wrong origin. `seo.test.ts` pins the branch's contents; nothing can pin
the name of a host that does not exist yet, so it is written here instead.

## The apex is canonical and `www.` is a redirect

`ohloco.com` is the site. `www.ohloco.com` exists only as a 301 to it, done at the edge (a Cloudflare
redirect rule), and it reaches neither Traefik nor nginx.

Picking one of the two is not optional — both would answer 200, both would be crawled, and the
duplicate would split whatever authority the pages accumulate. Which one is arbitrary; the apex wins
here because the domain is short, it is what fits in a stream overlay, and it is what somebody types.

The failure this arrangement invites is the quiet one: an origin carrying `www.` while the redirect
points the other way makes every canonical, every `hreflang` and every sitemap entry name a redirect
rather than a page. Google follows it and then reports the canonical it was given as invalid. Nothing
looks wrong to a human, because both URLs load. `seo.test.ts` asserts `ORIGIN` has no `www.`, which
is the half of the contract living in this repo; the other half is the redirect rule, and it is
documented in `docs/deployment.md` because there is no file here that could hold it.

## The origin has to be decided at build time

Crawlers do not run JS and resolve `og:image` against nothing, so a relative URL is simply not
fetched. `VITE_PUBLIC_ORIGIN` therefore feeds both `astro.config.mjs`'s `site` and `meta.ts`'s
`ORIGIN`, and both default to production.

That default was a live bug: nothing passed the variable anywhere, so the image built for
`loco-d.kisukesaama.com` served a canonical and an `og:url` naming production. The `-d.` host's
`Disallow: /` hid it rather than fixing it. `client/Dockerfile` now takes it as an `ARG`, and
`.gitlab-ci.yml` passes `https://${APP_HOST}` — `DEV_HOST` on `develop` and `PROD_HOST` on a `v*`
tag.

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

## Titles and descriptions have a length, and it is not a suggestion

A `<title>` past ~60 characters and a `<meta name="description">` past ~155 are cut mid-word in the
result, and the half that goes is usually the half carrying the point. Every string in `PAGES` was
over that line — the home page's description by 30 characters — and nobody had noticed, because
these are the strings no one on the team ever sees rendered. `seo.test.ts` now bounds them: title
≤ 60, description between 100 and 155.

The floor matters as much as the ceiling. Google rewrites a description it finds too thin, and a
page whose snippet it authors is a page whose pitch it authors. French runs about 15% longer than
English for the same sentence, so both languages share one ceiling and the French copy is **written
to it** rather than translated into it.

## The home page's `<h1>` is served markup, and it is not the wordmark

`/` is a game. What stands where a title would is the LOCO logotype, which is a *drawing* carrying
`role="img"`, and the only real heading on the page was one the lobby mounted from the bundle. A
crawler does not wait for that, so every audit read the site's most important URL as a page with no
heading at all — the same reason the footer prose is served markup and not mounted.

So `GamePage.astro` serves one `<h1>` with `.sr-only` (`tokens.css`), in text, before anything
mounts. It says what the page is in the words somebody would have typed, never the word LOCO alone:
a heading repeating the logo is the logo again. `.sr-only` clips rather than `display: none`, which
would take it out of the accessibility tree too — a screen reader arriving before the bundle lands
gets the heading as well.

The other half of the rule is that it stays the *only* one: the app's screens (`Lobby`, `Searching`,
`MapLoadingScreen`) head themselves at `<h2>`, and `seo.test.ts` fails on an `<h1>` anywhere under
`src/components/`. Googlebot renders JS, so a second one mounting a moment later is a page with two
headings, and the one that describes the page is the one that loses.

## Structured data

`VideoGame` + `WebSite` + `WebPage` on the game pages, stating the two properties this category is
actually searched on: that it is free, and that a group can play it in a browser. Saying it in prose
alone leaves it to be inferred.

**Free is `isAccessibleForFree`, never an `Offer`.** A `VideoGame` carrying `offers`,
`applicationCategory` and `operatingSystem` is a `SoftwareApplication` as far as a validator is
concerned, and Google's software requirements then make `aggregateRating` mandatory: the block came
back with a *critical error* on every audit, and the only way to satisfy it would have been to
publish ratings nobody has left. The boolean says the same thing to the same crawlers and asks for
nothing that does not exist. `seo.test.ts` fails on any of those four property names reappearing.

**A content page is a `WebPage`, not an `Article`.** Same failure from the other direction: `Article`
is a *supported* type, so a validator holds it to Google's article requirements and reports `author`,
`datePublished` and `image` as errors — three fields this site has no honest value for. There is no
editorial identity to name (`legal.md`) and these are evergreen documents with no publication date.
`WebPage` states the same thing with nothing invented.

What actually renders is the **breadcrumb**, which replaces the raw URL under the title with
`LOCO › Rules`, and the FAQ's `FAQPage`, which can put an answer straight into a result. Every page
now carries the trail; the FAQ was the one page without it, because it built its own graph. It still
does — `FAQPage` *is* a `WebPage` and replaces that node rather than sitting beside it — but it
reads `breadcrumbJsonLd` and joins the same `@id`s.

Those `@id`s are the point of the graph: every page points at the one `#website` and the one `#game`
the home page declares, so a crawler reads seven pages about a single entity rather than seven
unrelated documents. They are strings on both sides, so a typo is invisible — the block stays valid
and the pages simply stop being related — which is why the test compares them rather than eyeballing
the output.

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

**Privacy and terms is last, not apart.** It is not a page anybody came to read, it is the one that
has to be findable from anywhere, and on the home page it stood off at the right-hand end for that
reason. Held apart it read as a second navigation of one item, and the gap the centring left between
it and the five gave the row two centres, so on `/` it closes the same list the other five are in,
which is how both drawers had always carried it. That row is a plain centred flex again: the three
grid columns existed only to keep the five centred against an item pushed right, and there is
nothing to push. The content pages' bar keeps it in `.footerEnd`, beside the theme switch and the
globe, where the far end of the bar is settings rather than empty space.

**And a way back up.** These pages are long and their navigation is pinned to the *bottom*, so the
return trip was a full scroll or a key a phone does not have. `.toTop` appears once the reader is
about a screenful down, above the bar and out of the column. It is `hidden` in the markup and
revealed by `theme-boot.ts` for the same reason the theme switch is: without a script it could
neither know it was wanted nor animate the return, and that reader still has the browser's own way
home. The `href="#top"` is real, so the control works even if the handler does not; the handler only
adds the smooth scroll (skipped when the system asks for reduced motion — there is no `data-motion`
here, that attribute is the game's) and moves focus back to the skip link.

**And the smooth scroll had to be made to survive that focus call.** The button animated nothing for
as long as it existed, and `window.scrollTo` was never the problem: the line after it focused
`.skip`, which sits at `top: 0` nine thousand pixels off to the left, so the browser scrolled it into
view — instantly — and an instant scroll cancels a smooth one already in flight. The animation
started every time and never got a frame. `focus({ preventScroll: true })` is the whole fix; the
keyboard reader still lands at the top of the document.

**An anchor glides too**, which is the same problem one press earlier: the rules page's table of
contents and the privacy page's jump list moved the reader several screens with nothing to say the
page had not been replaced under them. `scroll-behavior: smooth` on the scrolling element covers
every route at once — a fragment link, the skip link, `#top`, and the handler's own `scrollTo`. It
hangs off `html[data-scroll="smooth"]`, written by `theme-boot.ts` from the system preference,
because a reduced-motion reader has to keep the instant jump and neither answer is available to this
stylesheet: `@media` on that preference is refused across the whole client by
`reducedMotionCss.test.ts`, and `data-motion` is written by the game's `initMotion()`, which these
pages never mount. The listener is live rather than read once at boot, and with the script off
nothing glides, which is the safe half of the fallback. `contentPages.test.ts` pins both halves —
either alone is silent.

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
- **The game page**: the burger is fixed over the board at the offsets `Lobby.svelte`'s `<style>`
  gives `.topBar`, so it lands on the line the gear, the speaker and the "?" already sit on. The drawer
  carries the five pages and privacy. **No `Play`** — this is where playing happens — and no theme or
  language, which are behind the lobby's own gear. The footer row costs the board no height at all at
  that width.

**Both open on the wordmark, and both carry exactly one action.** The head used to read "Menu",
which named the panel to somebody already looking at it and left this the one branded surface on the
site with no brand on it — on the game page especially, where the drawer covers the board and there
is no header behind it. It is `<LocoLogo />`, rendered statically, so it is the same drawing as the
one on the cards. Write it in a **`<div class="navPopTitle">`, never a `<p>`**: the logo renders a
`<div>`, an HTML parser closes a paragraph before one, and the mark landed as a *sibling* of the
title — which made `.navPopHead` a three-item row and had `space-between` centre the logo between an
empty `<p>` and the ✕. It rendered perfectly and sat in the wrong place, and no test reading the
source was ever going to see it; `mobile.spec.ts` measures the rendered box instead.

The action is `.navPopCta`. A drawer that is six destinations and nothing else is a grey corridor,
and the content pages had `Play` in it while the game page had nothing — one menu with the game's
colour in it, one without. Each has one now, at opposite ends because they mean opposite things:
`Play` is where you are going, `Preferences` is what you came into the menu to change. The scoping
matters — `.navPop .navPopCta`, not `.navPopCta`, because `.navPopLinks a` is a class *and* a type
and beats a bare class on specificity whatever the order. It went unnoticed while the only CTA was
white against an ink colour that is also near white in the dark theme.

`#navPrefs` is the seam between the two halves of `/`. It ships `hidden` and `homeSheet.ts` reveals
it, for the reason the content pages' theme switch does: the panel it opens belongs to the game's
bundle, and a
scriptless page is better off without a button than with one that does nothing. It closes the popover
and dispatches `loco:preferences`; `<Preferences />` listens. An event rather than a shared module —
the drawer is `#root`'s sibling, not in its tree, and a store both halves imported would put the
app's bundle behind this page's script.

**The two drawers differ in their list and in nothing else.** The game's used to end with the home
page's prose under its links, on the reasoning that the burger is the only thing a phone opens on `/`
and everything the footer offered had to be inside it. What that produced was two menus: a phone
tapping `Menu` on `/` got two rows of destinations and a page of copy, tapped `Rules`, and one screen
later the same button in the same corner opened a short list. A menu is a list of destinations, and a
site where it is that on one half and a document on the other has two of them. The prose keeps its
own control — the sheet — and stays in the served HTML at every width, so nothing a crawler reads
changed. The cost is real and small: a phone can no longer read the home page's two paragraphs from
`/` itself, and the pages the drawer lists are what it goes to instead.

Both are `popover="auto"`, so Escape and a tap outside close them with **no script**, which is the
constraint these pages are built under. Five things about that are easy to get wrong, and four of
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
- **The bar is hidden by `display: contents`, not by `display: none`.** `#langPop` is a child of the
  footer bar, and the drawer's globe is the only way to it on a phone. Under `display: none` the
  panel was promoted to the top layer and painted nothing — an ancestor set to `none` takes its whole
  subtree out of the render tree whatever the top layer thinks — so the one control that switches
  language on a phone did precisely nothing, silently. The bar's three rows (`.footerPlay`,
  `.footerNav`, `.footerEnd`) are what goes; the `<footer>` stays as a box-less wrapper around the
  panel it holds. Same trap for anything else that ever moves into that element.
- **Widening the window has to close it.** CSS cannot close a popover: drag a window out, or turn a
  tablet on its side, and the drawer stands over a page whose own bar is already showing underneath,
  with the button that closes it no longer on screen. `content/navMenu.ts` is the exception to these
  pages running no behaviour — one `matchMedia` listener calling `hidePopover()`, imported by
  `theme-boot.ts` for the content pages and by `homeSheet.ts` for `/`. It holds a **second copy of the
  46rem breakpoint**, which `contentPages.test.ts` asserts against the one in `content.css`.

Both renderings of the navigation are built from `NAV` and `LEGAL`, so the bar and the drawer cannot
list different pages; only one is ever on screen. That does put the same links in the document twice,
which is ordinary — a site with a header nav and a footer nav does the same — and it is why
`seo.spec.ts` scopes its home-page assertions to `.homeLinks` rather than to `.homeIntro`.

**`GamePage.astro` styles no part of the drawer.** The panel, the heading, the rows, the settings row
are all `content.css`, which is what makes the two menus one design rather than two that resemble
each other; a rule for `.navPop*` in that file is a divergence by definition, and the prose block that
used to justify one is gone.

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
`src/theme.ts` reads, so a choice made on the rules page is the one the game opens with.

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

- **The rules page maps `t.rules`**, the same array `RulesModal.svelte` maps. It is not a copy: a rule
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
included, and the page still ships no JavaScript for it. Its face is sized in container-query units against the
element, so passing a width and height as a style is all it takes to draw one bigger. This is why
`CardArt.svelte` carrying its own `<style>` block and importing nothing mattered enough to check
before the migration.

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

The pictures themselves do **not** come off `MAPS`, and that is the one place this page departs from
the registry. `MAPS` gives a URL under `/maps/`, which is what the board needs — it is handed a room
at runtime and can know nothing about it at build time. This page knows all four up front, so
`TablesArticle.astro` imports the same files through `import.meta.glob` and renders them with
`<Image />`: sharp then emits each one at 400, 752 and 1128 wide and writes the `srcset`. The
originals in `public/` are untouched and are still what the game loads.

That was worth doing because the page was handing a phone eight 1280×720 photographs for a 752px
column — 1.4 MB of pixels it would never display — and the first of them was the LCP at **9.1 s**.
The 400-wide room is 11 kB against 147 kB. The top pair also loads eagerly at `fetchpriority="high"`,
including the table: a lazy image inside the first viewport is a request the browser starts late for
no reason. Measured after: LCP 2.6 s, performance 74 → 97.

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

That sheet is a native `<details>`, not a modal of ours, and both halves of that matter. It is markup,
so the prose stays in the served HTML where a crawler reads it — content inside an expandable section
is indexed normally, and the alternative (the copy in `i18n/`, rendered by a component) would put it
behind a script *and* grow the bundle every player downloads. And it opens with no JavaScript at all,
which `seo.spec.ts` proves by clicking it in a context with scripts disabled. `src/homeSheet.ts` adds
only Esc, a click on the scrim and the ✕; the sheet is fully usable without any of them. Open, the
`<summary>` is the close button, because a native `<details>` has exactly one control and a second one
would need a script to work.

**Open, it is the rules modal.** Same card, same 4px stroke, same headed title with a ✕, same scrolling
body, same single button at the foot — `components/RulesModal.svelte` is where every measurement comes
from, and `contentPages.test.ts` reads them off that file rather than restating them. The two are the
same object seen from two screens: a player who opens both in one session is entitled to meet one game
and not two ideas of what a panel over the board is. It was a bordered card floating on a scrim with a
pill fixed at the bottom edge of the *screen*, which was a third thing, resembling neither.

Three details make that shape work on a native disclosure, and each of them fails silently if undone:

- **The card is the `<details>` element itself.** A `<summary>` must be that element's first child, so
  it cannot live inside a card that is one of its siblings. `order: 1` sends it to the foot of the flex
  column, where the modal's footer button is; lose that declaration and the button sits above the
  title with nothing else broken.
- **The scrim is a sibling of the `<details>`, not a child of it.** As a child it would be painted over
  the card's own background — a positioned element's background is painted by the stacking context
  root before any child, so a full-screen `z-index: -1` scrim tints the card it is meant to sit behind.
- **The ✕ ships `hidden` and `homeSheet.ts` reveals it**, the same contract as the drawer's Preferences
  row: the summary closes the sheet with no bundle in flight, this one cannot. `.homeSheetX[hidden] {
  display: none }` is load-bearing — the `display: flex` that draws it beats the attribute otherwise,
  and the control appears with nothing behind it.

`HomeProse.astro`'s sections head at `<h3>`, under the sheet's own `<h2>` title, which keeps the
document's heading order the served `<h1>` establishes.

Under 46rem none of that row is on screen: the burger described above replaces it, and the drawer
carries the links. The sheet is the prose's one control — it is what opens it on a wide screen, and
`HomeProse.astro` is rendered once, in it. The drawer held a second copy for a while; see the two
drawers above for why it does not any more.

The footer disappears the moment a seat is taken. That is not the app's to do — it is markup Astro
rendered — so `App.svelte` writes `data-seated` on `<html>` and CSS hides it. The burger and the drawer
sit inside that same element, so a seat takes them with it. The body no longer needs
`overflow: hidden` restoring, because it never lost it: a board that can be scrolled off-screen
mid-match is a bug, and now so is a lobby that can. `appSubscription.test.ts` owns the attribute,
`seo.spec.ts` owns the CSS and the no-scroll guarantee.

### Zero JavaScript, with one exception

`<LocoLogo />` is the game's own Svelte component rendered with **no client directive**, so Astro
turns it into static markup at build time and ships none of the runtime: the mark on the page is the
mark in the game rather than a redrawn copy, and it costs nothing to load.

The exception is `src/content/theme-boot.ts`. `tokens.css` keys its dark palette on
`[data-theme='dark']` and on nothing else, which is written by JS — so without it a player who chose
the dark theme and then tapped "Rules" landed on a bright white page. It imports `src/theme.ts`,
which was split out of the game's theme hook precisely so this does not drag a framework onto a page
that mounts nothing. The hook is gone and that module is now the single definition of what the theme
is, for the app and for a content page alike.

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

## What an audit sees

Lighthouse scored this site 86-89 on accessibility and 74-90 on performance while every page looked
exactly as designed. Nothing on that list is visible, which is the reason it sat there: three of the
four accessibility failures are properties of a *file*, and the fourth is a number nobody can eyeball.
`client/src/test/a11y.test.ts` pins all four against the source, because a checker runs on a deployed
URL and by then the change that broke it is weeks old.

### The wordmark was failing as prose

`color-contrast` failed on `<span class="word">LOCO</span>` at **1.07:1**, on every page, in dark.
The foreground it names is `#0b0618` — the ink outline, not the red. axe reads
`-webkit-text-stroke` as the colour of the text (`getStrokeColor`, any non-zero width), and on the
dark canvas that outline and the canvas are the same near-black.

WCAG 1.4.3 exempts a logotype by name, so this is a false positive against the standard and a real
failure against the tool. Both are answered:

- `<LocoLogo />` carries `role="img"` and `aria-label="LOCO"`, with the word `aria-hidden`. That is
  what it always was — a drawing, not a heading — and it also stops a screen reader announcing
  "LOCO" twice, once for the mark and once for the word.
- In **dark only**, the word carries no stroke and a `::before` paints the outline over it. The red
  alone is 5.4:1 against the dark canvas and passes; the outline is still drawn, so the logo is
  pixel-for-pixel what it was. In **light** the stroke stays on the word, where it is 14.7:1 and is
  what the eye reads the letters by — the red alone would be 2.2:1 there and would fail.

The `role="img"` does **not** silence the check on its own, and neither does `aria-hidden`: the rule
is about pixels, not about the accessibility tree. Only the colours move the number.

Declared twice, as `tokens.css` declares the dark palette twice — `[data-theme='dark']` for the
choice, the media query for the first frame — and the test asserts both blocks repaint the outline.

### White on LOCO Red, at 16.8px

3.43:1. That is a pass for large text (3:1) and a fail for anything under 14pt bold, which is
18.66px. `.cta` and `.navPopCta` were 1.05rem and are 1.2rem: the alternative was darkening the brand
red on the two controls that are most obviously the brand.

### The viewport forbade zooming

`user-scalable=no, maximum-scale=1.0` was there to stop a double-tap zooming the board mid-match, and
it took pinch-zoom with it — somebody's only way to read this game on a phone, and a failure on every
page of the site. The tag now carries `width=device-width, initial-scale=1.0, viewport-fit=cover` and
nothing else; `touch-action: manipulation` moved from the controls to `body`, which drops the
double-tap and leaves the pinch alone. The trade is real and deliberate: a board can now be pinched
during a match.

### A box that scrolls needs a way in

The deck table and the card rows scroll sideways on a phone and hold nothing focusable, so the part
past the right edge belonged to whoever could drag it. Both carry `tabindex="0"` and a
`:focus-visible` outline.

### Three controls a thumb could not hit

A mobile audit came back **1/3** on tap targets while every screen looked right, and measuring the
built pages at 360px found three boxes under `--touch-target` (44px):

- `.menuBtn`, the burger — which under 46rem is the *entire* navigation, on `/` and on every content
  page — drawn at 2.5rem like the game's chips. It is now drawn at `--touch-target` outright rather
  than borrowing `.hit-target`: it is the one control on the page a thumb has to find, and there is
  no chip row here for it to match.
- `.brand`, the way back to the game, was exactly as tall as the 25px drawing inside it. It takes a
  `min-height` and the mark does not move.
- `RulesButton`, the "?" chip, was the one control in the top-right row with **neither** 44px nor
  `.hit-target` — and its CSS had no `position: relative`, without which the class does nothing at
  all. The two chips beside it were right, which is exactly how it went unnoticed.

The rule is the one in `CLAUDE.md`: anything drawn under 44px gets its target from `.hit-target`,
and the class needs a positioned box. Measure it rather than reading the CSS — a pseudo-element that
lands in the wrong containing block is invisible in both.

### Performance

Three changes, none of them page-specific:

- `build.inlineStylesheets: 'always'` in `astro.config.mjs`. The three stylesheets are 3-22 kB and
  all three were render-blocking requests; the game page waited 753 ms on one of them before it could
  paint a word. `style-src` allows `'unsafe-inline'` in `client/nginx.conf`, so this is legal —
  **scripts are not**, and must stay external (`csp.test.ts`).
- The tables page's images, above.

And one that was tried and reverted: **preloading the two Latin `woff2` files**. It is the obvious
move — the wordmark is the LCP element on `/` and it spent its render delay waiting on a font nothing
had asked for yet — and with the preload in place Chrome reported **no LCP candidate at all** on the
home page. Removing it brings the candidate straight back, reproducibly, at the same paint time. It
buys nothing now anyway: `inlineStylesheets: 'always'` puts the `@font-face` rules in the document,
so there is no stylesheet round trip left to race, which was the whole premise.

### NO_LCP scores 0, and a fade is how you get one

Worth stating on its own, because it costs more than everything else on this page put together.
Chrome takes its LCP candidate at an element's **first** paint and skips anything painted at
`opacity: 0`; an element that starts at zero and animates up is not reconsidered. A page with no
candidate reports `NO_LCP` (and `NO_FCP` in the same runs) and Lighthouse scores its performance
**0** — not "slower", zero — however fast it really is.

Measured on the home page, twice over: the font preload above, and the boot fade that holds
`#root > *`, `.homeIntroMain` and `.homeBurger` at `opacity: 0` until `entry.ts` writes
`data-booted`. With the fade neutralised and nothing else changed, `/` goes from **perf 0, no LCP**
to **perf 95, LCP 2.6 s**. The fade is worth having — the page arrives in two halves and looked
broken without it — so the fix is not to drop it but to invert it: fade a veil in the canvas colour
*off the top*, leaving the content painted opaque on the first frame. The arrival looks identical
and the candidate is registered.

The trap is that nothing about this is visible. The page is fast, it looks right, and the score is
zero.

### Re-running it

There is no `make` target: Lighthouse needs a Chrome and CI has none, for the same reason `make og`
commits its output. Against a build:

```
cd client && npm run build && npx serve dist -l 4399
CHROME_PATH=<a chromium> npx lighthouse@12 http://localhost:4399/rules/ --output=json --quiet
```

For accessibility alone, axe against the built pages is faster and covers more than one viewport at a
time — Lighthouse audits one width and one theme per run, and two of the four failures above only
appear in one of the two themes. Check both, at 412 and 1440, and use the `wcag2a`/`wcag2aa` tags:
axe's own best-practice rules (`region`, `landmark-one-main`) are not what Lighthouse scores.
