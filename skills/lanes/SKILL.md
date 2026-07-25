---
name: lanes
description: Use when planning or executing work in a project set up with Lanes (a `.lanes/config.json` exists) — assigns KEEP/DELEGATE lanes during planning and routes the emit→implement→review pipeline.
---

# Lanes — cross-model task routing

Lanes routes each task in a plan to the cheapest model that can do it
correctly: the in-session frontier model for planning, review, and
security-critical work (the **KEEP** lane); a configured DELEGATE backend,
subscription-pool priced, for well-bounded implementation work (the
**DELEGATE** lane). It is an add-on to superpowers, not a replacement for
it — Lanes changes what a plan's tasks look like and adds a compile/dispatch
step between planning and execution; it does not touch superpowers' own
brainstorming, TDD, or review loops.

This skill has two jobs: give you the whole pipeline in one screen (Section
A), and hook superpowers `writing-plans` so plans come out of the door
already lane-tagged (Section B — the load-bearing part). Sections C and D
cover what happens after the plan and what has to be true before any of this
applies.

## Section A — the pipeline in one screen

Four stages, one direction, KEEP and DELEGATE never mixing mid-task:

1. **Plan** (superpowers `writing-plans`, hooked by Section B below). You,
   the frontier planner, break the work into tasks and assign each one a
   lane per `${CLAUDE_PLUGIN_ROOT}/templates/ROUTING.md` — the single
   routing authority. Output: an approved plan with every task marked
   `(LANE: KEEP)` or `(LANE: DELEGATE, tier <t>)` and a Task/Lane Map table.
2. **`/lanes-emit <plan>`** (compiler stage). Reads the approved plan,
   re-validates every task's lane against `ROUTING.md` (the plan proposes,
   ROUTING.md decides), and emits one spec file per DELEGATE-routed task into
   the project's `tasks_dir` (`.lanes/config.json`). KEEP-routed tasks get NO
   spec file — nothing about them changes.
3. **`lanes-implementer`** (dispatch-and-verify agent, one invocation per
   spec). Validates the spec, hands it verbatim to the project's configured
   DELEGATE backend, verifies the result itself (scope, acceptance,
   regression, interfaces — never the backend's word alone), and reports
   `IMPLEMENTED` / `IMPLEMENTED_WITH_DEVIATIONS` / `BLOCKED` /
   `BACKEND_FAILURE` / `RATE_LIMITED`.
4. **`lanes-reviewer`** (frontier judgment, KEEP lane). Takes a spec plus an
   `IMPLEMENTED` or `IMPLEMENTED_WITH_DEVIATIONS` report, reruns every
   check itself, and returns exactly one
   verdict: `APPROVE`, `FIX` (with a delta spec), or `REJECT`.

**KEEP tasks never leave the superpowers inner loop.** A KEEP-routed task in
the plan is executed and reviewed exactly the way superpowers already does
it — no spec file, no `lanes-implementer`, no `lanes-reviewer`. Lanes only
ever inserts itself into the DELEGATE-routed tasks' path.

## Section B — the planning hook (load-bearing)

When writing a plan (superpowers `writing-plans`) in a Lanes project:

After task breakdown, before elaboration, assign every task a lane per
`${CLAUDE_PLUGIN_ROOT}/templates/ROUTING.md`. Record `(LANE: KEEP)` or
`(LANE: DELEGATE, tier <t>)` in each task heading, and put a Task/Lane Map
table (`task | lane | tier | depends-on`) near the top of the plan.

**Elaboration depth is lane-dependent:**

- **KEEP tasks** get full SDD detail, including code.
- **DELEGATE tasks stop at contract depth**: files, real interfaces read off
  the codebase, constraints, behavioral criteria, an acceptance command —
  and **no finished code**. Writing the implementation in the plan spends
  planning-tier tokens on implementation-tier work and defeats delegation;
  the DELEGATE backend is the one that should be spending tokens turning the
  contract into code, not you.

An auth-bearing endpoint routed DELEGATE needs the `ratified:` marker per
ROUTING rule (c) — plus acceptance criteria that test every rejection path —
or it routes KEEP by default.

Reference existing code by pattern name ("the retry-with-backoff pattern in
`src/lib/http.ts`"), never by line number — line references rot between
planning and dispatch, and a DELEGATE task's Interfaces section has to be
real code copied off the current source, not a guess.

If a task's Interfaces section can't be written as real code against the
actual codebase, it isn't DELEGATE-ready — route it KEEP instead of forcing
a contract that doesn't exist yet.

## Section C — after the plan

Once the plan is approved:

1. Run `/lanes-emit <plan>` to compile it: it emits one spec file per
   DELEGATE-routed task into the project's `tasks_dir`, validating each
   task's lane against `ROUTING.md` along the way.
2. **Dispatch order must respect `Depends on`.** Uncommitted specs under
   `tasks_dir` are fine — the dispatch gate's baseline allowlist covers
   pipeline-owned paths, and the audit reports them as `allowlisted`,
   never as scope violations. Commit specs whenever convenient for
   history.
3. For each DELEGATE spec, create its isolation worktree first:
   `node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" worktree create --spec <spec-path>`
   (per-task worktree at `.lanes/worktrees/<task-id>`, branch
   `lanes/<task-id>`, clean at the recorded base). Dispatch
   `lanes-implementer` with the spec path AND the worktree path; then
   dispatch `lanes-reviewer` with the spec path, the implementer's
   report, and the SAME worktree path — implementer and reviewer must
   audit the same tree. On APPROVE: commit the work inside the worktree,
   merge `lanes/<task-id>` into your working branch, then
   `… worktree remove --task <task-id>`. On REJECT: the worktree stays
   inspectable; dispose of it with `worktree remove` (add `--force` to
   discard its uncommitted work) when done.
4. KEEP tasks proceed via normal superpowers execution (no spec, no
   `lanes-implementer`, no `lanes-reviewer` — the usual superpowers
   inner loop and review).
5. Respect `Depends on` ordering throughout: don't dispatch a task whose
   dependency hasn't landed, whichever lane either one is in.

## Section D — prerequisites

Before any of the above applies to a project, all three must hold:

- **superpowers is installed** — Lanes hooks its `writing-plans` skill; it
  does not stand alone.
- **`.lanes/config.json` exists** in the project. If it doesn't, run
  `/lanes-init` first — it inspects the repo and drafts the config (tier
  names, `plans_dir`, `tasks_dir`, security-routed files, and the rest);
  Lanes refuses to route against a project it hasn't been configured for.
- **A DELEGATE backend is configured** (`.lanes/config.json` `backend` and its
  dispatch/reply tools) — without one, every task should stay KEEP, since
  there is nowhere for a DELEGATE-routed task to go.
