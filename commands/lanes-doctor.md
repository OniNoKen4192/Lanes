---
description: >
  Health check for a Lanes project. Validates `.lanes/config.json`
  (schema v1), previews every routing glob against the repo, resolves
  the verification commands against the package manifest, checks the
  clean baseline, and verifies the DELEGATE backend's MCP tools are
  reachable in this session. Also the one-time migration path from a
  legacy `.lanes/config.md`. Writes nothing except the confirmed
  migration.
---

# /lanes-doctor — is this project safe to operate on?

No argument. Run from the root of the Lanes project. Read-only, with
one exception: the confirmed legacy-config migration in Step 0.

## Step 0 — migration gate (before anything else)

Check which config files exist in `.lanes/`:

- **`config.json` exists** (with or without a leftover `config.md`) →
  proceed to Step 1. If a `config.md` is also present, note in the
  final report that it is stale documentation no Lanes surface reads
  anymore — recommend deleting it (a leftover copy invites drift) —
  but do not block on it.
- **Only `config.md` exists** → offer the one-time migration:
  1. Read the legacy file in full. Read
     `${CLAUDE_PLUGIN_ROOT}/templates/config.example.json` (the output
     shape) and `${CLAUDE_PLUGIN_ROOT}/templates/config.example.md`
     (the field reference). Resolve them via Bash, e.g.
     `cat "${CLAUDE_PLUGIN_ROOT}/templates/config.example.json"`.
  2. Draft `.lanes/config.json` (schema v1) from the legacy fields:
     `app_subdir`/`command_prefix` → `project.*`; `test`/`lint`/
     `typecheck`/`acceptance_runner` → `commands.*`; the `backend`
     scalar → `backend.name`; `dispatch_tool`/`reply_tool`/
     `approval_mode`/`tiers` → `backend.*`; `ratelimit_signal` (a
     pipe-separated string) → `backend.ratelimit_signal`, split on the
     pipe character with each substring trimmed; `security_routed`/
     `do_not_touch` → `routing.*`; the `review_suite` block →
     `review_suite.*` (omit the whole block if the legacy file has
     none); `plans_dir`/`tasks_dir`/`ledger` → `pipeline.*`. Carry
     values verbatim — this is a format conversion, not a
     re-inspection. A legacy field you cannot map, or a required field
     the legacy file lacks, is a question for the user — never a
     silent guess.
  3. Show the full draft. Write `.lanes/config.json` ONLY on explicit
     confirmation.
  4. Offer to delete the now-stale `config.md` (recommended). The user
     may decline; note the leftover in the final report.

  Then continue to Step 1 against the new file.
- **Neither exists** → report "not a Lanes project — run `/lanes-init`
  first" and stop.

## Step 1 — deterministic checks

Run (Bash):

    node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" doctor

Its JSON report is the evidence for four checks — `schema`, `globs`,
`commands`, `baseline` — each `pass | warn | fail`, plus a top-level
`verdict` (`ok` | `not_safe`; the process exits 0 only when nothing
failed). Render it readably: one line per check with its status, then
the details of every check that isn't `pass` — each glob's match count
and sample (or its malformed-pattern error), each unresolved command's
note, each dirty path. Do not re-derive any of these by judgment — the
subcommand's output is the authority (matching semantics:
`${CLAUDE_PLUGIN_ROOT}/docs/PATH-MATCHING.md`).

## Step 2 — backend reachability (session-side)

The one check Node cannot do: look at the MCP tools actually callable
in THIS session. Both `backend.dispatch_tool` and `backend.reply_tool`
(`.lanes/config.json`) must be present among them. Missing = WARN, not
fail — the backend may be legitimately offline or the session started
without its MCP server. Say what it means concretely: a DELEGATE
dispatch would fail at the implementer (BACKEND_FAILURE) until the
backend's MCP server is connected; KEEP-lane work is unaffected.

## Step 3 — verdict

Close with exactly one of these lines, then the single next action for
the worst finding:

- **healthy** — every deterministic check passed, backend reachable.
- **healthy, with warnings** — no failures; list each warning on one
  line (zero-match glob, unresolved command, unreachable backend,
  leftover `config.md`).
- **not safe to operate** — any deterministic check failed; name the
  failed check and the one action that unblocks it (fix the named
  config key, commit/stash the dirty paths, run the migration).

## Hard rules

- Never edit `.lanes/config.json` outside the confirmed Step 0
  migration. Never edit `config.md` at all (deleting it, on the user's
  confirmation, is the one allowed operation).
- Never touch project source, specs, plans, or `.lanes/state/`. This
  command diagnoses; it does not repair.
- Never "quickly fix" a failing check — report it and name the action;
  the fix belongs to the user.
