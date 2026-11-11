# Engineering notes

`CLAUDE.md` at the repository root carries the **rules**: what must hold, stated as briefly as it can
be. These files carry the **reasoning**: why each rule exists, the bug behind it, the alternative
measured and rejected, and the edge cases a short rule cannot express.

`CLAUDE.md` is loaded into every session and these notes are not: a rule everybody needs belongs
there, a rationale needed only when touching a subsystem belongs here. **`CLAUDE.md` carries the
index**, one row per note; there is no second copy here to go stale.

The notes: `architecture.md` (the target architecture and the road to it), `domain-rules.md`,
`server.md`, `client.md`, `visual.md`, `audio.md`, `testing-ci.md`, `seo.md`, `legal.md`, `live.md`.

## Working rules

- **A rule in `CLAUDE.md` points here**, it does not restate the reasoning. If a section of the root
  file grows past a handful of lines, the surplus belongs in the matching note.
- **Update both in the same change set.** A rule whose note contradicts it is worse than no note.
- **When a note states an invariant, there must be a test that fails without it.**
- **Write the present.** A note says what holds and why; how the code got here is in `git log`.
- **A note goes stale in silence: re-read it against the code before trusting it.** After a bulk
  rename, read the prose, not the diff — `docPaths.test.ts` proves a path exists, not that it is the
  right one.
