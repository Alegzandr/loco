# Legal and privacy

What the game is allowed to know about a player, what it says about it, and why
each sentence of that is there. `CLAUDE.md` carries the rules; this note carries
the reasoning and the parts that are still open.

## The position this game is in

It is free, non-commercial, account-free and asks for nothing but a name. That is
not a technicality, it is the whole compliance strategy: almost every obligation
in the GDPR scales with what you collect, and the cheapest way to satisfy them is
to keep having nothing. Every rule below exists to keep that true as features
land, because the first analytics snippet or the first "remember me" account
turns a two-screen policy into a real one.

## What is actually processed

| Data | Where | Why | How long |
| --- | --- | --- | --- |
| Nickname | Server memory, and the other players' screens | It is the game: seats need names | Until the table is gone |
| Game actions | Server memory | Server authority, anti-cheat | Until the table is gone |
| Session token | `sessionStorage` + server memory | Reclaiming a seat after a reload | Until the tab is closed |
| Preferences (language, theme, sound, streamer mode, last nickname) | `localStorage` only | Player convenience | Until the player clears site data |
| Network prefix (`a.b.c.0/24`, `pfx::/48`) | Server + nginx logs | Diagnosing faults, seeing abuse | 30 days maximum |
| A match in flight | `LOCO_SNAPSHOT_PATH` on disk | Surviving a deploy without ending matches | Minutes, dropped once reclaimed |

**There is no user-generated text on that list, and that is a position rather than
an omission.** The only things a player can say to another are the three fixed
emotes on the game-over screen (`hub/emotes.go`), and they travel as an
identifier out of a closed server-side set: a client cannot invent a fourth, and
nothing said is stored, logged or carried across a deploy. Free text would be a
moderation surface, and a moderation surface means retention, reports and a
process — none of which this game has, and all of which the "collect nothing"
position would have to be rewritten around. **Anything that would put free text
between two players is a legal change, not a technical one.**

**Legal basis: legitimate interest** (Art. 6(1)(f)) for running the service and
keeping it playable. Not consent, because there is nothing here a player could
meaningfully refuse and still play, and a consent banner over the ordinary
operation of a game is exactly the dark pattern the ePrivacy directive was not
asking for.

## Why there is no cookie banner

There is no cookie. `localStorage` and `sessionStorage` are covered by the same
ePrivacy rule as cookies, and both exemptions apply here:

- The session token is **strictly necessary** for the service the player
  explicitly requested (their seat).
- The preferences are **user-set preferences**, written only because the player
  flipped a switch, and never read by anything but the same browser.

Neither ever leaves the device for an unrelated purpose, and nothing is stored
for measurement, advertising or recognition. Add one thing that is, and this
paragraph stops being true and a banner becomes mandatory. That is the tripwire
worth remembering.

## The one third party, and which side of the line it is on

The home screen and `/live/` show who is streaming the game on Twitch. That is a
third party, and the tripwire above is exactly what it could have tripped: a
preview image loaded from Twitch is a request from the reader's browser carrying
their address, their user agent and a referer, to a company outside the EU.

It does not, because **the browser never makes that request**. Our server asks —
through the Janus gateway, on a timer, carrying nothing about anybody — keeps the
answer in memory, and serves the pictures from this origin. The table above gains
no row, and that is the whole point of writing this section: nothing new about a
player is processed, because the request would be made in exactly the same way if
nobody were reading the page.

Two sentences in the copy carry this and are pinned by `legal.test.ts`: the
promise that nothing is loaded from anyone else's server, which now says *the
stream previews included*, and a new section saying which of the two makes the
request. Reword them; do not delete the substance. The reasoning, and what it
costs the server, is in [`live.md`](live.md).

## Addresses are truncated at the point of writing

`hub/privacy.go` (`truncateAddr`, `Client.netPrefix`) and the `anonymised`
`log_format` in `client/nginx.conf` both cut an address down to `/24` (IPv4) or
`/48` (IPv6) before it is written. Two reasons it is done at write time rather
than by a retention policy:

1. A full address that is never stored cannot be leaked, subpoenaed, or
   forgotten about in a backup. A retention promise is only as good as the
   process behind it, and this project has no such process.
2. Nothing here reads an address to identify a person. Lines are correlated by
   `conn=` (the connection ID); the prefix exists only to tell two networks
   apart when one of them is flooding.

