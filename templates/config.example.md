# Lanes config  (.lanes/config.md)

<!-- This file is the ONLY per-project surface Lanes needs. `/lanes-init`
drafts it by inspecting your repo; you confirm the residue. The plugin's
generic machinery reads these fields at runtime — nothing here is code.
Values below are a worked example pinned against a real project
(Wisconsin Ice Exchange, "WIX"); replace them with your own repo's facts. -->

## App root
<!-- app_subdir: path from repo root to the actual app ("" if the repo root
IS the app). command_prefix: prepended to every command in every emitted
spec so the delegate runs from the app dir. /lanes-init infers app_subdir
by finding the nearest package.json that isn't the repo-root workspace
manifest, and derives command_prefix from it. -->
app_subdir: wisconsin-ice-exchange
command_prefix: cd wisconsin-ice-exchange &&

## Verification commands
<!-- Resolved from your package manifest (package.json scripts) at init.
acceptance_runner is what a task spec's acceptance command builds on (the
unit runner) — usually identical to `test` unless your project splits
"run everything" from "run one file". -->
test:       pnpm vitest run
lint:       pnpm eslint            # base command only — callers/specs append the paths to lint (WIX uses `pnpm eslint <paths>`).
typecheck:  pnpm tsc --noEmit
acceptance_runner: pnpm vitest run

## Delegate backend  ← THE SEAM (v1 ships codex-mcp only)
<!-- dispatch_tool/reply_tool are the MCP tool names the implementer calls.
tiers: DELEGATE-lane tier names, best→cheapest — /lanes-init defaults to
the backend's stock tiers; rename here if your project uses different
labels. ratelimit_signal: substrings that mark a rate-limit/usage-cap
response as RATE_LIMITED, so the dispatcher knows to fall back a tier
instead of getting a false BACKEND_FAILURE. -->
backend:        codex-mcp
dispatch_tool:  mcp__codex__codex
reply_tool:     mcp__codex__codex-reply
approval_mode:  pilot                  # pilot = backend asks on-request; automated = never asks. The implementer's dispatch SEAM reads this to set the backend's approval policy.
tiers:          [sol, terra, luna]
ratelimit_signal: "usage-cap | 429 | rate limit"  # illustrative — the exact substrings depend on your backend's actual error text.

## Security-routed files  → always KEEP lane (ROUTING rule a)
<!-- Any task whose Touch list includes one of these routes KEEP (the
in-session lane), no exceptions — even a test-only touch of one of these
must still be declared as Do-NOT-touch. /lanes-init proposes this list by
grepping for auth/authz/availability-style guard files and schema/
migration paths; you confirm it. -->
security_routed:
  - src/auth.ts
  - src/lib/authz.ts
  - src/lib/availability.ts
  - prisma/schema.prisma
  - prisma/migrations/**

## Do-NOT-touch  (standing exclusions, echoed into every emitted spec)
<!-- Files the DELEGATE lane must never modify regardless of task, even
when not security-critical (pinned UI primitives, lockfiles, secrets).
/lanes-init seeds this from your README/CONTRIBUTING "do not touch"
notes and common patterns (vendored UI kits, lockfiles, .env*); you
confirm and extend it. Pipeline-owned paths named by plans_dir/tasks_dir/
ledger are already protected structurally and do NOT need to be repeated
here. -->
do_not_touch:
  - src/components/ui/**
  - pnpm-lock.yaml
  - .env
  - .env.example

## Review suite  (optional — omit the whole block if you have no e2e/UX suite)
<!-- suite_command + id_pattern: how the reviewer runs one suite by ID
(id_pattern substitutes the ID into the runner's filename filter — mind
trailing separators if short IDs are prefixes of longer ones, e.g. "s1"
matching "s10"). route_map: touched-path glob → workflow IDs to run.
id_index: the doc whose coverage table maps IDs to spec files. Leave the
whole `review_suite:` key out of your config.md entirely if your project
has no separate e2e/UX suite — the reviewer step degrades gracefully to
just the acceptance_runner. -->
review_suite:
  suite_command: pnpm test:ux
  id_pattern:    "<id>-"
  id_index:      docs/workflows.md
  route_map:
    src/app/admin/**: [a1, a2, a3, a4, a5, a6, a7, a8]
    src/app/org/**:   [o1, o2, o3, o4]
    src/app/teams/**: [s5, s6, s7, s10, v2]
    src/app/account/**: [s11]

## Pipeline locations  (defaults shown; override only if your repo differs)
<!-- plans_dir/tasks_dir: where the planner writes plans and emitted task
specs. ledger: the running build-progress log every task appends to.
/lanes-init writes the defaults below unless it finds an existing
docs/superpowers/ or .superpowers/sdd/ layout with different paths. -->
plans_dir: docs/superpowers/plans
tasks_dir: docs/superpowers/tasks
ledger:    .superpowers/sdd/progress.md
