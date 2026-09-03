# The live-streams strip

Who is streaming LOCO! right now, on the home screen and on a page of its own.

This note exists because the feature crosses four subsystems that each have a note already: it is a
goroutine on the server, a strip on the entry screen, an indexable page, and the first third party
this project has ever touched. Filed under `server.md` it would hide the legal half; filed under
`legal.md` it would hide the poller. It is a subject, so it gets a file.

---

## Why it was built

LOCO! has a Twitch category. That was the last unbounded piece of the findability work
([`seo.md`](seo.md)): the pages are the part this repository controls, and a category somebody can
select is the part it does not. The category existed and showed zero channels, and nothing in the
product said that streaming it was a thing anybody could do.

So the feature is a loop, not a decoration: players see that other people play this in front of an
audience, and streamers see that there is a place to take. It is at its most useful while the
category is new, which is also when it has the least to show.

## The rule everything else follows from

**A player's browser never contacts Twitch.** Not for the list, not for a preview, not for anything.
The server asks, keeps the answer in memory, and serves the pictures from this origin.

Three things depend on that, and all three would have to be reopened to change it:

- **The CSP does not move.** `img-src 'self' data:` and `connect-src 'self' ws(s)://…` are enough
  because nothing off-origin is ever fetched. `csp.test.ts` fails on any origin added to any
  directive, and it never had to be touched.
- **The privacy copy stays true.** `client/src/content/legal.ts` promises no fonts, scripts or images
  from anyone else's server, and no data leaving the EU. Both survive intact: the browser talks only
  to us, and the request the server makes carries nothing about anybody. The copy now says so, and
  `legal.test.ts` pins the sentence.
- **No consent banner.** A third-party image is a request from the reader's browser carrying their
  address and user agent. That is exactly the tripwire [`legal.md`](legal.md) describes. Routing it
  through the server means there is still nothing to consent to.

The cost is real and worth naming: this process now holds up to about a megabyte of JPEG for a reason
that has nothing to do with a card game. That is the whole price, and it is paid in memory rather
than in a promise.

## Everything leaves through Janus

Per `JANUS.md`, third-party calls go through the gateway, which holds Twitch's secret and does the
OAuth2 client-credentials dance. So this repository has **no Twitch credential at all** — there is
nothing to rotate here, and nothing to leak.

It also means several things are deliberately *not* built, because the gateway already does them for
every caller and doing them twice is two policies disagreeing about one upstream:

| Not here | Where it lives |
| --- | --- |
| response cache | Janus, reported per response as `X-Janus-Cache` |
| retries and backoff | Janus retries GET; a failing API is paused for everyone |
| rate limiting | Janus, answered as 429 with `Retry-After` |
| the OAuth2 token | Janus, fetched and renewed there |
| the API's secret | the vault behind Janus |

What is left in `server/janus/` is a transport: two headers, one identity, a bounded body, and the
one distinction the gateway's own error shape requires — `application/problem+json` means Janus
refused, anything else means Twitch answered. Confusing those two is how "the CDN was never
registered" would come back as "nobody is streaming".

`X-Janus-Cache: HIT` is worth reading rather than guessing at: on a hit, the freshness of the list is
the gateway's TTL and not our poll period. It is logged for that reason.

### The two slugs, and the one that is missing

`twitch-helix` is registered and answers. Its base address already ends in `/helix`, so the endpoint
this server asks for is `/streams`, not `/helix/streams` — confirmed against the live gateway, where
the other spelling comes back as a 404 from Twitch itself rather than as a gateway refusal.

**The preview CDN is a second API and is not registered yet.** Thumbnails live on
`static-cdn.jtvnw.net`, which is not the Helix host, and a slug that is not listed is not reachable
at all. Until an operator registers it and subscribes Loco! to it, `LOCO_TWITCH_CDN_SLUG` stays
empty and every row is listed **without a picture** — a state the code treats as ordinary rather than
as a failure, and which `TestNoCDNSlugMeansRowsWithoutPictures` pins. Calling the CDN directly is not
an option: `JANUS.md` forbids it without qualification, and the whole point of the gateway is that
this process has one outbound destination.

