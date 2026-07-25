---
description: >
  Compiler stage of the Lanes cross-model pipeline (plan → emit specs →
  DELEGATE implementer → reviewer). Takes an approved plan from the
  project's `plans_dir`, validates each task's plan-assigned lane against
  the plugin's `templates/ROUTING.md` (the single routing authority), and
  emits one `templates/TEMPLATE.md`-conformant spec file per DELEGATE-routed
  task into the project's `tasks_dir` (`.lanes/config.json`). KEEP-routed
  tasks get NO spec file — they stay in the existing superpowers SDD inner
  loop.
argument-hint: <path-to-approved-plan>
---

# /lanes-emit — plan → DELEGATE task specs

The plan at `$ARGUMENTS` has been approved. Convert it into dispatchable
task specs for the Lanes cross-model pipeline, per the procedure below.
Follow it exactly; where it conflicts with your instincts, the procedure
wins.

## Standing guards (read before doing anything)

- **Option A is in force**: only DELEGATE-routed tasks get spec files. The
  superpowers SDD inner loop for KEEP-routed tasks stays exactly as it is —
  do not modify, wrap, or interfere with it, and do not emit specs for
  KEEP-routed tasks.
- **You emit; you do not dispatch.** Never invoke `lanes-implementer`, the
  configured DELEGATE backend's tools, or any subagent from this command.
  Dispatch is a separate step this command never performs.
- **Never modify**: the plan file, the plugin's `templates/TEMPLATE.md`,
  the project's `AGENTS.md`, `agents/*.md`, the superpowers plugin, or
  anything under `.superpowers/sdd/`. If any of them is wrong or
  inconsistent, report the problem in your output and continue if you
  safely can; the user rules on it.
- **Never overwrite an existing spec file.** If `<tasks_dir>/<task-id>.md`
  already exists, skip that task's emission and report the collision.

## Step 1 — Read, in this order

1. `${CLAUDE_PLUGIN_ROOT}/templates/TEMPLATE.md` — the output contract.
   Resolve it via Bash, e.g. `cat "${CLAUDE_PLUGIN_ROOT}/templates/TEMPLATE.md"`.
   Every emitted spec conforms to it: all sections present, every command
   carries the project's `command_prefix` (`.lanes/config.json`), the
   standing Do-NOT-touch exclusions repeated in each spec, "Affected
   workflow IDs" populated, and Planner Emission Rules 1–8 honored. Rule 7
   (security routing) is non-negotiable.
2. `${CLAUDE_PLUGIN_ROOT}/templates/ROUTING.md` — the routing authority
   applied in Step 3. Resolve it via Bash, e.g.
   `cat "${CLAUDE_PLUGIN_ROOT}/templates/ROUTING.md"`. The rules live there
   and only there; do not route from memory.
3. The project's `AGENTS.md` (repo root) — standing exclusions, stack
   facts, pipeline mode.
4. `${CLAUDE_PLUGIN_ROOT}/agents/lanes-implementer.md` — its Phase 1 validation gate is the
   compiler for your output. Every spec you emit must pass all five items.
5. The project's `review_suite.id_index` (`.lanes/config.json`) — the
   coverage table mapping workflow/UX IDs to test specs. Source for
   "Affected workflow IDs". If the project has no `review_suite` block,
   "Affected workflow IDs" is always `none`.
6. **The project's package manifest** — the ONLY authority on the command
   names used for acceptance/regression (cross-checked against `test` and
   `acceptance_runner` in `.lanes/config.json`). If `TEMPLATE.md`, `AGENTS.md`,
   or `.lanes/config.json` examples disagree with the manifest, use the
   manifest and report the mismatch; do not silently fix those files.
7. The plan file at `$ARGUMENTS`, in full.

## Step 2 — Parse the plan

Plans follow the practiced superpowers format: a header block, optional
`## Global Constraints`, then `### Task N: <title>` sections each with a
`**Files:**` list (Create/Modify/Test), usually an `**Interfaces:**` block
(Consumes/Produces), and checkbox steps that typically contain the complete
code.

