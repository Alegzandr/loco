# The live-streams strip

Who is streaming LOCO! right now, on the home screen and on a page of its own. It crosses four
subsystems — a server task, a strip on the entry screen, an indexable page, and the project's one
third party — so it is a subject with its own file.

## Why it exists

LOCO! has a Twitch category, and nothing in the product said streaming it was something anybody
could do. The strip is a loop, not a decoration: players see others play in front of an audience,
streamers see a place to take. It is most useful while the category is new, which is also when it
has the least to show.

## The rule everything follows from

**A player's browser never contacts Twitch** — not for the list, not for a preview. The server asks,
keeps the answer in memory, and serves the pictures from this origin. Three things rest on it:

- **The CSP does not move.** `img-src 'self' data:` and `connect-src 'self' ws(s)://…` suffice
  because nothing off-origin is fetched. `csp.test.ts` fails on any origin added to any directive.
- **The privacy copy stays true**: no images from anyone else's server, no data leaving the EU.
  `legal.test.ts` pins the sentence saying the server, not the browser, asks Twitch.
- **No consent banner.** A third-party image is a request carrying the reader's address — the
  tripwire in [`legal.md`](legal.md).

The price is up to about a megabyte of JPEG in the server's memory.

## Everything leaves through Janus

Per `JANUS.md`, third-party calls go through the gateway, which holds Twitch's secret and does the
OAuth2 client-credentials exchange. **This repository holds no Twitch credential.** What the gateway
does for every caller is not built again here, because two policies over one upstream disagree:

| Not here | Where it lives |
| --- | --- |
| response cache | Janus, reported per response as `X-Janus-Cache` |
| retries and backoff | Janus retries GET; a failing API is paused for everyone |
| rate limiting | Janus, answered as 429 with `Retry-After` |
| the OAuth2 token | Janus, fetched and renewed there |
| the API's secret | the vault behind Janus |

`server/crates/loco-janus/` is a transport: two headers, one identity, a bounded body, and one
distinction — `application/problem+json` means Janus refused, anything else means Twitch answered.
Confusing the two turns "the CDN is not registered" into "nobody is streaming". `X-Janus-Cache: HIT`
is logged: on a hit, the list's freshness is the gateway's TTL, not our poll period.

### The two slugs, and the one that is missing

`twitch-helix` is registered. Its base address already ends in `/helix`, so the path asked for is
`/streams` (the other spelling is a 404 from Twitch itself, not a gateway refusal).

**The preview CDN (`static-cdn.jtvnw.net`) is a second API and is not registered yet.** Until an
operator registers it and subscribes the application, `LOCO_TWITCH_CDN_SLUG` stays empty and every
row is listed **without a picture** — an ordinary state, not a failure
(`no_cdn_slug_means_rows_without_pictures` in `loco-twitch/src/tests.rs`). Calling the CDN directly
is not an option: `JANUS.md` forbids it, and the process has one outbound destination.

## The poller

`server/crates/loco-twitch/` is its own crate: a poller, an HTTP client and an image cache are not
"things a message leads to". It depends on `loco-janus` and `loco-protocol` and **never on
`loco-hub`**; what it produces reaches the event loop only through the publish callback
`Poller::run` is handed (`publish_live`).

- **60 seconds** (`LIVE_POLL_PERIOD`). Not the quota (800 points a minute, one per `/streams` call):
  it is what a latency-first server should pay for a list no match reads.
- **No backoff of our own.** A failed tick publishes nothing and the next one tries again. The one
  exception is a 429, whose `Retry-After` is honoured by skipping ticks.
- **A non-2xx is an error, never an empty list.** "Nobody is live" over an outage looks exactly like
  the truth.
- **`LIVE_MAX_AGE` is 10 minutes**; past it the last good list is replaced by an empty one, so
  nobody clicks through to a channel that went off air.
- **A tick that changes nothing publishes nothing.**

### The game id

`GET /streams` with no `game_id` returns **every live channel on Twitch**. The id is resolved once at
startup (`resolve_game_id`), and a lookup that finds nothing switches the feature off — the same
outcome as never configuring it. `fetch_streams` refuses an empty id again: one guard is not enough
against a home screen full of strangers playing something else. Production pins it in
`LOCO_TWITCH_GAME_ID` (`1372128809`, IGDB `412525`), so it costs no call and cannot resolve wrongly.

## The previews

Fetched on the poll tick, kept in memory, served under a key we mint: `hex(sha256(url))[:16]`.

**That is the whole access control, and it suffices because the allowlist is a list, not a pattern.**
Only a URL from the last Helix answer can be in the map, fetched by us on a timer; nothing a visitor
sends chooses a URL, so there is no open proxy. An nginx proxy of `static-cdn.jtvnw.net` behind a
path regex is rejected: a pattern over a segment we do not write, a `resolver` whose failure stops
nginx starting, a CA bundle in the image, and an outbound request on the page-load path.

Bounds, tested: at most 12 previews (`MAX_THUMBS`), at most 80 kB each (`MAX_THUMB_BYTES`; a 440×248
preview is 25–45 kB), magic bytes checked, **our** `Content-Type` written from those bytes. An
oversized image is abandoned, never truncated: the row stays, without a picture. The `ETag` is over
the bytes, not the key — the URL is stable per channel, the image changes every poll.

Serving costs the event loop nothing: `Poller::live_json` and `thumbs::serve_thumb` answer from the
poller's last snapshot on an ordinary request task, and no page load waits on the gateway.

## Screening what a stranger wrote