## The poller

`server/twitch/` is a package of its own rather than a file in `hub/`. That package is governed by
"one file per thing a message leads to", and a poller, a token-less HTTP client and an image cache
are none of those. It imports `server/janus` and `server/protocol`, and **never `hub`**: the only way
anything it produces reaches the event loop is the publish callback `Run` is handed.

- **60 seconds**, and the Helix quota is not what decides that. That quota is 800 points per minute
  per client id and `/streams` costs one point, so this spends 0.125% of it. What decides it is what
  a server whose first priority is latency should pay for a list no match ever reads, and a
  minute-old answer costs a home screen nothing.
- **No backoff of our own.** On failure the tick publishes nothing and the next one tries again;
  Janus is what pauses a failing API. The single exception is a 429, where `Retry-After` is honoured
  by skipping ticks — a pacing instruction is not a retry policy.
- **A non-2xx is an error, never an empty list.** Publishing "nobody is live" over an outage is the
  silent version of the bug: it looks exactly like the truth.
- **`LiveMaxAge` is 10 minutes**, and past it the last good list is replaced with an empty one. A
  twenty-minute-old list is wrong in the only direction that costs anything — somebody clicks and
  lands on a channel that went off air while they were reading about it.
- **A tick that changes nothing publishes nothing.** Without that, every poll would push the same
  list to every seatless socket once a minute for as long as the process is up.

### The game id, which is the failure mode that matters

`GET /streams` with no `game_id` returns **every live channel on Twitch**. So the id is resolved once
at startup, and a lookup that finds nothing is a hard stop: the poller refuses to run, logs why, and
the feature stays off — the same outcome as never configuring it, and the only safe one. There is a
second guard in `fetchStreams` for the same query, because one belt is not enough on a mistake whose
consequence is a home screen full of strangers playing something else.

In production the id is pinned in `LOCO_TWITCH_GAME_ID` (it is `1372128809`, IGDB `412525`), which
also means no call is spent resolving it and it cannot resolve *wrongly*.

## The previews

Fetched on the poll tick, kept in memory, served under a key we mint: `hex(sha256(url))[:16]`.

**This is the whole of the access control, and it is enough because the allowlist is a list rather
than a regular expression.** Only a URL that came back in the last Helix answer can be in the map,
and it was fetched by us on a timer rather than on anybody's request. Nothing a visitor sends chooses
a URL, so there is no open proxy to close. The alternative — nginx proxying `static-cdn.jtvnw.net`
behind a path regex — was rejected for exactly that: the allowlist would have been a pattern matched
against a segment we do not write, it would have needed a `resolver` whose failure mode is *nginx
refuses to start*, a CA bundle in the nginx image, and an outbound request on the page-load path
rather than on a timer.

The bounds are stated and tested: at most 12 previews, at most 80 kB each (a 440×248 preview weighs
25 to 45 kB), magic bytes checked, and **our** `Content-Type` written from those bytes rather than
copied from upstream. An oversized image is abandoned, never truncated: the row stays, without a
picture. The `ETag` is computed over the bytes, not the key — the URL is stable per channel while the
image behind it changes every poll.

Serving them costs the event loop nothing: the handler answers from an `atomic.Pointer` on an
ordinary `net/http` goroutine, exactly like `/health` and `/metrics`, and no page load ever waits on
the gateway because the fetching happened minutes ago.

## Screening what a stranger wrote

A channel name is text this game did not write, shown to its players. The predicate that judges it is
the nickname matcher, exported as `game.ContainsBlockedTerm`: the same wordlists, the same folding
and leet, the same whole-token-then-substring-from-six rules, the same allowlist for the collisions.
Sharing the matcher is the point — a second list drifts on its own schedule, and what a drifted list
produces is a slur on the home screen.

