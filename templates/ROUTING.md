# ROUTING.md — Cross-model lane routing (single authority)

The one rulebook for routing plan tasks between the **KEEP lane**
(in-session frontier inner loop) and the **DELEGATE lane** (emitted spec →
subscription-pool implementer). The plan phase proposes a lane per task;
`/lanes-emit` validates every proposal against this file. Neither the plan
nor the emitter carries its own copy of these rules; where either
disagrees with this file, this file wins.

## Hard rules (non-negotiable; first match wins)

**(a) Security-critical files → KEEP.** A task whose Create/Modify list
touches any file matching an entry in the project's `security_routed`
list (`.lanes/config.md`) routes KEEP. No exceptions, even if the touch
seems trivial. A task that only *tests* one of these without modifying it
is not caught by this rule, but must list the file under Do NOT touch.
Ratified policy: DELEGATE MAY author tests of security code; the
reviewer bears verification that such tests bind to the guard under test
(the sentinel-binding pattern).

**(b) Structural work → KEEP.** Structural means: changes to the app's
layout architecture (new layouts, restructured nesting, layout-file
edits beyond adding/adjusting nav entries); route architecture (moving or
renaming routes, route groups, middleware); or anything cross-cutting
(>4 files, or spanning routes + lib + components in one task). NOT
structural — DELEGATE-eligible with a tight contract: leaf display pages
whose authz and data access live in already-shipped lib functions; adding
a nav link or pointer to an existing layout; new components consumed by
one route.

**(c) New auth-bearing endpoints → KEEP by default.** Auth-bearing = any
route that performs its own authn/authz — bearer guards, secret checks,
session gates — rather than composing existing lib guards. A plan MAY
route one to DELEGATE only with an explicit
`LANE: DELEGATE (ratified: <one-line reason>)` marker AND acceptance
criteria that test every rejection path (401/403 cases). The emitter
verifies both are present; missing either → route KEEP and flag.

## Tier guidance within DELEGATE

Tiers are named in `.lanes/config.md` `tiers`, ordered best→cheapest.

- **Highest tier** — logic-heavy work; anything with nontrivial
  Interfaces.
- **Middle tier** — well-bounded mechanical work following an existing
  pattern.
- **Lowest tier** — near-boilerplate only: test scaffolds, config-shaped
  edits.

Doubt defaults: doubt between KEEP and DELEGATE → KEEP; doubt between
tiers → higher tier. Misrouting up costs tokens; misrouting down costs a
review cycle.

## Interfaces trigger

A task whose Interfaces section can't be written as real code against the
actual codebase is not DELEGATE-ready → KEEP. Applied by the planner when
drafting contracts and re-checked by the emitter at emission time.
