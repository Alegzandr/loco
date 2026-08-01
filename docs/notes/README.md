# Engineering notes

`CLAUDE.md` at the repository root carries the **rules**: what must hold, stated as briefly as it
can be stated. These files carry the **reasoning**: why each rule exists, the bug that produced it,
the alternative that was measured and rejected, and the edge cases a short rule cannot express.

The split exists because `CLAUDE.md` is loaded into context at the start of every session and these
notes are not. A rule everybody needs belongs in the root file; a rationale you need only when you
are actually touching that subsystem belongs here.

| File | Covers |
| --- | --- |
| [`domain-rules.md`](domain-rules.md) | `server/game/` : deck, scoring, draw stacks, LOCO!/catch windows, interrupts, rematch, lobby config |
| [`server.md`](server.md) | `server/hub/` : anti-cheat, bots, sessions, rate limiting, map-loading gate, metrics, logging, stability |
| [`client.md`](client.md) | the realtime path, transport, session restore, protocol validation, i18n |
| [`visual.md`](visual.md) | art direction, board geometry, seats, maps, card face, motion, streamable moments |
| [`audio.md`](audio.md) | the synthesis engine, the track format, the arrangement ladder |
| [`testing-ci.md`](testing-ci.md) | Playwright, the GitLab pipeline, linting, the Docker stacks |

## Working rules

- **A rule in `CLAUDE.md` should point here**, not restate the reasoning. If a section of the root
  file grows past a handful of lines, the surplus belongs in the matching note.
- **Update both in the same change set.** A rule whose note contradicts it is worse than no note.
- **When a note states an invariant, there must be a test that fails without it.** Two critical bugs
  in this repository sat in the only paths with no test, both described in the documentation as
  already fixed, one of them naming a function that did not exist.
- Prose here is deliberately long-form. That is the point of the file: it is read on purpose, by
  somebody who has already decided to touch the subsystem.