What is deliberately **not** shared is `ValidateNickname`, whose character allowlist is written for a
20-rune seat label. Applied to Twitch logins it would refuse honest channels by the handful, and this
gate is not the one that decides what a name may be made of.

| Case | What happens |
| --- | --- |
| login outside `^[A-Za-z0-9_]{1,25}$` | row dropped — and this is what makes the outgoing link safe to assemble: nothing reaching `twitch.tv/<login>` can carry a slash, a query or a scheme |
| login or display name carrying a blocked term | row dropped, counted on `/metrics`, **never logged with the text** |
| a name carrying the mark UNO | row dropped. `NOTICE.md` says nothing in the client renders that word and that the opposite would be a bug; the whole trademark position rests on it. Matched as a whole token, so Unolingo keeps its name |
| control characters or bidi overrides | stripped from the name, which is not a reason to drop a channel |

**No stream title is ever relayed.** It was the largest piece of unmoderated text this feature could
have put on the home screen, and a name, a viewer count and a picture are enough to decide whether to
click. The DTO has no field for one, so it cannot come back by accident.

`LOCO_TWITCH_BLOCKLIST` is the manual escape hatch, and it is needed because **nothing screens the
contents of a preview image**. That is the residual risk of this feature, stated plainly: the way to
answer a picture nobody should see is to name the login in that variable and redeploy.

## What reaches the client, and how

Two consumers, one snapshot:

- **The game** is told over the socket it already holds. `live_streams` follows `players_online`
  exactly: seatless sockets only, a per-socket watermark so an unchanged list is sent to nobody, and
  a send on arrival because a strip that waited for the next change would be empty all evening on a
  quiet one. There is **no ticker** behind it — nothing here moves on its own, so a case in the
  select would be a wake-up for nothing.
- **The content page** reads `/live.json`, same-origin, once, on load. It does not open a socket:
  a content page mounts no game code, and one tab holds the game anyway (`tabLock`).

Six rows go on the wire and twelve into the JSON. Six because the strip draws three and the rest is
slack for rows the screen drops, and because that message reaches every seatless socket at once;
twelve because the page has room and costs one reader one response.

`LiveStreams` is a pointer for the reason `RematchOffers` is one: the list has to be able to say
*nobody any more*, and an empty slice under `omitempty` marshals to nothing at all.

## The strip

`components/LiveStrip.svelte`, at the foot of the entry screen, and three things about it are
decisions:

1. **Absolutely positioned**, like every other piece of chrome on that screen. `/` is exactly one
   viewport and never scrolls; anything taking a row of layout would push the lockup off centre the
   moment somebody went live, in front of whoever was reading. It also means its own height can
   change without moving anything else.
2. **Nobody live is nothing at all.** No plate, no invitation, no line saying the category is empty.
   A plate reporting that nobody is playing is a plate saying the game is dead — the same reasoning
   that keeps the connected-player count off screen below its floor. What tells a would-be streamer
   there is a place to take is the page, where it can be explained rather than announced over a
   board.
3. **The order is never touched.** It is Twitch's own, biggest first, carried through the server
   untouched. `topLiveStreams` cuts and does not sort; a client-side sort would be a second opinion
   about a ranking that already exists, and the first sign of it going wrong would be a strip
   disagreeing with the category page it links to.

It is drawn on the entry screen only — once a form is up, that form owns the screen, and a link out
of the game beside the nickname field is an exit offered on the way in. Never at a table, for the
reason the rules modal links nowhere.

Under 46rem it collapses to one line above the connected-player plate, which keeps its place: the
count is what decides whether to start a game, and the strip is an invitation to go somewhere else. A
phone has the height for one of the two. Under 44rem of height it collapses for a different reason —
a laptop in landscape has the width and not the room, and a row of cards would land on the buttons.

