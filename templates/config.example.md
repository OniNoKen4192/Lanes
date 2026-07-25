# Lanes config — schema v1  (`.lanes/config.json`)

The machine-read Lanes config is `.lanes/config.json` — a schema-versioned
JSON file, the ONLY per-project surface Lanes reads. `/lanes-init` drafts
it by inspecting your repo; `/lanes-doctor` validates it and previews what
it actually matches. JSON carries no comments, so this document is the
field-by-field reference. The worked example values here are pinned
against a real project (Wisconsin Ice Exchange, "WIX");
[`config.example.json`](config.example.json) is the same example as a
complete, schema-valid file — and `/lanes-init`'s output shape.

Validation (`bin/lanes-validate.mjs`) is strict and fail-closed: unknown
keys at any level, wrong types, or a wrong `schema_version` are refusals.
A misspelled key dies loudly instead of silently orphaning the list it
was supposed to be.

## `schema_version`  (number, required)

Exactly the number `1`. Anything else — absent, the string `"1"`, `2` —
is refused, naming the expected version.

## `project`

- `app_subdir` (string): path from repo root to the actual app (`""` if
  the repo root IS the app). `/lanes-init` infers it by finding the
  nearest package.json that isn't the repo-root workspace manifest.
  WIX: `"wisconsin-ice-exchange"`.
- `command_prefix` (string): prepended to every command in every emitted
  spec so the delegate runs from the app dir. Derived from `app_subdir` —
  WIX: `"cd wisconsin-ice-exchange &&"`; `""` when the repo root is the
  app.

## `commands`

Resolved from your package manifest (package.json scripts) at init;
`/lanes-doctor` re-resolves them any time. Stored WITHOUT the
`command_prefix` — the prefix is applied when specs are emitted.

- `test` (string, non-empty): the unit runner — WIX: `"pnpm vitest run"`.
- `lint` (string): base command only — callers/specs append the paths to
  lint (WIX uses `pnpm eslint <paths>`). `""` means "this project has no
  lint step".
- `typecheck` (string): WIX: `"pnpm tsc --noEmit"`. `""` means "no
  typecheck step".
- `acceptance_runner` (string, non-empty): what a task spec's acceptance
  command builds on (the unit runner) — usually identical to `test`
  unless your project splits "run everything" from "run one file".

## `backend`  ← THE SEAM (v1 ships codex-mcp only)

- `name` (string): the backend identifier — v1: `"codex-mcp"`.
- `dispatch_tool` / `reply_tool` (strings): the MCP tool names the
  implementer calls — v1: `"mcp__codex__codex"` /
  `"mcp__codex__codex-reply"`.
- `approval_mode`: `"pilot"` (backend asks on-request) or `"automated"`
  (never asks). The implementer's dispatch SEAM reads this to set the
  backend's approval policy.
- `tiers` (array of strings, non-empty): DELEGATE-lane tier names,
  best→cheapest. `/lanes-init` defaults to the backend's stock tiers;
  rename here if your project uses different labels.
- `ratelimit_signal` (array of strings): substrings that mark a
  rate-limit/usage-cap response. A backend response containing ANY of
  them (case-insensitive) is RATE_LIMITED, so the dispatcher falls back
  a tier instead of getting a false BACKEND_FAILURE. The example values
  are illustrative — the exact substrings depend on your backend's
  actual error text.

## `routing`

Patterns in both lists follow `docs/PATH-MATCHING.md` (normative): `*`
within a segment, `**` across segments, a literal path matches itself
and everything beneath it, matching is case-insensitive. Patterns are
**repo-relative from the git toplevel, not from `app_subdir`** — when
the app lives in a subdirectory, every pattern must carry the prefix
(WIX: `wisconsin-ice-exchange/src/auth.ts`, never bare `src/auth.ts`,
which would match nothing). `/lanes-doctor`'s glob preview catches a
missing prefix as an all-zero-matches warning.

- `security_routed` (array of strings): any task whose Touch list
  matches one of these routes KEEP (the in-session lane), no
  exceptions — even a test-only touch of one of these must still be
  declared as Do-NOT-touch. `/lanes-init` proposes this list by grepping
  for auth/authz/availability-style guard files and schema/migration
  paths; you confirm it. May be `[]`, but the key must be present — an
  empty list is a statement, not an accident.
- `do_not_touch` (array of strings): files the DELEGATE lane must never
  modify regardless of task, even when not security-critical (pinned UI
  primitives, lockfiles, secrets). Pipeline-owned paths named by
  `pipeline.*` are already protected structurally and do NOT need to be
  repeated here.

## `review_suite`  (optional — omit the whole block if no e2e/UX suite)

- `suite_command` + `id_pattern`: how the reviewer runs one suite by ID
  (`id_pattern` substitutes the ID into the runner's filename filter —
  mind trailing separators if short IDs are prefixes of longer ones,
  e.g. `s1` matching `s10`).
- `id_index`: the doc whose coverage table maps IDs to spec files.
- `route_map` (object: glob → array of workflow IDs): touched-path glob
  → workflow IDs to run.

Leave the whole block out of your `config.json` entirely if your project
has no separate e2e/UX suite — the reviewer step degrades gracefully to
just the `acceptance_runner`.

## `pipeline`  (defaults shown in the example; override only if your repo differs)

- `plans_dir` / `tasks_dir`: where the planner writes plans and emitted
  task specs.
- `ledger`: the running build-progress log every task appends to.

`/lanes-init` writes the defaults from `config.example.json` unless it
finds an existing `docs/superpowers/` or `.superpowers/sdd/` layout with
different paths.

## `automation`  (optional — omit if using manual/default mode)

- `level` (string, enum): `"manual"` (reviewer-driven), `"verdicts"`
  (auto-commit on verdicts), or `"conveyor"` (auto-implement + commit).
  Default: `"manual"`.
- `max_fix_rounds` (number, optional, ≥1): maximum fix iteration rounds
  in conveyor and verdicts modes. Default: `2`.

Omit the whole block for manual-mode defaults.

## Migrating from the legacy `.lanes/config.md`

Projects configured before schema v1 have a free-form Markdown config.
Run `/lanes-doctor`: it detects the legacy file, drafts the JSON
conversion, writes it on your confirmation, and offers to delete the
stale `.md` (recommended — a leftover copy invites drift).
