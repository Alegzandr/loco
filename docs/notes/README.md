# Engineering notes

`CLAUDE.md` at the repository root carries the **rules**: what must hold, stated as briefly as it
can be stated. These files carry the **reasoning**: why each rule exists, the bug that produced it,
the alternative that was measured and rejected, and the edge cases a short rule cannot express.

The split exists because `CLAUDE.md` is loaded into context at the start of every session and these
notes are not. A rule everybody needs belongs in the root file; a rationale you need only when you
are actually touching that subsystem belongs here.

**`CLAUDE.md` carries the index**, one row per note and what it covers, next to the rules that point
at it. It is the copy kept current, because it is the one every session reads: a second table here
went stale in silence once already, listing six notes when there were eight.

## Working rules

- **A rule in `CLAUDE.md` should point here**, not restate the reasoning. If a section of the root
  file grows past a handful of lines, the surplus belongs in the matching note.
- **Update both in the same change set.** A rule whose note contradicts it is worse than no note.
- **When a note states an invariant, there must be a test that fails without it.** Two critical bugs
  in this repository sat in the only paths with no test, both described in the documentation as
  already fixed, one of them naming a function that did not exist.
- Prose here is deliberately long-form. That is the point of the file: it is read on purpose, by
  somebody who has already decided to touch the subsystem.
- **A note goes stale in silence, so re-read it against the code before trusting it.** The pass of
  2026-08-02 found five passages describing things that no longer existed: a `.btn-chunky` class and
  a `user-scalable=no` viewport that had both been deleted, a `<MotionConfig reducedMotion="user">`
  replaced by a wrapper component, a rematch still documented as host-only, and the index of these
  notes listing six of them when there were eight.
- **A pass with a script behind it goes stale differently, and worse.** Landing the Svelte migration
  on 2026-08-03 meant repointing paths mechanically, and the machine wrote sentences no human would:
  a module "split out of" itself (the theme module, since dropped), a placeholder `<the motion preference>` left in three
  files, and a table in `client.md` whose five distinct rows had collapsed onto two modules and read
  as duplicates. None of it is caught by `docPaths.test.ts`, because every path in it exists — they
  are just the wrong paths, in prose that still parses. **After a bulk rename, read the prose, not
  the diff.**
