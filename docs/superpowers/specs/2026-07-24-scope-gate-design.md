# Lanes — deterministic scope gate (design spec)

**Date:** 2026-07-24
**Status:** approved (brainstorming), ready for implementation planning
**Author:** Ken + Claude
**Resolves:** issues [#1](https://github.com/OniNoKen4192/Lanes/issues/1),
[#2](https://github.com/OniNoKen4192/Lanes/issues/2),
[#7](https://github.com/OniNoKen4192/Lanes/issues/7)

## 1. What this is

Slice 1 of the hardening work from the 2026-07-24 external review: move the
scope and security boundaries of the DELEGATE pipeline from prose
instructions into deterministic machinery. Three findings land together
because they share one mechanism:

- **#1 — bypassable git baseline.** The implementer's scope check and the
  reviewer's default diff both read the *working tree vs HEAD*. A delegate
  that commits its changes moves them behind HEAD and blinds both audits.
- **#2 — detective, not preventive, security gate.** Nothing checks a
  spec's Touch paths against `security_routed` *before* dispatch. The
  reviewer's automatic REJECT fires only after untrusted code has already
  run in the working tree.
- **#7 — unspecified path matching.** `security_routed` and `do_not_touch`
  use globs, but how a changed path matches a glob is per-agent model
  judgment — which #2 makes a security boundary.

This slice is the point where Lanes deliberately stops being a zero-code
prompt plugin and ships its first executable: a single-file validator plus
a PreToolUse hook. That crossing is intentional and was the central
recommendation of the review ("move critical pieces from prose into
deterministic machinery").

## 2. Decisions (settled in brainstorming)

1. **Enforcement is hook-gated.** A PreToolUse hook on the dispatch tool
   blocks non-conforming dispatches at the harness level; the agent cannot
   skip, forget, or be prompt-injected past it. Prompts *also* run the
   validator (belt + suspenders, and the only layer in non-Claude-Code
   harnesses), but the hook is the load-bearing gate.
2. **Runtime is Node, plain JS, zero dependencies.** Claude Code itself
   requires Node, so it is the one runtime every Lanes user already has.
   No npm install step. The glob matcher is hand-rolled because #7 defines
   its semantics normatively — owning the matcher means the spec and the
   code cannot drift.
3. **Baseline policy is strict: clean tree with allowlisted dirs.**
   Dispatch is blocked unless the working tree is clean except for
   allowlisted Lanes paths. Every post-task diff is therefore attributable
   to the delegate. Unrelated WIP must be committed or stashed first; the
   gate says so explicitly when it blocks.

## 3. Component: the validator (`bin/lanes-validate.mjs`)

One self-contained ESM script shipped at
`${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs`. No dependencies. Invoked as
`node .../lanes-validate.mjs <subcommand>`. All machine output is JSON on
stdout; exit codes carry the verdict.

### 3.1 `gate --spec <path>`

The pre-dispatch check. Verifies, in order:

1. **Config** — `.lanes/config.md` exists and its `security_routed` and
   `do_not_touch` lists parse (minimal, targeted parse of today's markdown
   config; the full schema migration is #5).
2. **Spec structure & containment** — the spec file parses far enough to
   extract Task ID, Model hint, and the Touch / Do-NOT-touch lists; the
   spec path itself must resolve inside the repo (no absolute path, `..`,
   drive letter, or symlink escape — the gate is worthless if the spec it
   reads can live outside the tree it's protecting).
3. **Routing law** — Model hint is not `keep` (a keep-hinted spec must
   never reach a DELEGATE dispatch).
4. **Clean baseline** — `git status --porcelain` is empty except for paths
   under the allowlist: `.lanes/**` plus the configured plans/tasks dirs.
5. **Security gate (the #2 fix)** — no Touch path matches any pattern in
   `security_routed` or `do_not_touch`, under the §6 matching semantics.
   The report names the exact pattern and path on a hit.

On pass: writes the baseline record (§5) to `.lanes/state/<task-id>.json`
and exits 0. On failure: exits 2 with a JSON report identifying the failed
check, the offending paths/patterns, and a human-readable reason (this
string becomes the hook's denial message).

### 3.2 `audit --task <task-id>`

The post-task scope audit (the #1 fix). Reads the recorded `base_sha` from
the state file, then collects changed paths from **all four surfaces**,
using machine-readable git output only:

| Surface | Command |
|---|---|
| Committed | `git diff --name-status <base_sha>..HEAD` |
| Staged | `git diff --name-status --cached` |
| Unstaged | `git diff --name-status` |
| Untracked | `git ls-files --others --exclude-standard` |

Any commit past `base_sha` is itself flagged (`committed: true` per path,
plus the commit list) — the controller owns git state, so a delegate
commit is a violation regardless of what it contains. Renames and copies
contribute *both* sides as changed paths (§6).

Every collected path is matched against the spec's Touch list,
`do_not_touch`, and `security_routed`. Output is a JSON report:

```json
{
  "task": "T12",
  "base_sha": "abc1234",
  "commits_past_base": ["def5678"],
  "in_scope": ["src/foo.ts"],
  "out_of_scope": ["src/bar.ts"],
  "forbidden": [
    { "path": "src/auth.ts", "list": "security_routed", "pattern": "src/auth.ts" }
  ],
  "verdict": "violations"
}
```

`verdict` is `clean` | `violations`. Agents interpret this report; they no
longer compute scope by eyeballing `git status` or `git diff --stat`.

### 3.3 `selftest`

Runs the matcher against the examples table in `docs/PATH-MATCHING.md`
semantics (vectors embedded in the script), exits non-zero on any
mismatch. Minimal by design — the full conformance suite is #4.

### 3.4 Failure posture

Fail closed, everywhere: git command failure, missing/corrupt state file,
unparseable config, unreadable spec → block (gate) or `verdict:
"violations"` with an `error` field (audit). Never warn-and-continue.

## 4. Component: the dispatch hook

A PreToolUse hook registered in the plugin's `hooks` configuration,
matching the configured dispatch tool (v1: `mcp__codex__codex`). The hook
script (also plain Node, in `hooks/`) reads the tool-call input from
stdin. The `hooks.json` `matcher` value is therefore part of the backend
seam defined in `agents/lanes-implementer.md`: it must change in
lockstep with the dispatch tool, or the PreToolUse hard gate silently
stops firing on the new tool.

**Contract:** the implementer's dispatch prompt gains one machine-readable
first line:

```
LANES-SPEC: <repo-relative path to the spec file>
```

- Input **has** a `LANES-SPEC` header → run `gate --spec <path>`. Pass →
  allow. Fail → deny, with the gate's reason string as the denial message.
  Validator crash → **deny** (fail closed).
- Input has **no** `LANES-SPEC` header → allow untouched. The hook must
  not break unrelated codex use in the same session.

## 5. State: `.lanes/state/<task-id>.json`

Written by `gate`, read by `audit` and the reviewer:

```json
{
  "task": "T12",
  "spec_path": "tasks/T12-slugify.md",
  "spec_sha256": "…",
  "touch": ["src/foo.ts"],
  "base_sha": "abc1234",
  "dispatched_at": "2026-07-24T15:00:00Z"
}
```

`spec_sha256` lets the audit detect a spec edited after dispatch (relevant
to #8 later). The `touch` array is a snapshot of the spec's Touch list at
dispatch time; `audit` classifies changed paths against this snapshot, not
against the live spec file — otherwise a delegate (or anyone) could edit
the spec's Touch table after the fact to launder an out-of-scope change
into "in scope" retroactively, and `spec_modified` becoming `true` is what
surfaces that tamper to the reviewer. `.lanes/state/` joins the baseline
allowlist.

**Known limitation.** `.lanes/state/` sits inside the delegate's writable
sandbox, so a delegate could in principle tamper with the baseline record
itself (including the `touch` snapshot), not just the spec. This residual
trust boundary is accepted for this slice; it closes fully with worktree
isolation (#3), which moves state out of any sandbox the delegate can
write to.

## 6. Path-matching semantics (`docs/PATH-MATCHING.md`)

A short normative doc the validator implements; its examples table doubles
as the `selftest` vectors. Rules:

1. **Normalization** — all paths are repo-relative (relative to the git
   toplevel, not `app_subdir`); `\` is normalized to `/`; no `.`/`..`
   segments (a path that escapes the repo root is a refusal).
2. **Case-insensitive matching.** A security deny-list must not be
   dodgeable via `SRC/Auth.ts` on the case-insensitive filesystems most
   users run (Windows, macOS).
3. **Dialect** — `*` matches within a segment (does not cross `/`); `?`
   matches one non-`/` character; `**` crosses segments; a **bare
   directory pattern matches the directory and everything beneath it**
   (gitignore-style: `prisma/migrations` ≡ `prisma/migrations/**` plus the
   directory itself).
4. **Renames/copies** — git `R*`/`C*` statuses contribute **both** sides;
   a rename *into* a forbidden directory trips the gate, as does a rename
   out of one.
5. **Symlinks** — a symlink is matched by its link path (not its target);
   a Touch path that is a symlink resolving outside the repo is a gate
   refusal.
6. **Submodules** — submodule paths are opaque single paths; a Touch path
   inside a submodule is a gate refusal (Lanes does not operate across
   submodule boundaries).
7. **Precedence** — deny beats allow: a path matching `security_routed` or
   `do_not_touch` is forbidden even if it also matches Touch.

## 7. Prompt updates

- **`agents/lanes-implementer.md`** — Phase 1 runs `gate` explicitly and
  treats its exit code as the gate (replaces the model-judgment check that
  today only looks at the Model hint). The dispatch prompt prefix adds the
  `LANES-SPEC` header and an explicit prohibition on `git commit` /
  `branch` / `reset` / any history operation. Phase 3 replaces the
  `git status` / `git diff --stat` scope check with `audit --task <id>`
  and reports the JSON verdict.
- **`agents/lanes-reviewer.md`** — the default review range becomes
  `base_sha..working tree` (from the state file), not `HEAD..working
  tree`, so committed delegate work cannot hide from review. The scope
  audit phase consumes the `audit` report. Any commit past base is an
  automatic FIX at minimum (REJECT if it touches a forbidden path).
- **`commands/lanes-emit.md`** — the "uncommitted specs will read as scope
  violations in review" prose warning is replaced by a pointer to the
  gate's allowlist (specs/plans dirs are allowlisted, so this hazard
  disappears).

## 8. Out of scope for this slice

- Status taxonomy split (#6) — separate small lockstep change.
- Config schema + `/lanes-doctor` (#5) — the validator does a minimal
  targeted parse of today's markdown config; migration comes later.
- Conformance suite + CI (#4) — `selftest` is the seed, not the suite.
- Worktree isolation (#3) and immutable-spec amendments (#8).

## 9. Testing

`selftest` covers the matcher against the §6 examples table. Manual
end-to-end verification for the slice: a fixture spec with a
`security_routed` Touch path must be denied by the hook; a delegate-style
commit past base must appear in the `audit` report; a dirty tree must
block dispatch with the allowlist exception confirmed (`.lanes/`, tasks
dir). These become automated fixtures in #4.
