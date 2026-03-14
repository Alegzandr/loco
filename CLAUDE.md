# CLAUDE.md

## Project mission

Build and maintain a premium-quality real-time multiplayer online card game inspired by UNO.

Primary goals:
- real-time, low-latency multiplayer gameplay
- nickname-only access with no accounts
- server-authoritative anti-cheat architecture
- smooth, polished visuals and animations
- strong test coverage with TDD
- accurate, continuously maintained documentation
- Dockerized local development and deployment

---

## Non-negotiable product constraints

- No login, signup, email/password, or OAuth
- Players join with nickname only
- Server authority is mandatory
- Real-time reaction/counter mechanics are mandatory
- Dockerization is mandatory
- TDD is mandatory
- `README.md` must always stay in sync with the codebase
- This file (`CLAUDE.md`) must always stay in sync with the codebase

---

## Repository operating rules

When working in this repository, always follow this loop:

1. Understand the required behavior
2. Update or add tests first for non-trivial behavior
3. Implement the smallest correct change
4. Run tests and fix failures
5. Update `README.md` if setup, architecture, commands, features, or limitations changed
6. Update `CLAUDE.md` if conventions, architecture, workflows, or decision rules changed

Do not consider work complete until code, tests, and docs all align.

---

## Documentation maintenance rules

### Always update `README.md` when changing:
- setup steps
- commands
- Docker workflow
- architecture summary
- features
- current status
- limitations
- environment variables
- local dev instructions
- test instructions

### Always update `CLAUDE.md` when changing:
- repository workflow
- architecture decisions
- coding conventions
- testing strategy
- definition of done
- folder structure conventions
- operational rules for future Claude sessions

Never leave docs outdated.

---

## Engineering priorities

In order:
1. low latency
2. server-authoritative correctness
3. smooth user experience
4. deterministic behavior
5. maintainable architecture
6. testability
7. local developer experience

If tradeoffs are necessary, favor these priorities in order.

---

## Architecture principles

### Authority
The server owns:
- room state
- player state
- hand state
- deck/discard state
- turn order
- legality validation
- timing windows
- counter/catch resolution
- penalties
- winner determination

The client owns:
- presentation
- local interaction
- rendering
- animation
- sending player intents only

Never trust the client for game legality or hidden information.

### Realtime model
- Use a persistent low-latency bidirectional transport
- Prefer event-driven authoritative state updates
- Resolve simultaneous or reaction-based interactions on the server
- Make timing windows explicit and testable
- Favor deterministic resolution logic

### Fairness model
For reaction-based interactions:
- the server records event receipt times
- the server defines the valid reaction window
- only valid server-received events inside the window are considered
- tie-breaking must be deterministic and documented
- client visuals may be optimistic, but server resolution is final

---

## Preferred implementation style

- small cohesive modules
- explicit domain types
- minimal hidden magic
- pure game/domain logic where possible
- side effects isolated at boundaries
- clear protocol contracts
- strong validation on all incoming messages
- concise comments only where useful

---

## Testing policy

TDD is mandatory.

### Required testing approach
- write or update tests before implementing non-trivial behavior
- prioritize domain logic coverage
- use deterministic tests for timing-sensitive behavior
- integration-test critical multiplayer flows
- add end-to-end coverage for essential happy paths where practical

### Minimum required test coverage areas
- room creation
- room join by code
- nickname-only entry
- game start conditions
- turn progression
- legal move validation
- illegal move rejection
- skip/reverse/draw behavior
- wild behavior
- draw penalties
- win detection
- last-card declaration mechanic
- counter/catch timing windows
- simultaneous reaction resolution
- reconnect behavior if implemented
- protocol validation and rejection paths

### Test discipline
- avoid brittle tests
- prefer deterministic clocks/timers in server logic
- keep tests fast
- keep tests targeted
- cover business/game rules more heavily than UI details

---

## README requirements

`README.md` must always include, at minimum:
- project overview
- product goals
- stack summary
- why the stack was chosen
- local setup
- Docker usage
- environment variables
- test commands
- architecture summary
- current implemented features
- known limitations
- development workflow

If the repo changes, the README must change with it when relevant.

---

## Docker requirements

The project should support a straightforward full-stack local run.

Expected artifacts:
- service Dockerfiles
- `docker-compose.yml`
- `.env.example`

The Docker setup should be documented in the README and kept current.

---

## Anti-cheat requirements

The system must defend against:
- illegal card submissions
- turn spoofing
- hidden-state manipulation
- replayed messages
- forged reaction events
- forged declaration events
- duplicated event spam
- client-tampered hand state
- client-side win claims

Required posture:
- validate every message
- reject illegal or out-of-turn actions
- keep authoritative hidden state server-side
- avoid trusting client timestamps for outcomes
- make server outcomes final

---

## Performance expectations

Optimize for:
- low-latency interaction
- smooth animation and rendering
- minimal unnecessary round trips
- efficient state updates
- predictable server behavior under concurrent play

Do not introduce heavy abstractions that harm responsiveness without clear benefit.

---

## UX expectations

The game should feel polished:
- smooth card animations
- clear turn indicators
- strong feedback for penalties and counters
- clean lobby flow
- responsive layout
- premium feel over basic utility UI

Visual polish matters. This is not just a protocol demo.

---

## Decision-making rules

When multiple valid options exist:
- prefer the option that improves realtime responsiveness
- prefer simpler architecture when performance is comparable
- prefer maintainable high-performance tools over hype-driven choices
- avoid adding persistence unless it provides real value
- avoid adding services that are not justified by the current product scope

Document significant architectural choices in the README and, when relevant, here.

---

## Definition of done

A task is done only when all are true:
- code is implemented
- relevant tests exist
- tests pass
- docs are updated
- Docker/dev workflow still works
- behavior matches documented expectations

---

## Expected repository sections

Adjust this section as the repo evolves. Keep it current.

Typical structure:
- `client/` frontend app
- `server/` authoritative realtime game server
- `shared/` protocol/types if used
- `docs/` optional supplemental docs
- root config / Docker / env files

If structure changes, update this file and the README.

---

## Instructions for future Claude sessions

When starting work:
1. read this file
2. read `README.md`
3. inspect current project structure
4. identify any doc drift before coding
5. use TDD for non-trivial changes
6. update docs in the same change set

Never allow `CLAUDE.md` or `README.md` to become stale.
