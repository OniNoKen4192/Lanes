# Lanes v2 "Roundabout" — declared-trust automation (design spec)

**Date:** 2026-07-25
**Status:** approved by Ken (design presented and accepted in session)
**Author:** Claude, with Ken's decisions at every fork
**Graduates:** whiteboard idea "v2: Roundabout"

## 1. What this is

Today every stage change in the Lanes pipeline is a human handoff: run
`/lanes-emit`, create each worktree, dispatch each implementer, dispatch
each reviewer, act on each verdict, advance to the next task. In a
project where the pipeline has proven itself, that supervision is
friction, not safety. Roundabout adds **declared, per-project automation**
that removes those handoffs — up to a full conveyor that takes an
approved plan and returns a finished branch — while keeping a
non-negotiable human floor.

Decisions (Ken's, at each fork):

1. **End-state: full conveyor.** Approve the plan, walk away; the session
   drives emit → dispatch → review → verdict → merge across the whole
   task graph.
2. **Trust is declared, not earned.** Ken flips the setting in
   `.lanes/config.json` when he judges a project ready. No tracked
   trust state, no thresholds. The ledger history is evidence a human
   consults, not a mechanism.
3. **FIX loops are capped** by `automation.max_fix_rounds` (default 2);
   at the cap the task parks and the conveyor moves on.
4. **KEEP tasks run inline.** The session executes ordinary KEEP tasks
   itself via the normal superpowers loop, so the graph keeps flowing.
   Only security-routed tasks park for the human.
5. **The setting is a trust ladder**, not independent toggles:
   `manual | verdicts | conveyor`.
6. **Architecture: thin `/lanes-run` command + validator support.**
   Orchestration stays prose the session follows; everything
   machine-checkable lives in `bin/lanes-validate.mjs` with conformance
   tests — the same cut as every existing piece of Lanes.

## 2. Config schema — the `automation` block

A new OPTIONAL top-level block in schema-v1 `.lanes/config.json`:

```json
"automation": {
  "level": "conveyor",
  "max_fix_rounds": 2
}
```

- `level` (string, required within the block): exactly one of
  `"manual"`, `"verdicts"`, `"conveyor"`. Any other value is a refusal
  naming the three allowed values (same pattern as
  `backend.approval_mode`).
- `max_fix_rounds` (number, optional, default `2`): an integer ≥ 1.
  Non-integers, zero, negatives, and non-numbers are refusals. This is
  the schema's first optional-with-default field and first numeric field
  besides `schema_version`; the validator's field-type handling gains an
  explicit integer-≥-1 case for it.
- Block absent entirely ⇒ `level` is `manual` and nothing changes —
  every existing config remains valid with identical behavior.
- Validation stays strict fail-closed: unknown keys inside `automation`
  are refusals, exactly like every other block.
- `schema_version` stays `1`. The block is additive and optional;
  validator and config ship together in the plugin. An OLDER validator
  reading a NEWER config that carries `automation` refuses it with the
  existing unknown-key error — loud, correct, and self-explaining.

`loadConfig` normalizes the parsed config so downstream consumers never
branch on absence: after validation, `config.automation` is always
present with `level` and `max_fix_rounds` filled in (defaults
`"manual"` / `2`).

## 3. Ladder semantics

- **`manual`** — today's behavior everywhere. No command, agent, or
  skill behaves differently.
- **`verdicts`** — the human still emits and dispatches each spec; the
  session acts on reviewer verdicts unattended:
  - APPROVE → commit the work inside the worktree, merge
    `lanes/<task-id>` into the working branch, `worktree remove`, report.
  - FIX → apply the delta spec, re-dispatch the implementer and reviewer,
    up to `max_fix_rounds` rounds; at the cap the task parks.
  - REJECT → always stops for the human. No automation level changes
    this.
- **`conveyor`** — `/lanes-run <plan>` drives the whole graph
  (Section 4).

`verdicts` behavior is a strict subset of `conveyor` behavior: the
conveyor's per-task verdict handling IS the `verdicts` rule set.

## 4. `/lanes-run <plan>` — the conveyor

Preconditions (refuse with a clear message if unmet):

- `.lanes/config.json` valid and `automation.level` is `"conveyor"` —
  the command refuses to run at `manual` or `verdicts` (the declared
  trust level is the authorization).
- The plan file exists and carries a Task/Lane Map.

Procedure:

1. **Emit if needed.** If the plan's DELEGATE tasks lack spec files in
   `tasks_dir`, run the `/lanes-emit` procedure first (it re-validates
   lanes against ROUTING.md as always).
2. **Walk the Task/Lane Map in dependency order**, serially:
   - **DELEGATE task** → full existing cycle: `worktree create --spec`,
     dispatch `lanes-implementer` (spec + worktree path), dispatch
     `lanes-reviewer` (spec + report + same worktree path), handle the
     verdict per Section 3.
   - **Ordinary KEEP task** → the session executes it inline via the
     normal superpowers loop (implement, test, commit), as it already
     does in SDD.
   - **Security-routed KEEP task** → **park** it and everything
     downstream of it. Security-routed work never runs unattended.
3. **Parking, not halting.** A task parks — and the conveyor moves on to
   every task not depending on it — when any of these occurs:
   - reviewer REJECT
   - FIX rounds exhausted (`max_fix_rounds`)
   - implementer BLOCKED
   - implementer BACKEND_FAILURE
   - RATE_LIMITED after tier fallback exhausts all configured tiers
   - security-routed (parked on arrival, per step 2)
   A parked task's worktree stays inspectable (existing REJECT
   semantics); the conveyor never `worktree remove --force`s a parked
   task.
