# Notices

## Trademarks

LOCO is an independent, non-commercial game. It is **not affiliated with,
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

That covers the code, and only the code. The map images under
`client/public/maps/` are AI-generated: no third party holds rights in them, and
they are deliberately **not** offered under the MIT licence, because an image
produced from a prompt very likely carries no copyright to licence in the first
place. See [`docs/notes/legal.md`](docs/notes/legal.md).

## Third-party components

Shipped inside the built client:

| Component | Licence |
| --- | --- |
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

No audio file ships with the client: every sound and every note is synthesised
at runtime by `client/src/audio/`, so there is no sample library to credit and
no music licence to hold.