- Extract: task number + title, file list with actions, interfaces,
  dependencies (explicit "depends on" statements, Consumes references to
  earlier tasks' Produces, or a later task modifying a file an earlier task
  creates), and any provided code blocks.
- Global Constraints apply to every task — carry the relevant ones into each
  emitted spec's Constraints section.
- A task with no Touch-able files (e.g. "Task 0: Branch", pure git/process
  steps) is controller work, not an implementation task: list it in the
  routing table as lane `n/a (controller)` and emit nothing.
- **If the plan has no discernible task structure** (no `### Task N:`
  headings, or tasks without Files lists), STOP. Say exactly what is missing
  and emit nothing. Do not invent tasks.

## Step 3 — Validate every task's lane

**You do not route independently.** The routing rules — hard rules (a)–(c),
DELEGATE tier guidance, doubt defaults, and the Interfaces trigger — live in
`${CLAUDE_PLUGIN_ROOT}/templates/ROUTING.md` and only there. The plan
proposes a lane per task; this step validates each proposal; for hard
rules, ROUTING.md wins over the plan.

Read each task's `LANE:` marker (task heading and/or Task/Lane Map table)
and validate it against ROUTING.md:

- **Agreement** → proceed with the plan's lane.
- **Plan says DELEGATE, a hard rule says KEEP** → the rules win: route
  KEEP and flag the row `OVERRIDE: plan said DELEGATE, rule <x>`. For rule
  (c) specifically, verify BOTH the `ratified:` marker and the full
  rejection-path acceptance criteria; missing either triggers the
  override.
- **Tier disagreement only** (plan's DELEGATE tier — from `.lanes/config.json`
  `tiers` — differs from your read) → the plan's tier wins; note the
  disagreement in Flags.
- **Plan says KEEP but the task appears DELEGATE-eligible** under
  ROUTING.md (contract writable, no hard rule triggered, not oversized) →
  do NOT re-route; keep KEEP and flag the row
  `UNDER-ROUTED?: DELEGATE-eligible, plan kept KEEP`.
- **No `LANE:` marker at all** (legacy plan) → route that task directly by
  ROUTING.md, and flag the whole run `legacy plan: emitter routed`.
- **Oversized but otherwise DELEGATE-eligible** → KEEP, flagged
  `re-plan candidate: splittable`.

The Interfaces trigger (ROUTING.md) re-applies at emission time: if Step 4
finds you cannot write a validated-DELEGATE task's Interfaces as real code
against the actual codebase, that task is not DELEGATE-ready — route it
KEEP and record why in Flags.

## Step 4 — Emit one spec per DELEGATE-routed task

Write `<tasks_dir>/<task-id>.md` (`tasks_dir` from `.lanes/config.json`) for
each DELEGATE-routed task (collision check first — see standing guards).
Requirements beyond plain TEMPLATE.md conformance:

- **Task ID** = plan slug, uppercased, date prefix dropped, + zero-padded
  plan task number: `<plans_dir>/2026-07-22-polish-batch-yellow.md`
  Task 3 → `POLISH-BATCH-YELLOW.03`.
- **Meta**: Parent plan path; Depends on from Step 2 (task IDs, or "none");
  Estimated scope S/M/L by Touch-list size; Model hint = the final
  lane/tier from Step 3 (a `.lanes/config.json` `tiers` name, or `keep` — a
  `keep` hint means this task should not have been emitted at all; treat
  that as a Step-3 bug and stop before writing the file; see Step 5
  item 1).
- **Context**: only decisions the delegate can't infer — including, when
  "Affected workflow IDs" is "none", the one-line justification for that.
- **Files/Touch**: exactly the plan's file list for this task, paths from
  repo root (including the project's `app_subdir` if it has one). **Do NOT
  touch** = the union of all sibling tasks' Touch lists (name the owning
  task) + any file the task tests-but-must-not-modify + the standing
  exclusions block copied from TEMPLATE.md, sourced from the project's
  `do_not_touch` and `security_routed` lists (`.lanes/config.json`). Never
  invent entries beyond that (Emission Rule 3).