4. **Run report.** The run ends when nothing dispatchable remains. The
   session reports: tasks landed (with merge commits) and tasks parked
   (each with its reason and, where applicable, its worktree path).
   Every task appends to the pipeline ledger as it does today.

Dispatch is serial in v2 — parallel dispatch of independent DELEGATE
tasks is Highways (v3) territory.

## 5. Safety floor — invariant at every level

- Security-routed work never runs unattended.
- REJECT is always a human decision.
- The conveyor never pushes to a remote; merges stay local.
- No per-task enforcement changes: scope gate, audit, worktree
  isolation, and immutable-spec amendments all apply to every dispatch
  exactly as built. Automation changes who turns the crank, never what
  the machinery enforces.

## 6. Deliverables

- **`bin/lanes-validate.mjs`** — `automation` entry in `SCHEMA_V1` +
  `OPTIONAL_BLOCKS`; enum and integer validation; `loadConfig`
  normalization (defaults filled in); doctor: the schema check already
  covers block validity via `loadConfig`, and the doctor report gains an
  informational line stating the declared automation level.
- **`commands/lanes-run.md`** — thin command: preconditions, then the
  Section 4 procedure (following the established thin-command pattern of
  `commands/lanes-doctor.md`).
- **`skills/lanes/SKILL.md`** — Section C notes the ladder: at
  `verdicts`+, verdict handling is unattended per this spec; at
  `conveyor`, `/lanes-run <plan>` replaces the manual Section C
  sequence. Section A gains one sentence pointing at it.
- **`templates/config.example.json`** — the block, with
  `"level": "manual"` (the example must not model turning automation on
  by default).
- **`templates/config.example.md`** — an `## automation` section
  documenting the ladder, the default-when-absent rule, the fix cap,
  and the safety floor.
- **Tests** —
  - behavioral (`tests/validator.test.mjs`): valid block accepted at
    each level; absent block accepted and normalized to
    `manual`/2; unknown key inside `automation` refused; bad `level`
    refused; `max_fix_rounds` of `0` and `"2"` refused.
  - structural (`tests/conformance.test.mjs`): `commands/lanes-run.md`
    exists and names the three park-worthy verdict outcomes; SKILL.md
    references `/lanes-run`; `config.example.md` documents
    `automation`.
- **`whiteboard.md`** — move "v2: Roundabout" to Graduated with a link
  to this spec.

## 7. Out of scope (YAGNI)

- Earned/auto-revoking trust (ledger-driven graduation or demotion).
- Parallel dispatch of independent DELEGATE tasks (Highways, v3).
- Remote push automation of any kind.
- Automation-aware notifications/paging; the run report is the surface.