**Never log `RemoteAddr()` directly.** `src/test/legal.test.ts` fails if any
non-test file in `server/hub/` does, and if the nginx `log_format` mentions
`$remote_addr` outside the truncating `map`.

## The trademark line

The game is UNO-shaped and says so in its own documentation, never to a player.
`docs/rules.md` §14 already lists where the rules deviate, and the mechanics of a
card game are not copyrightable in any case; what is protectable is presentation,
which is why every card face, name, sound and string here is original.

The one place the mark appears in the product is the disclaimer that names it in
order to disclaim it, which is nominative use. `legal.test.ts` asserts that no
other player-facing string in either language contains it. If that assertion ever
has to be relaxed, the disclaimer stops being defensible and this is the decision
to revisit, not the test.

## Where the copy lives

In `client/src/content/legal.ts`, as `LEGAL: Record<Lang, readonly LegalDoc[]>`,
rendered by `content/LegalArticle.astro` onto one page: `/privacy/` and
`/fr/confidentialite/`, linked from every footer: last in the home page's row
of links, at the right-hand end of the content pages' bar. Four
deliberate consequences:

- The type is keyed by language, so a document cannot exist in one language only.
- The copy is held to the game's voice, tutoiement included, instead of reading
  like a pasted template. Legal accuracy wins wherever the two pull apart.
- It is read at build time and ships in no bundle. `src/i18n/en.ts` is downloaded
  by every player on every visit; these three documents are long and are read by
  almost nobody.
- It is one page with three anchored sections (`#privacy`, `#terms`,
  `#credits`), not three pages and not a tab strip. Three URLs would make a
  reader who landed on the wrong one go looking; the tab strip needed component
  state, and these pages run no script.

**It used to be a modal over the lobby, and the reason it stopped being one is
that a policy has to be linkable.** The modal lived on one screen of one
application: there was no way to send somebody the terms, no way to reach it from
a content page, and nothing for a crawler or a future store listing to point at.
The argument for the modal was that a navigation away from the table costs a
player their seat — but the link was on the *lobby*, where no seat has been taken
and nothing is lost by leaving. `LEGAL` is in `PAGES` like everything else, so it
gets a canonical, an `hreflang` pair and a sitemap entry.

`legal.test.ts` pins the disclosures that are obligations rather than prose:
legal basis, retention period, the rights list, the supervisory authority, the EU
statement, the browser-storage disclosure, the no-banner explanation, the Mattel
disclaimer and the governing law. **Reword freely, but the test has to keep
passing**: it is the difference between editing a sentence and deleting a
disclosure.

`LEGAL_UPDATED` is a hand-written date per language, printed at the foot of the
page. Change it when the substance changes, not when a typo is fixed: a date that
moves for a reworded sentence teaches a reader to ignore it.

`seo.test.ts` asserts that no file under `src/content/` says UNO, and exempts
`legal.ts` by name. That exemption **is** the trademark position: the disclaimer
naming the mark in order to disclaim it is the one place it may appear, and the
test failing anywhere else is what keeps that true.

## Fonts

Fredoka and Nunito are OFL 1.1 and are self-hosted, which means the build
redistributes the font files and the licence has to travel with them. It does, as
`client/public/licenses.txt`, served as a static file rather than shown in the
game. Regenerate it from `node_modules/@fontsource-variable/*/LICENSE` if either
font is bumped or replaced.

## The rooms are code, and the photographs they replaced are gone

The four rooms used to be generated images shipped as static files, and this note carried a
section on what that meant: probably not copyrightable, unencumbered rather than owned, generated on
a paid OpenAI account whose terms asked nothing, and **deliberately not licensed under MIT** because
offering a licence over something that may not be protectable would have been the one false
statement in the set. `NOTICE.md` said the same.

None of that applies any more. A room is now a builder in `client/src/components/scene/maps/`, a few
hundred lines of TypeScript placing coloured blocks, rendered in the browser by three.js (MIT, and
listed in `NOTICE.md` like every other dependency). It is authored the way the rest of the client is
authored, it is covered by `LICENSE` the way the rest of the client is, and there is no third party
with terms attached to any of it. The section is kept as a paragraph rather than deleted, because
the reasoning is worth having if generated art ever comes back: the terms attach to whoever ran the
generation, not to the image, and a licence cannot manufacture a copyright that never existed.

## Who the game says it is

The page carries no publisher identity, no host and no contact address, on
purpose. That is an editorial decision made outside this note, and this note is
not the place it gets revisited or argued with.
