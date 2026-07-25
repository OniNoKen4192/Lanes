# TEMPLATE.md — Per-task spec contract (DELEGATE lane)

Lives at `templates/TEMPLATE.md` in the Lanes plugin. Emitted task specs go
in the project's `tasks_dir` (`.lanes/config.md`; default
`docs/superpowers/tasks/<task-id>.md`). (Not to be confused with design
specs — those describe features; these are per-task implementation
contracts derived from the project's plans, in `plans_dir`.)

Template for specs emitted by the planner (KEEP lane, frontier Claude) and
dispatched to the DELEGATE implementer (`lanes-implementer`). The delegate
shares **zero context** with the planning session — the spec is the only
thing it knows beyond what it can read in the repo. Every section exists
because its absence causes a specific, observed failure mode in
cross-model handoffs.

**Repo-wide rule for every command in every spec:** prefix every command
with the project's `command_prefix` (`.lanes/config.md`); never emit a
bare command that assumes a working directory. The implementer and the
delegate backend make no guarantees about their working directory.

---

## The Template

````markdown
# TASK: <short-slug>

## Meta
- **Task ID**: <plan-id>.<task-number>          (e.g. <plan-slug>.03)
- **Parent plan**: <plans_dir>/<dated-plan>.md
- **Depends on**: <task IDs that must be merged first, or "none">
- **Estimated scope**: <S | M | L>              (S: 1 file, M: 2–4 files, L: reconsider splitting)
- **Model hint**: <top-tier | mid-tier | low-tier | keep>  (the config `tiers` names, best→cheapest, or `keep` for security-routed — see rule 7; dispatcher may override the tier on rate limit)

## Objective
<One to three sentences. What exists after this task that didn't before,
stated as observable behavior — not implementation steps. If you can't
state it as behavior, the task isn't scoped yet.>

## Context
<Only what the delegate cannot infer from the repo: WHY this task exists,
what the parent plan is doing around it, decisions already made that this
task must not relitigate. 3–8 sentences. Do not paste the whole plan.>

## Files

### Touch
<All paths relative to repo root, including the project's `app_subdir`
(`.lanes/config.md`) if it has one.>
| Path | Action | Notes |
|------|--------|-------|
| `<app_subdir>/src/lib/example.ts` | modify | add X to Y |
| `<app_subdir>/src/lib/__tests__/example.test.ts` | create | see Acceptance |

### Do NOT touch
<Explicit task-specific list. This is the single most important section for
preventing the delegate's "helpful" adjacent refactors. Include anything
sharing a module, config, or naming convention with the Touch list.>
- <files owned by sibling tasks, e.g. `.../src/lib/example-other.ts` — owned by task .04>
- Any file not listed under Touch. If completing the objective seems to
  require touching an unlisted file, STOP and report BLOCKED (see below).

**Standing exclusions (apply to every task; also in the project's
AGENTS.md — repeat the relevant ones here anyway, repetition is cheap and
drift is not):** the entries in the project's `do_not_touch` and
`security_routed` lists (`.lanes/config.md`), repeated here at emission
time. Categories typically include:
- Migration files — append-only via the project's migration tool, and
  schema changes are never dispatched to the DELEGATE lane
- Security-routed files (auth, authz, and other security-critical
  visibility/permission gates) — tasks touching these are routed to a KEEP
  implementer by the planner, never to DELEGATE
- Pipeline-owned build ledger and review artifacts (`ledger`, `tasks_dir`,
  `plans_dir` in `.lanes/config.md`) — outputs, never task inputs
- Pinned UI components — never regenerate or "update"
- Lockfile — unless the spec explicitly adds a dependency

## Interfaces
<Exact signatures, schemas, and contracts this task must produce or
conform to. Write them as code, not prose. This is what keeps parallel
tasks compatible without shared context.>

```text
// <app_subdir>/src/lib/example.ts   (illustrative — use the real path/
// language for this project's stack)
function doThing(id: string, opts: { includeExpired?: boolean }): Thing
// Throws NotFoundError for unknown id. Never returns null.
// MUST route reads through the existing permission/visibility gate —
// callers never query access rules directly.
```

<Include: exact names, parameter order, types, error contracts, return
shapes, schema fragments, action/handler signatures — whatever the
boundary of this task is. For action/handler-based code, specify the file
that owns the handler and its request contract, since the delegate can't
infer which caller owns it.>

## Constraints
<Project conventions the delegate won't reliably infer. Keep this list
short and stable — most of it should eventually migrate into AGENTS.md /
repo docs so specs only carry task-specific constraints.>
- Language/runtime version, style rules that CI enforces
- Dependency policy: "no new dependencies" or the explicit allowlist
- Error-handling convention (e.g. "raise domain errors, never return None")
- Logging convention
- "Follow existing patterns in <file>" — name a reference file, don't describe the pattern

## Acceptance
<This section is MANDATORY. The implementer must refuse any spec
without a runnable test command.>

**Test command (must exit 0):**
```bash
<command_prefix> <acceptance_runner> <path-to-test-file> && <command_prefix> <lint> <path-to-changed-file>
```

**Behavioral criteria** (each must be covered by a test in this task):
1. <Specific, falsifiable statement>
2. <...>
3. <...>

**Affected workflow IDs**: <IDs from the project's `review_suite.id_index`
(`.lanes/config.md`), or "none">
<The reviewer runs the matching e2e/workflow specs. Listing them here is
what makes that check mechanical instead of judgment.>

**Regression guard (task level — implementer runs this):**
```bash
<command_prefix> <test>
```
<Unit test runner only (`test` in `.lanes/config.md`). The project's
e2e/UX suite, if configured (`review_suite`), is the reviewer-level guard
— do not put e2e commands in task specs; DELEGATE tasks must not spin up
the e2e environment.>

## Out of Scope
<Name the tempting-but-wrong extensions explicitly. The delegate fills
silence with initiative; spend three bullets removing the silence.>
- Do not add configuration options not specified above
- Do not update documentation (handled in a separate task, if any)
- Do not fix unrelated failing tests or lint warnings — report them instead

## Report Format
Return exactly this structure:

STATUS: IMPLEMENTED | IMPLEMENTED_WITH_DEVIATIONS | BLOCKED | BACKEND_FAILURE | RATE_LIMITED
FILES_CHANGED: <list with one-line summary each>
TEST_OUTPUT: <last 20 lines of the acceptance command>
DEVIATIONS: <anything done differently than specified, and why — or "none".
  IMPLEMENTED requires "none"; IMPLEMENTED_WITH_DEVIATIONS requires a
  non-empty list>
BLOCKED_REASON: <only if BLOCKED: what was needed that the spec didn't provide>
````

---

## Planner Emission Rules (for the planner, KEEP lane)

1. **One task = one reviewable diff.** If the Touch list exceeds ~4 files or
   the Objective needs "and," split it.
2. **Interfaces before parallelism.** Any two tasks that can run concurrently
   must have their shared boundary fully specified in both specs' Interfaces
   sections. If you can't write the interface yet, the tasks aren't parallel —
   sequence them.
3. **Write Do-NOT-touch from the plan, not from imagination.** It's the other
   tasks' Touch lists plus anything fragile nearby.
4. **The Acceptance test must be runnable before the task starts** (it fails,
   then the task makes it pass) OR the task includes creating it as the first
   Touch entry. Never emit "tests will be added later."
5. **Context is for decisions, not narration.** Every sentence in Context
   should prevent a specific wrong choice. If it doesn't, cut it.
6. **Emit the spec as a file** at the project's `tasks_dir`
   (`.lanes/config.md`; default `docs/superpowers/tasks/<task-id>.md`), not
   just as prose in the session — the dispatcher passes the file, the reviewer
   diffs the result against it, and you get an audit trail for free.
7. **Security routing.** Any task whose Touch list includes an entry in the
   project's `security_routed` list (`.lanes/config.md`) is routed to a KEEP
   implementer, never to DELEGATE. Mark it `Model hint: keep` in Meta.
8. **Specs carry contracts, not implementations.** No full-file code
   blocks. Interfaces, constraints, and behavioral criteria define the
   task; the implementer writes the code. If the plan already contains
   the finished code, the emitter extracts the contract and discards the
   code (see also the `/lanes-emit` rules).

## Implementer Validation Rules (for the `lanes-implementer` agent)

Refuse the spec (STATUS: BLOCKED, before dispatching to the delegate
backend) if any of:
- Acceptance section missing or test command not runnable
- Touch list empty
- Interfaces section missing for any task marked as having dependencies
  or dependents

Pass the spec to the delegate backend **verbatim** — do not summarize, do
not "improve" it. After the backend returns: run the acceptance command
yourself, then the regression guard, and report using the spec's Report
Format regardless of what the backend claims. The backend's self-reported
success is not evidence; the test output is.

## Reviewer Checklist (for the `lanes-reviewer` agent)

1. Diff touches only files in the Touch list → any violation is an automatic
   fail, even if tests pass
2. Acceptance criteria each traceable to a test in the diff
3. Interfaces match the spec exactly — names, types, error contracts
4. DEVIATIONS section reviewed: each deviation either accepted (and the spec
   file updated to match) or rejected (task returns to fixer with a delta spec)
5. Full unit test suite run (`<command_prefix> <test>`), plus the project's
   e2e/UX suite for every workflow ID listed in the spec's "Affected
   workflow IDs" (`<command_prefix> <review_suite.suite_command>
   <id_pattern with the ID substituted>` — mind trailing separators: an
   unanchored ID can also match a longer ID that starts with it, e.g.
   `id1` alone also matching `id10`/`id11`).
   If the spec said "none" but the diff touches a path covered by the
   project's `review_suite.route_map`, treat that as a spec error and run
   the IDs that path maps to, at minimum.
6. Verdict: APPROVE | FIX (attach delta spec: only what's wrong and the
   acceptance command that proves it fixed) | REJECT (re-plan)
