# Lanes — executable conformance suite + CI (design spec)

**Date:** 2026-07-25
**Status:** approved (Ken delegated design decisions for the remaining
slices — "work through the rest of the issues, beginning to end")
**Author:** Claude, under Ken's standing direction
**Resolves:** issue [#4](https://github.com/OniNoKen4192/Lanes/issues/4)

## 1. What this is

Lanes is a prompt framework: a harmless wording edit can silently remove a
gate, rename a config field in one surface but not another, or break the
lockstep invariants the previous slices established by hand-run grep. This
slice adds an executable conformance suite and CI so those invariants are
asserted on every push, not re-derived from memory.

Decisions (mine, per the standing delegation):

1. **Runner is `node --test`** (Node ≥18 built-in test runner) — zero
   dependencies, same constraint as the validator. Tests live in
   `tests/*.test.mjs`, run with bare `node --test` from the repo root
   (default discovery pattern). Directory arguments (`node --test tests/`)
   are NOT used: on Windows Node 22 they resolve the directory as a test
   file and fail with MODULE_NOT_FOUND (verified 2026-07-25).
2. **The suite never imports `bin/lanes-validate.mjs`** — the file executes
   its CLI at module bottom. Validator behavior is tested by spawning it
   (`child_process.execFileSync(process.execPath, …)`) against fixture
   repos; source-level invariants are asserted textually.
3. **Prose invariants are exact-string/structural assertions**, not
   semantic judgment — the suite pins what previous slices verified with
   ad-hoc greps.
4. **CI is GitHub Actions**, matrix `ubuntu-latest` + `windows-latest`,
   Node 20 and 22, running selftest + the suite. Windows is in the matrix
   because the primary dev machine is Windows and path handling is
   load-bearing (PATH-MATCHING rule 1).

## 2. Layout

- `tests/helpers.mjs` — fixture-repo builder + validator spawner (shared).
- `tests/validator.test.mjs` — behavioral: selftest passthrough, golden
  and adversarial fixtures through `gate` / `audit` / `doctor`.
- `tests/conformance.test.mjs` — structural: plugin manifest, frontmatter,
  cross-references, vocabulary sync, taxonomy lockstep, template shape,
  fixture-leak and sweep checks.
- `.github/workflows/ci.yml` — the CI workflow.
- `package.json` is NOT added — the repo is a plugin, not an npm package;
  CI invokes `node --test tests/` directly.

## 3. `tests/helpers.mjs` (contract)

- `makeFixtureRepo(opts) → { dir, cleanup() }`: creates a temp git repo
  (git init, local user config, initial commit) containing a valid
  schema-v1 `.lanes/config.json` (small non-WIX values; `app_subdir` "";
  `security_routed: ["src/auth.ts"]`, `do_not_touch: [".env"]`;
  `pipeline` dirs `docs/plans`, `docs/tasks`, ledger `docs/progress.md`),
  a `package.json` with a `test` script, `src/lib/thing.js`, and a
  TEMPLATE-conformant spec file at `docs/tasks/T1.md` (Task ID `T1`,
  Model hint `luna`, Touch: `src/lib/thing.js` + a test file). `opts`
  overrides let a test patch config fields or the spec text before commit.
- `validate(dir, ...args) → { status, stdout, json }`: spawns
  `node <repo>/bin/lanes-validate.mjs <args>` with cwd `dir`, captures
  exit code and stdout, parses JSON when the output is JSON. Never throws
  on non-zero exit.
- `read(relPath)` — reads a repo file from the real Lanes checkout (root
  resolved from `import.meta.url`), for the structural tests.

## 4. Behavioral tests (`tests/validator.test.mjs`)

1. **Selftest passthrough** — spawning `selftest` exits 0.
2. **Golden gate** — fixture: `gate --spec docs/tasks/T1.md` exits 0,
   `ok: true`, writes `.lanes/state/T1.json` with `base_sha`, `touch`,
   `spec_sha256`.
3. **Golden audit** — after an in-scope edit to `src/lib/thing.js`:
   `audit --task T1` exits 0, verdict `clean`, path in `in_scope`.
4. **Adversarial, each exits 2 with the named check**:
   - keep-hinted spec → gate `routing`.
   - Touch path `../escape.js` → gate `security_gate`.
   - Touch path matching `security_routed` (`src/auth.ts`) → gate
     `security_gate` naming list and pattern.
   - dirty tree (unallowlisted file) → gate `clean_baseline`, path listed.
   - out-of-scope edit (`src/other.js`) → audit verdict `violations`,
     path in `out_of_scope`.
   - delegate commit past base → audit `violations`,
     `commits_past_base` non-empty.
   - spec edited after dispatch → audit `spec_modified: true`,
     verdict `violations`.
   - forbidden edit (`.env`) → audit `forbidden` names `do_not_touch`.
   - schema-invalid config (unknown key) → gate `config`; doctor schema
     `fail` + skipped checks; verdict `not_safe`.
   - malformed glob in `security_routed` (`../x`) → doctor globs `fail`.
5. **Doctor golden** — clean fixture: verdict `ok` exit 0; `src/auth.ts`
   glob previews 1 match; command entries have statuses.

Duplicate JSON config keys are out of scope (JSON.parse keeps the last —
detecting them needs a hand-rolled scanner; noted, not built: YAGNI until
a real incident).

## 5. Structural tests (`tests/conformance.test.mjs`)

1. **Plugin manifest** — `.claude-plugin/plugin.json` parses; `name` is
   `lanes`; `version` semver-shaped; `description` non-empty.
2. **Hooks lockstep** — `hooks/hooks.json` parses; exactly one PreToolUse
   matcher; it equals `backend.dispatch_tool` in
   `templates/config.example.json` (the v1 seam: hook must follow the
   dispatch tool); the hook command references
   `hooks/lanes-dispatch-gate.mjs`, which exists.
3. **Frontmatter** — every `agents/*.md`, `commands/*.md`,
   `skills/lanes/SKILL.md` starts with `---` and has a non-empty
   `description:` (and `name:` for agents, skills).
4. **Cross-references** — every `${CLAUDE_PLUGIN_ROOT}/<path>` mentioned
   in agents/, commands/, skills/, templates/ resolves to an existing
   file in the repo.
5. **Config vocabulary sync** — canonical schema-v1 key-path list is
   declared once in the test; `templates/config.example.json`'s key
   paths equal it exactly (no more, no less); `bin/lanes-validate.mjs`
   source declares the same block/field names in `SCHEMA_V1` (textual
   extraction); `templates/config.example.md` has a heading for every
   block; `commands/lanes-doctor.md`'s migration maps every legacy
   field name; `commands/lanes-init.md` names every required block.
6. **Status taxonomy lockstep** — the exact enumeration
   `IMPLEMENTED | IMPLEMENTED_WITH_DEVIATIONS | BLOCKED |
   BACKEND_FAILURE | RATE_LIMITED` appears exactly once in
   `agents/lanes-implementer.md` and exactly once in
   `templates/TEMPLATE.md`, and zero times in `agents/lanes-reviewer.md`;
   no standalone `DONE` token (word-boundary, excluding
   `IMPLEMENTED_WITH_DEVIATIONS` etc.) in agents/, commands/, skills/,
   templates/, README.md; the pairing rule is present in both agents
   (implementer: `DEVIATIONS is "none"` under IMPLEMENTED and
   `DEVIATIONS must be non-empty`; reviewer: `IMPLEMENTED requires
   DEVIATIONS "none"`).
7. **Config-path sweep** — the string `.lanes/config.md` appears in
   plugin sources only in `commands/lanes-doctor.md`,
   `bin/lanes-validate.mjs`, `templates/config.example.md` (the
   sanctioned migration/hint mentions).
8. **Template shape** — inside `templates/TEMPLATE.md`'s fenced template
   block, each mandatory section appears exactly once: `## Meta`,
   `## Objective`, `## Context`, `## Files`, `### Touch`,
   `### Do NOT touch`, `## Interfaces`, `## Constraints`,
   `## Acceptance`, `## Out of Scope`, `## Report Format`.
9. **MATCH_VECTORS ↔ PATH-MATCHING.md** — parse the examples table in
   `docs/PATH-MATCHING.md` into (pattern, path, expected) triples and the
   `MATCH_VECTORS` array out of the validator source; assert set
   equality both directions.
10. **Routing representation** — `templates/ROUTING.md` contains hard
    rules `(a)`, `(b)`, `(c)`; `agents/lanes-reviewer.md` Phase 2
    contains the standing-exclusion automatic-REJECT language
    (`security_routed` + `automatic REJECT`); `templates/TEMPLATE.md`
    Emission Rule 7 routes security touches to `keep`;
    `commands/lanes-emit.md` names ROUTING.md as the authority.
11. **Fixture leakage** — the distributable prompt surfaces (agents/,
    commands/, skills/, `templates/TEMPLATE.md`,
    `templates/ROUTING.md`, README.md) contain neither
    `wisconsin-ice-exchange` nor the token `WIX` — worked-example
    values live only in `templates/config.example.*` (and historical
    docs/superpowers/, which the suite never scans).

## 6. CI (`.github/workflows/ci.yml`)

On `push` to main and `pull_request`: matrix {ubuntu-latest,
windows-latest} × Node {20, 22}; steps: checkout, setup-node,
`node bin/lanes-validate.mjs selftest`, bare `node --test` (repo root).
No caching, no artifacts — the whole run is seconds.

## 7. Out of scope

- Worktree isolation (#3), spec amendments (#8).
- Plugin-load smoke test via the official plugin dev path — no stable
  headless entry point to drive today; revisit if one appears.
- npm packaging, coverage tooling, badges.

## 8. Testing the tests

The suite must fail when its invariants break: spot-verified during
implementation by temporarily mutating one surface per category (e.g.
edit the reviewer to add the enumeration → taxonomy test fails; rename a
field in config.example.json → vocabulary test fails), then reverting.
The implementing task records each mutation check in its report.