`width` and `height` are written on every `<img>`. Without them a preview arriving late resizes the
strip, on the screen whose largest paint the whole site is measured on.

**No Twitch logo anywhere.** Two rules meet: their brand guidelines forbid redrawing their marks, and
`drawnGlyphs.test.ts` requires every glyph a player sees to be one we drew. So the strip writes the
word.

## The page

`/live/` and `/fr/en-direct/`, in `PAGES` and in `NAV`.

**Prose first, list second, and that order is the design.** A list of who is streaming this afternoon
is wrong tomorrow and carries no search value; what the game gives a stream and what it takes to
appear in the category are properties of the product. So the indexable half is served in the markup —
what the interception window feels like on a stream, the five seconds after somebody is down to one
card, the category, streamer mode, playing with a chat — and the list is filled over it in the
browser. The JSON-LD stays `WebPage`, never `Article`: the page is evergreen even though one section
of it is not.

The section is served with **a paragraph rather than a spinner**, and that paragraph answers two
readers at once: somebody arriving on a quiet evening and somebody whose browser runs no scripts.
Neither is ever shown the word "loading". `e2e/tests/live.spec.ts` reads the page with JavaScript
disabled, which is the only place that can be proved.

**The fill is wired into `page-boot.ts`** rather than shipped as a second script. That file already
documents the rule in its own header: there is only ever one script on these pages, so a second
behaviour is a few more lines rather than a second request. The rule in `CLAUDE.md` and
[`seo.md`](seo.md) — a content page ships no JavaScript except `page-boot.ts` — therefore stays true
to the letter; what changed is what that script does. Everything is built with `createElement` and
`textContent`; `livePage.test.ts` fails on an `innerHTML` in that module, because every string it
handles was written by a stranger.

## The outgoing links

`components/twitchLinks.ts` is the only module in the client that names Twitch's address, and it
assembles it rather than writing it down.

Why that is not a way around `csp.test.ts`: what the policy protects is that the browser **fetches**
nothing off another origin. An `<a href>` is not a fetch, it is a navigation a person decided to make
after reading where it goes, and `default-src` has never had anything to say about those. So the rule
kept here is narrower and stricter than "no literal URLs": one module names one host, every link is
built there, and nothing it produces is ever used as a `src`. `csp.test.ts` asserts both halves
directly, rather than leaving them to the shape of a regular expression.

Every link carries `noopener noreferrer external`. `noreferrer` because the privacy page promises
nothing about a player reaches a third party: the site already sends
`Referrer-Policy: strict-origin-when-cross-origin`, so Twitch would see the origin and nothing else,
and this makes it see nothing at all. What that costs is traffic attribution on Twitch's side, which
this project has no use for.

## Operating it

Everything is off unless `JANUS_API_KEY` is set: no goroutine, no outbound request, no `live_streams`
on the wire, and no log line either — a line at every startup about a feature nobody switched on is
noise. One INFO line is written when it *does* switch on, naming the game id and the period. A key
with no URL or no application id is a typo rather than an intention, and says so with a WARN.

Only production polls. Two stacks on one key would be two sets of requests against one quota for a
list nobody reads on the dev host, so `write_app_env` passes the credentials on the prod branch only.

`/metrics` carries `live.twitch_polls`, `live.twitch_poll_errors`, `live.live_rows_screened`,
`live.twitch_thumb_errors` and `live.twitch_streams_live`. `twitch_poll_errors` climbing while
`twitch_polls` climbs is the gateway or Twitch being unavailable; `live_rows_screened` climbing is
the screen doing its job.

nginx proxies `/live.json` and `/live-thumb/`, which with `/ws` is now the complete list of what it
forwards. Neither block declares an `add_header`, so both inherit the five security headers — and
that is deliberate, because declaring one would require repeating the include, and an include that
can be forgotten is the hazard `security-headers.conf` exists to describe. `csp.test.ts` pins the
list of proxied paths, so a third one is a decision somebody has to make on purpose.
