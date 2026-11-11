# Legal and privacy

What the game is allowed to know about a player, what it says about it, and why each sentence of
that is there.

## The position

The game is free, non-commercial, account-free and asks for nothing but a name. That is the whole
compliance strategy: almost every GDPR obligation scales with what is collected, and the cheapest
way to meet them is to keep having nothing. Every rule below keeps that true as features land; the
first analytics snippet or "remember me" account turns a two-screen policy into a real one.

## What is processed

| Data | Where | Why | How long |
| --- | --- | --- | --- |
| Nickname | Server memory, and the other players' screens | Seats need names | Until the table is gone |
| Game actions | Server memory | Server authority, anti-cheat | Until the table is gone |
| Session token | `sessionStorage` + server memory | Reclaiming a seat after a reload | Until the tab is closed |
| Preferences (language, graphics, sound, streamer mode, colour shapes, motion, vibrations, last nickname) | `localStorage` only | Player convenience | Until the player clears site data |
| Network prefix (`a.b.c.0/24`, `pfx::/48`) | Server + nginx logs | Diagnosing faults, seeing abuse | 30 days maximum |
| A match in flight | `LOCO_SNAPSHOT_PATH` on disk | Surviving a deploy without ending matches | Minutes, dropped once reclaimed |

**There is no user-generated text on that list, and that is a position.** The only thing a player
can say to another is one of three fixed emotes on the game-over screen
(`loco-hub/src/table/emotes.rs`), sent as an identifier from a closed server-side set and never
stored, logged or carried across a deploy. Free text is a moderation surface, which means
retention, reports and a process this game does not have. **Anything that puts free text between
two players is a legal change, not a technical one.**

**Legal basis: legitimate interest** (Art. 6(1)(f)) for running the service. Not consent: there is
nothing a player could refuse and still play, and a consent banner over the ordinary operation of a
game is a dark pattern.

## Why there is no cookie banner

There is no cookie. `localStorage` and `sessionStorage` fall under the same ePrivacy rule, and both
exemptions apply:

- The session token is **strictly necessary** for the service the player requested (their seat).
- The preferences are **user-set preferences**, written only because the player flipped a switch,
  read by nothing but the same browser.

Nothing is stored for measurement, advertising or recognition. **Store one thing that is, and a
banner becomes mandatory.** That is the tripwire.

## The one third party, and which side of the line it is on

The home screen and `/live/` show who is streaming the game on Twitch. A preview loaded from Twitch
would be a request from the reader's browser carrying their address, user agent and referer to a
company outside the EU — the tripwire exactly.

**The browser never makes that request.** The server asks, through the Janus gateway, on a timer,
carrying nothing about anybody, keeps the answer in memory and serves the pictures from this origin.
The table above gains no row: the request would be identical if nobody were reading the page.

Two sentences in the copy carry this and are pinned by `legal.test.ts`: nothing is loaded from
anyone else's server, *the stream previews included*, and which of the two (server or browser) makes
the request. Reword them; keep the substance. The mechanism is in [`live.md`](live.md).

## Addresses are truncated at the point of writing

`loco-hub/src/net/privacy.rs` (the `ClientNet` extractor, `truncate_addr`) and the `anonymised`
`log_format` in `client/nginx.conf` cut an address to `/24` (IPv4) or `/48` (IPv6) before it is
written, rather than relying on a retention policy:

1. A full address never stored cannot be leaked, subpoenaed or forgotten in a backup. A retention
   promise is only as good as the process behind it, and there is no such process here.
2. Nothing reads an address to identify a person. Lines are correlated by `conn=`; the prefix only
   tells two networks apart when one is flooding.

**Never read the peer's address outside `privacy.rs`.** `src/test/legal.test.ts` walks every module
under `server/crates/loco-hub/src/` (recursively, `internal_tests/` excepted) and fails on
`remote_addr` or `peer_addr()` outside `privacy.rs`, and fails if an nginx `log_format` mentions
`$remote_addr` outside the truncating `map`.

## The trademark line

The game is UNO-shaped and says so in its documentation, never to a player. `docs/rules.md` §14
lists where the rules deviate; card-game mechanics are not copyrightable, presentation is, which is
why every card face, name, sound and string here is original.

The one place the mark appears in the product is the disclaimer that names it in order to disclaim
it (nominative use). `legal.test.ts` asserts no other player-facing string in either language
contains it, and `seo.test.ts` does the same over `src/content/`, exempting `legal.ts` by name. That
exemption **is** the trademark position. If either assertion ever has to be relaxed, the disclaimer
stops being defensible: revisit the decision, not the test.

## Where the copy lives

`client/src/content/legal.ts`, as `LEGAL: Record<Lang, readonly LegalDoc[]>`, rendered by
`content/LegalArticle.svelte` onto one page — `/privacy/` and `/fr/confidentialite/` — linked from
every footer (`SiteFooter.svelte`, `SiteDrawer.svelte`).

- **Keyed by language**, so a document cannot exist in one language only.
- **In the game's voice**, tutoiement included. Legal accuracy wins where the two pull apart.
- **Read at build time, shipped in no bundle.** `src/i18n/en.ts` is downloaded by every player; these
  documents are long and read by almost nobody.
- **One page, three anchors** (`#privacy`, `#terms`, `#credits`): one URL to send, an anchor to send
  one document, and no script needed.
- **A page, not a modal**, because a policy has to be linkable: from a content page, by a crawler, by
  somebody sending the terms. `LEGAL` is in `PAGES`, so it gets a canonical, an `hreflang` pair and a
  sitemap entry.

`legal.test.ts` pins the disclosures that are obligations rather than prose: legal basis, retention
period, the rights list, the supervisory authority (CNIL), the EU statement, the browser-storage
disclosure, the no-banner explanation, the Mattel disclaimer, the Twitch sentence and the governing
law. **Reword freely; the test has to keep passing.**

`LEGAL_UPDATED` is a hand-written date per language, printed at the foot of the page. Change it when
the substance changes, not for a typo: a date that moves for a reworded sentence teaches readers to
ignore it.

## Fonts

Fredoka and Nunito are OFL 1.1 and self-hosted, so the licence travels with them as
`client/public/licenses.txt`. Regenerate it from `node_modules/@fontsource-variable/*/LICENSE` when
either font is bumped or replaced.

## Generated art: the painted plates

The rooms are code: a builder in `client/src/components/scene/maps/`, rendered by three.js (MIT),
covered by `LICENSE` like the rest of the client. The painted plates under
`client/src/assets/plates/` are not (`docs/notes/visual.md`, "A painted room"):

- **Probably not protectable, so not offered under MIT.** Offering a licence over something that may
  not be protectable would be the one false statement in `NOTICE.md`; the plates are unencumbered
  rather than owned. The input is this project's own render and prompt, which is more authorship than
  a bare prompt and still not a settled claim; nothing leans on one.
- **No provider terms attach.** A plate is painted locally by FLUX.2 Klein 4B (`tools/plates/`), so
  what attaches is the licence the weights were published under. **That licence is the one thing to
  read before a plate reaches production, and it is the owner's to read**: this note records where
  the question is, not an answer.
- **Nothing leaves the player's browser for it.** A plate is a file on this origin; `img-src 'self'`
  is untouched.

## Who the game says it is

The page carries no publisher identity, no host and no contact address, on purpose. That is an
editorial decision already taken, and not reopened here.
