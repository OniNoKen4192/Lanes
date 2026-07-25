# Lanes — per-task worktree isolation (design spec)

**Date:** 2026-07-25
**Status:** approved (Ken delegated design decisions for the remaining
slices)
**Author:** Claude, under Ken's standing direction
**Resolves:** issue [#3](https://github.com/OniNoKen4192/Lanes/issues/3)

## 1. What this is

Implementation and review currently run in the shared repository
workspace: unrelated local edits, two delegated tasks, and the user's
concurrent work all contaminate one another, and the clean-baseline
requirement blocks dispatch whenever the user has WIP. This slice makes
per-task git worktrees part of the architecture, with the controller (the
main session driving the pipeline) owning the lifecycle — per the issue's
design wrinkle, worktrees are created and threaded by the controller,
never by per-agent isolation flags (which would give implementer and
reviewer *different* worktrees auditing different state).

It also closes the accepted limitation from the scope-gate slice:
`.lanes/state/` moves out of the delegate-writable sandbox — baseline
records now always live in the **main** working tree, which a delegate
sandboxed to its worktree cannot touch.

Decisions (mine, per the standing delegation):

1. **Worktree mode is the recommended path, not the only path.** The
   machinery is dual-mode: without a worktree everything behaves exactly
   as today (main-tree dispatch, clean baseline required). With one, the
   same gate/audit run inside the worktree. Mandatory-worktree would
   break the simplest flows and every existing fixture for no safety
   gain — the gate still fail-closes in both modes.
2. **Lifecycle is deterministic machinery**, not prose: two new validator
   subcommands own creation and disposal. Prose (skill, agents) only
   *threads* the path.
3. **Worktrees live at `.lanes/worktrees/<task-id>/`** inside the repo,
   on branch `lanes/<task-id>`, ignored via `.git/info/exclude` (written
   by `worktree create` — repo-local, never a tracked-file edit).
4. **The delegate still never commits.** The worktree starts clean at
   `base_sha`; every diff in it is the delegate's by construction. On
   APPROVE the controller commits in the worktree and merges
   `lanes/<task-id>`; on REJECT the worktree stays inspectable and is
   disposed with `worktree remove`.

## 2. Validator: state relocation (closes the #1 residual)

New helper `mainRepoRoot()` = `path.resolve(git rev-parse
--git-common-dir, "..")`, computed after the existing
`chdir(toplevel)`. `gate` writes and `audit` reads
`<mainRepoRoot>/.lanes/state/<task>.json` instead of
toplevel-relative paths. In a normal repo the two roots coincide —
existing behavior unchanged; inside a linked worktree, state lands in
the main tree, outside the delegate's writable sandbox.

## 3. Validator: `worktree create --spec <path>`

Run from the main working tree (refused from a linked worktree). Steps,
fail-closed at each:

1. `loadConfig()` (schema-valid config required).
2. Parse the spec; require a Task ID. Sanitize it exactly as the state
   filename does (`[^A-Za-z0-9._-] → _`).
3. Refuse if `.lanes/worktrees/<task>` exists or branch `lanes/<task>`
   exists (no clobber; the error names `worktree remove`).
4. Ensure `.git/info/exclude` contains a `.lanes/worktrees/` line.
5. `git worktree add .lanes/worktrees/<task> -b lanes/<task> HEAD`.
6. Copy into the worktree anything dispatch needs that is uncommitted in
   the main tree: the spec file (at the same relative path) and
   `.lanes/config.json`, each only when absent from the checkout. Both
   land on the gate's baseline allowlist.
7. Print `{ ok: true, task, path, branch, base_sha }` (base_sha = HEAD
   at creation = the worktree's initial HEAD).

## 4. Validator: `worktree remove --task <id> [--force]`

`git worktree remove` (with `--force` passed through; git's own
refusal on uncommitted changes is surfaced as the exit-2 reason —
disposal of un-integrated work must be deliberate), then `git branch -d`
(a `-d` failure means unmerged — the branch is kept deliberately and
reported as `branch_removed: false`). Prints
`{ ok: true, task, removed, branch, branch_removed }`.

## 5. Hook: `LANES-WORKTREE` header

The dispatch-prompt contract gains an optional second line, immediately
after `LANES-SPEC`:

    LANES-SPEC: <worktree-relative path to the spec file>
    LANES-WORKTREE: <path to the controller-created worktree>

When present, the PreToolUse hook (a) resolves the path against the
session cwd, (b) verifies it is a **registered worktree of this repo**
(`git worktree list --porcelain`; path comparison case-insensitive on
win32 only) — deny otherwise (fail closed; a prompt cannot point the
gate at an arbitrary directory with a permissive config), and (c) runs
the gate with the worktree as cwd. Without the header, behavior is
unchanged (gate runs at session cwd). Enumeration failure = deny.

The gate run inside the worktree checks the *worktree's* baseline —
clean by construction at creation, so a dirty **main** tree no longer
blocks dispatch. Attribution now comes from isolation rather than from
a globally clean tree; the in-worktree clean check still catches reuse
of a stale worktree.

## 6. Prose changes

- **`agents/lanes-implementer.md`** — Input section: the dispatcher may
  hand a worktree path along with the spec path; when it does, the
  worktree is the working root for *everything* — the Phase 1 gate, the
  acceptance red-check, the Phase 3 audit and rerun commands (all Bash
  runs from the worktree), the spec path in the prompt is
  worktree-relative, the dispatch prompt carries the `LANES-WORKTREE`
  line, and the SEAM sets the backend tool's working directory (codex
  mcp: its `cwd` parameter) to the worktree. Never dispatch a
  worktree-mode task without the header — the hook's gate would run
  against the wrong tree.
- **`agents/lanes-reviewer.md`** — Input: the dispatcher passes the same
  worktree path the implementer used (issue requirement: same worktree,
  never a second one); every rerun executes there; the audit finds the
  baseline record automatically (state lives in the main tree).
- **`skills/lanes/SKILL.md`** — Section C gains the controller
  lifecycle: create the worktree per DELEGATE task (`worktree create`),
  dispatch implementer and reviewer with the same worktree path, on
  APPROVE commit in the worktree and merge `lanes/<task-id>` into your
  working branch then `worktree remove`, on REJECT dispose (or keep for
  inspection) with `worktree remove [--force]`.
- **`README.md`** — one sentence in the pipeline description noting
  per-task worktree isolation.

## 7. Conformance tests (`tests/worktree.test.mjs`)

1. `worktree create` golden: exit 0; JSON has task/path/branch/base_sha;
   directory and branch exist; `.git/info/exclude` gained the entry;
   an **uncommitted** spec was copied into the worktree.
2. No-clobber: second `create` for the same task exits 2.
3. Gate inside the worktree: exit 0; state file exists in the **main**
   repo's `.lanes/state/`, not in the worktree.
4. **Payoff:** a dirty main tree (unallowlisted stray file) does not
   block the in-worktree gate.
5. Audit inside the worktree: in-scope edit → clean; delegate commit in
   the worktree → `violations` with `commits_past_base`.
6. `worktree remove`: refuses while the worktree holds uncommitted
   changes (exit 2), succeeds with `--force`; directory gone.

Hook header logic is not integration-tested (no PreToolUse harness);
its worktree-membership check is deliberately thin and reviewed code.

## 8. Out of scope

- Spec amendments (#8).
- Concurrent-dispatch orchestration (parallel task scheduling) — the
  machinery permits N worktrees; sequencing stays the controller's job
  per `Depends on`.
- Any config schema change — worktree location and branch naming are
  fixed conventions, not configuration.