- **Interfaces**: real code. Read the actual source files the task
  consumes and copy exact current signatures; for produced code, exact
  target signatures. Placeholder or guessed interfaces are a routing
  failure, not a formatting one (the Interfaces trigger — ROUTING.md,
  applied via Step 3).
- **Constraints**: relevant Global Constraints from the plan, plus the
  contract extracted from any plan-provided code (see next bullet).
- **Contracts, never implementations.** A spec must never contain a
  "Provided code" block or full file content. If the parent plan contains
  finished code for a task, treat it as a planning artifact: extract the
  contract from it — interfaces, mock boundaries/topology, behavioral
  criteria, constraints — and discard the code itself. If a clean contract
  can't be extracted, that is the Interfaces trigger (ROUTING.md): route
  the task KEEP and record why in Flags.
- **Acceptance**: test command built on the project's `command_prefix` and
  `acceptance_runner` (`.lanes/config.json`), verified against the package
  manifest; behavioral criteria each falsifiable and each covered by a
  named test; Emission Rule 4 satisfied — the command is runnable now and
  red, OR creating the test is the first Touch entry. "Affected workflow
  IDs" from the project's `review_suite.id_index` coverage table, or `none`
  with the justification sitting in Context.
- **Regression guard**: `<command_prefix> <test>` (unit runner only —
  never the project's e2e/UX suite; that is reviewer-level).
- **Report Format**: copied verbatim from TEMPLATE.md, must be inside a fenced code block (loose markdown lines collapse into a single paragraph when rendered).

Before writing each spec file, two consistency checks:

- **Hint/body consistency.** Does the spec body describe work matching the
  Model hint's tier? A near-boilerplate body (fixed content, pure
  transcription) carrying a lowest-tier hint means the routing and the
  spec disagree — resolve it before emitting (the plan's tier wins per
  Step 3; note the disagreement in Flags).
- **Contradiction check.** A spec must not contain instructions that can
  conflict under any outcome (e.g. "create exactly this content" plus
  "adapt X if it fails"). If two instructions can collide, the spec isn't
  a contract yet — rewrite until they can't.

## Step 5 — Gate-check your own output

Walk every emitted spec through `${CLAUDE_PLUGIN_ROOT}/agents/lanes-implementer.md`'s Phase 1
items, as that agent would:
The implementer's real Phase 1 now begins with the deterministic gate
(`lanes-validate.mjs gate`), which also enforces the security boundary
and a clean baseline at dispatch time; the emitter does NOT run the gate
(it would write premature state files and impose the clean-baseline
requirement at emit time) — these five static checks remain the
emit-time approximation.

1. Model hint is not `keep` (should be true by construction).
2. Acceptance command is runnable — actually run it with Bash. Expect red,
   or note that the first Touch entry creates the test (which waives red).
   An environmental error (wrong path, missing script) means your spec is
   broken: fix the spec and re-run the gate.
3. Touch list non-empty; every listed path's parent directory exists.
4. Interfaces section present if the task has dependencies or dependents.
5. Depends-on tasks exist in the routing table.

A spec that fails any item never ships silently: fix and re-gate.

## Step 6 — Report

End with, in this order:

1. **Routing summary table** — every plan task, including KEEP-routed and
   controller rows: `Task | Plan lane | Final lane | Flags` (controller
   rows use `n/a (controller)`; Flags carries the Step 3 annotations —
   `OVERRIDE: ...`, `UNDER-ROUTED?: ...`, `re-plan candidate: splittable`,
   tier notes — or is empty on clean agreement).
2. **Emitted files** — each spec path with its task ID, plus collisions
   skipped.
3. **Gate results** — per spec, the five items and what the acceptance
   command actually did when run.
4. **Mismatches/frictions** — anything in TEMPLATE.md, AGENTS.md,
   `.lanes/config.json`, or `agents/lanes-implementer.md` that disagreed with
   reality (the package manifest wins). Report only; never edit them.
5. **Reminder to the user**: dispatch order must respect Depends on.
   (Uncommitted spec files under `tasks_dir` are fine — the dispatch
   gate's baseline allowlist covers pipeline-owned paths, and the audit
   reports them as `allowlisted`, never as scope violations.)