A channel name is text this game did not write. It is judged by the nickname matcher,
`loco_game::contains_blocked_term`: the same wordlists, folding, whole-token-then-substring-from-six
rules and allowlist. One list, because a second drifts, and a drifted list puts a slur on the home
screen. **`validate_nickname` is deliberately not used**: its charset is for a seat label and would
refuse honest channels.

| Case | What happens |
| --- | --- |
| login outside `^[A-Za-z0-9_]{1,25}$` (`helix::login_ok`) | row dropped — which is what makes `twitch.tv/<login>` safe to assemble: no slash, query or scheme can get in |
| login or display name carrying a blocked term | row dropped, counted on `/metrics`, **never logged with the text** |
| a name carrying the mark UNO as a whole token | row dropped: no client string may carry the mark ([`legal.md`](legal.md)). Whole token, so Unolingo keeps its name |
| control characters or bidi overrides | stripped from the name; not a reason to drop the row |

**No stream title is ever relayed.** It is the largest piece of unmoderated text the feature could
show, and a name, a viewer count and a picture are enough to decide whether to click. The DTO has no
field for one.

**Nothing screens the contents of a preview image.** That is the residual risk; the answer to a
picture nobody should see is to name the login in `LOCO_TWITCH_BLOCKLIST` and redeploy.

## What reaches the client

One snapshot, two consumers:

- **The game**, over the socket it already holds. `live_streams` follows `players_online`: seatless
  sockets only, a per-socket watermark so an unchanged list goes to nobody, and a send on arrival.
  No ticker: nothing moves on its own.
- **The content page** reads `/live.json`, same-origin, once, on load. It opens no socket.

Six rows on the wire (`LIVE_WIRE_MAX`), twelve in the JSON (`LIVE_PAGE_MAX`): the strip draws three
and the message reaches every seatless socket at once; the page has room and costs one reader one
response. `live_streams` is an `Option` written even when empty, because "nobody is live any more" is
an answer.

## The strip

`components/LiveStrip.svelte`, at the foot of the entry screen.

1. **Absolutely positioned.** `/` is one viewport and never scrolls; a strip taking a row would push
   the lockup off centre the moment somebody went live.
2. **Nobody live is nothing at all.** No plate, no "the category is empty": that would say the game
   is dead. The page is where a would-be streamer is told there is a place to take.
3. **The order is Twitch's**, biggest first. `topLiveStreams` (`game/liveStreams.ts`) cuts and never
   sorts: a second ranking would disagree with the category page it links to.

Entry screen only: once a form is up, a link out beside the nickname field is an exit on the way in.
Never at a table, for the reason the rules modal links nowhere.

Under 46rem it collapses to one line above the connected-player count, which keeps its place: the
count decides whether to start a game, the strip invites you elsewhere, and a phone has height for
one. Under 44rem of height it collapses too, or a row of cards lands on the buttons.

Every `<img>` carries `width` and `height`, or a late preview resizes the strip on the screen the
site's largest paint is measured on.

**No Twitch logo anywhere**: their guidelines forbid redrawing their marks, and `drawnGlyphs.test.ts`
requires every glyph to be ours. The strip writes the word.

## The page

`/live/` and `/fr/en-direct/`, in `PAGES` and in `NAV`.

**Prose first, list second.** Who is streaming this afternoon is wrong tomorrow and has no search
value; what the game gives a stream (the interception window, the five seconds after somebody is down
to one card, streamer mode, playing with a chat) and how to appear in the category are properties of
the product. So the indexable half is in the served markup and the list is filled in the browser.
JSON-LD stays `WebPage`, never `Article`.

The list's section is served with **a paragraph, not a spinner**, which answers both a quiet evening
and a browser with no scripts; nobody is shown "loading". `e2e/tests/live.spec.ts` reads the page
with JavaScript disabled.

`content/LiveArticle.svelte` calls `fetchLiveRows()` (`content/liveList.ts`) on mount and renders
the rows under `{#each}`. Every string is Svelte text or an attribute; `livePage.test.ts` fails on an
`innerHTML` in the module or an `{@html}` in the article, because every one was written by a
stranger.

## The outgoing links

`game/twitchLinks.ts` is the only client module that names Twitch's address, and it assembles it.
The CSP protects against the browser **fetching** off-origin; an `<a href>` is a navigation a person
chooses. So the rule is: one module names one host, every link is built there, and nothing it
produces is ever a `src`. `csp.test.ts` asserts both halves.

Every link carries `noopener noreferrer external`. `noreferrer` because the privacy page promises
nothing about a player reaches a third party; the cost is attribution on Twitch's side, which we do
not need.

## Operating it

Off unless `JANUS_API_KEY` is set: no task, no outbound request, no `live_streams` on the wire, no
log line. One INFO line when it switches on, naming the game id and the period. A key with no URL or
no application id gets a WARN.

Only production polls: `write_app_env` in `.gitlab-ci.yml` passes the credentials on the prod
deploy only, so two stacks never spend one quota.

`/metrics` carries `twitch_polls`, `twitch_poll_errors`, `live_rows_screened`, `twitch_thumb_errors`
and `twitch_streams_live`. Errors climbing with polls means the gateway or Twitch is down;
`live_rows_screened` climbing is the screen doing its job.

nginx proxies `/live.json` and `/live-thumb/`, which with `/ws` is the complete list of what it
forwards. Neither block declares an `add_header`, so both inherit the five security headers without
an include that could be forgotten. `csp.test.ts` pins the list of proxied paths.
