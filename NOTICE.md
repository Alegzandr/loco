# Notices

## Trademarks

LOCO! is an independent, non-commercial game. It is **not affiliated with,
endorsed by, sponsored by or connected to Mattel, Inc.** in any way.

UNO is a registered trademark of Mattel, Inc. It appears in this repository's
documentation only descriptively, to say what kind of game this is, and it does
not appear in any player-facing string in the running game. The card names, the
card faces, the artwork, the wording, the sounds and the code are original to
this project. The mechanics of a card game are not themselves protected by
copyright; the presentation of one is, which is why none of it is borrowed.

Nothing in the client renders the word UNO. Should that stop being true, it is a
bug, not a decision.

## Licence

The source code in this repository is released under the MIT licence
(see [`LICENSE`](LICENSE)).

That covers everything in the repository that is authored here, the rooms
included: a room is a scene builder under `client/src/components/scene/maps/`,
rendered in the browser by [three.js](https://threejs.org) (MIT). The rooms used
to be generated images, kept outside the licence for the reason
[`docs/notes/legal.md`](docs/notes/legal.md) still records; they are code now.

## Third-party services

LOCO! reads the Twitch Helix API to show which channels are streaming the game. It does so through a
gateway that holds the credential (`JANUS.md`), and **a player's browser never contacts Twitch**: the
server fetches the list and the preview images and re-serves them from this origin.

Twitch is a trademark of Twitch Interactive, Inc. LOCO! is neither affiliated with nor endorsed by
Twitch, and **none of their marks are reproduced anywhere in this project** — the interface writes
the word in text, drawn in the same typeface as everything else around it. Nothing of theirs is
redistributed here, so there is no entry for them in the table below.

## Third-party components

Shipped inside the built client:

| Component | Licence |
| --- | --- |
| Kenney game assets — City Kit (Suburban, Commercial, Roads), Nature Kit, Car Kit, Mini Characters, Pirate Kit, Fantasy Town Kit, Space Kit, Holiday Kit (`client/public/models/`, packed by `make models`; [kenney.nl](https://kenney.nl)) | CC0 1.0 |
| Quaternius — Temple, Torii Gate (`client/public/models/quaternius/`, via [poly.pizza](https://poly.pizza)) | CC0 1.0 |
| Svelte | MIT |
| Valibot | MIT |
| Fredoka Variable (`@fontsource-variable/fredoka`) | SIL Open Font License 1.1 |
| Nunito Variable (`@fontsource-variable/nunito`) | SIL Open Font License 1.1 |

The two typefaces are the reason this file has to exist at all: the OFL requires
its notice to travel with the font files, and the fonts are self-hosted rather
than fetched from a CDN, so they travel with the build.

Running on the server:

| Component | Licence |
| --- | --- |
| gorilla/websocket | BSD-2-Clause |
| [LDNOOBW word lists](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) (`server/game/wordlists/`) | CC BY 4.0 |

The word lists are Shutterstock's "List of Dirty, Naughty, Obscene and Otherwise
Bad Words", 19 languages of it, vendored into the repository and compiled into
the server binary. They are what the nickname filter matches against
(`server/game/nickname.go`); the game holds none of those words itself. CC BY 4.0
requires the attribution, which is this entry, and permits the redistribution,
which is the vendoring. Nothing about them reaches the client: they are never
sent on the wire and they are not in the browser bundle.

Every sound effect is synthesised at runtime by `client/src/audio/sfx.ts`: there
is no sample library to credit for any of them.

The music is not. The bed is nineteen loops from Abstraction (Tallbeard Studios),
*Music Loop Bundle*, released under **CC0 1.0** — copyright waived, no
attribution required, commercial use and modification permitted. This entry is
therefore a credit and not an obligation, and it is here because the work
deserves one:

| Work | Author | Licence |
| --- | --- | --- |
| [Music Loop Bundle](https://tallbeard.itch.io/music-loop-bundle) (`client/public/music/`) | [Abstraction](https://abstractionmusic.com/) | CC0 1.0 |

Nineteen loops of it are vendored, normalised to −18 LUFS and re-encoded to MP3; they
are served from this origin like every other asset, never from a CDN. The
authors ask that their work not be used for NFTs, for training machine-learning
models, or resold unmodified, and none of those happens here.
