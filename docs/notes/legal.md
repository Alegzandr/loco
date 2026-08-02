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

**Never log `RemoteAddr()` directly.** `src/test/legal.test.tsx` fails if any
non-test file in `server/hub/` does, and if the nginx `log_format` mentions
`$remote_addr` outside the truncating `map`.

## The trademark line

The game is UNO-shaped and says so in its own documentation, never to a player.
`docs/rules.md` §14 already lists where the rules deviate, and the mechanics of a
card game are not copyrightable in any case; what is protectable is presentation,
which is why every card face, name, sound and string here is original.

The one place the mark appears in the product is the disclaimer that names it in
order to disclaim it, which is nominative use. `legal.test.tsx` asserts that no
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

`legal.test.tsx` pins the disclosures that are obligations rather than prose:
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

## Map artwork is AI-generated

The four rooms under `client/public/maps/` were generated, not sourced. That
settles the question that mattered, which was whether a third party had terms
attached to them: nobody does. Two consequences follow, and neither is urgent.

**They are probably not copyrightable, and that is fine.** Both the US Copyright
Office and the EU standard of "the author's own intellectual creation" require
human authorship; an image produced from a prompt has none in the sense either
regime means. So the maps are not owned in the way the code is, and anyone could
in principle use them. Nobody else can claim them either, which is the part that
would have hurt. For a free, non-commercial game, this is an academic problem.

**The generator was ChatGPT Image 2 (OpenAI), on a paid Plus subscription, and
its terms ask nothing of us.** OpenAI's terms of use assign to the user whatever
right, title and interest OpenAI may hold in the output, permit commercial use,
and require no attribution and no notice. The tier matters only because some
other services restrict commercial use on a free plan and not on a paid one;
OpenAI does not draw that line at all, and this was a paid account regardless.
So there is nothing to add to `NOTICE.md`, nothing to display in the credits, and
nothing that would change if this game ever stopped being free.
That assignment cannot manufacture a copyright that never existed, which is why
the paragraph above still stands: the maps are unencumbered rather than owned.

Worth re-reading only if the art is regenerated with a different tool. The terms
attach to whoever ran the generation, not to the image, so a future map from a
different service inherits none of this.

Practical rule: **do not licence the maps under MIT**. `LICENSE` covers the code,
`NOTICE.md` says so explicitly, and offering a licence over something that may
not be protectable in the first place would be the only false statement in the
whole set.

## Who the game says it is

The modal carries no publisher identity, no host and no contact address, on
purpose. That is an editorial decision made outside this note, and this note is
not the place it gets revisited or argued with.
