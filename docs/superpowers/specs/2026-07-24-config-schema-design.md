# Lanes — schema-versioned config + /lanes-doctor (design spec)

**Date:** 2026-07-24
**Status:** approved (brainstorming), ready for implementation planning
**Author:** Ken + Claude
**Resolves:** issue [#5](https://github.com/OniNoKen4192/Lanes/issues/5)

## 1. What this is

`.lanes/config.md` is free-form Markdown parsed two different ways: a
minimal targeted parse in `bin/lanes-validate.mjs` (`parseConfig`, built
as a stopgap in the scope-gate slice) and model judgment everywhere else
(emitter, implementer, reviewer, skill, init). Misspellings, duplicate
keys, and ambiguous lists can be read differently by different agents,
silently — for a file that carries the security-routed deny list, that is
a real hazard.

This slice moves the machine-read config to a schema-versioned JSON file,
makes the validator the single parser authority, and adds `/lanes-doctor`
— a health check that validates the config, previews its globs against
the real repo, resolves its commands against the manifest, checks backend
reachability, and reports whether the repo is safe to operate on.

Decisions settled in brainstorming:

1. **Format is JSON** (`.lanes/config.json`). Slice 1 committed Lanes to
   zero-dependency Node; `JSON.parse` is built in, deterministic, and
   needs no hand-rolled parser. The file carries no comments — the
   annotated documentation lives in `templates/config.example.md` (§7).
2. **Hard cut, doctor migrates.** `config.json` is the only config any
   Lanes surface reads. No dual-read fallback anywhere — two parse paths
   is exactly the divergence hazard this issue exists to kill. When a
   legacy `config.md` exists without a `config.json`, `/lanes-doctor`
   offers a one-time confirmed conversion (§5).
3. **Doctor = validator subcommand + thin command.** All deterministic
   checks live in a new `doctor` subcommand of `bin/lanes-validate.mjs`,
   reusing its existing matcher and config loader so semantics cannot
   drift. `commands/lanes-doctor.md` runs it, renders the report, and adds
   the checks only the in-session model can do (MCP tool reachability,
   the migration interview).

## 2. Schema v1 (`.lanes/config.json`)

```json
{
  "schema_version": 1,
  "project":  { "app_subdir": "", "command_prefix": "" },
  "commands": { "test": "…", "lint": "…", "typecheck": "…",
                "acceptance_runner": "…" },
  "backend":  { "name": "codex-mcp",
                "dispatch_tool": "mcp__codex__codex",
                "reply_tool": "mcp__codex__codex-reply",
                "approval_mode": "pilot",
                "tiers": ["sol", "terra", "luna"],
                "ratelimit_signal": ["usage-cap", "429", "rate limit"] },
  "routing":  { "security_routed": ["src/auth.ts", "prisma/migrations/**"],
                "do_not_touch": ["pnpm-lock.yaml", ".env"] },
  "review_suite": { "suite_command": "pnpm test:ux",
                    "id_pattern": "<id>-",
                    "id_index": "docs/workflows.md",
                    "route_map": { "src/app/admin/**": ["a1", "a2"] } },
  "pipeline": { "plans_dir": "docs/superpowers/plans",
                "tasks_dir": "docs/superpowers/tasks",
                "ledger": ".superpowers/sdd/progress.md" }
}
```

Field-for-field this is today's `config.md` vocabulary, renamed only where
nesting demands it (`backend:` scalar → `backend.name`). Two deliberate
formalizations:

- **`ratelimit_signal` is an array of substrings.** Today it is a
  pipe-separated prose string (`"usage-cap | 429 | rate limit"`) that
  every reader re-splits by eye. A backend response marks RATE_LIMITED
  when it contains any listed substring (case-insensitive).
- **`review_suite` remains the one omit-able block** — absent means "no
  e2e/UX suite; the reviewer degrades gracefully to acceptance_runner",
  exactly as today.

**Validation is strict, fail-closed:**

- `schema_version` must be exactly the number `1`; anything else (absent,
  string `"1"`, `2`) is a refusal naming the expected version.
- Required blocks: `project`, `commands`, `backend`, `routing`,
  `pipeline` — and every field shown inside them above, except that
  `routing.security_routed` and `routing.do_not_touch` may be empty
  arrays (a project may genuinely have nothing to list; the key still
  must be present so an empty list is a statement, not an accident).
- Type checks on every field: strings are strings, arrays are arrays of
  strings, `route_map` is an object mapping glob strings to arrays of
  ID strings.
- `commands.lint` and `commands.typecheck` may be the empty string `""`
  — "this project has no such step". The other two commands must be
  non-empty; a Lanes project with no test command failed `/lanes-init`'s
  readiness floor before it ever got here.
- `backend.approval_mode` is the enum `"pilot" | "automated"`.
- `backend.tiers` is a non-empty array.
- **Unknown keys at any level are errors**, named in the failure. A
  misspelled `securty_routed` dies loudly instead of silently orphaning
  the real deny list.

## 3. Single parser authority

`loadConfig()` in `bin/lanes-validate.mjs` becomes: read
`.lanes/config.json`, `JSON.parse`, run the §2 schema validation, return
the config object. The legacy `parseConfig` markdown parser and its
sample-config parse checks are deleted. `gate` and `audit` inherit the
new loader unchanged — their failure posture is already fail-closed on a
config error.

Every prose surface that names `config.md` is updated to name
`config.json` — still model-read where an agent needs a value mid-flight
(the implementer reading `dispatch_tool`, the reviewer reading
`review_suite`), but reading unambiguous JSON instead of annotated
Markdown. Surfaces: `agents/lanes-implementer.md`,
`agents/lanes-reviewer.md`, `commands/lanes-emit.md`,
`commands/lanes-init.md`, `skills/lanes/SKILL.md`, `README.md`,
`hooks/` (only if its files name the config path — the hook itself calls
`gate`, which inherits).

## 4. `doctor` subcommand (deterministic checks)

`node bin/lanes-validate.mjs doctor` runs four checks and prints one JSON
report: per-check `status: "pass" | "warn" | "fail"` with details, plus a
top-level `verdict` (`ok` when nothing failed). Exit 0 only with zero
fails; exit 2 otherwise. Warns never block.

1. **schema** — `loadConfig()` succeeds (§2). On failure the report
   carries the loader's reason verbatim; the remaining checks that need
   the config are skipped and reported as such.
2. **globs** — every pattern in `routing.security_routed`,
   `routing.do_not_touch`, and the `review_suite.route_map` keys is
   previewed against the tracked tree (`git ls-files`) with the existing
   matcher — the #7 semantics, one matcher, no drift. The report lists
   match counts and sample matches per pattern. Zero matches = warn
   (dead pattern or typo — legitimate for a not-yet-created path, so
   never a fail). A malformed pattern (absolute path, `..` segment,
   drive letter) = fail, same hygiene the gate applies to Touch paths.
3. **commands** — each of the four `commands.*` strings is tokenized
   (they are stored without `project.command_prefix` — the prefix is
   applied at spec-emit time, so resolution happens against the manifest
   at `project.app_subdir`, or the repo root when it is empty; an empty
   string, allowed for `lint`/`typecheck` per §2, reports pass with a
   "no such step" note). If the first token is a package-manager runner
   (`pnpm`, `npm`, `yarn`, `bun`, `npx`), the invoked script/binary is
   resolved against that manifest's `scripts` and dependency names; a
   bare command is resolved against PATH. Unresolvable = warn, never
   fail — the manifest cannot prove every valid command wrong (global
   tools, shell builtins, monorepo indirection).
4. **baseline** — the gate's clean-tree check run standalone: `git
   status --porcelain` filtered through the pipeline allowlist
   (`.lanes`, `plans_dir`, `tasks_dir`, `ledger` — literal patterns,
   matching each path and everything beneath it per PATH-MATCHING §6.3,
   exactly as the gate does). Dirty paths
   outside the allowlist are listed; any = fail ("commit or stash before
   dispatching"). This is the "safe to operate on" report from #1.

The subcommand shares one process with `gate`/`audit`, so check 2 and
check 4 are the same code paths the gate itself runs — the doctor
previews exactly what the gate will enforce.

## 5. `commands/lanes-doctor.md` (the command)

Thin by design. In order:

1. **Migration gate.** If `.lanes/config.md` exists and
   `.lanes/config.json` does not: draft the conversion (the legacy
   fields mapped into the §2 shape; `ratelimit_signal` split on `|` and
   trimmed), show the full draft, write only on explicit confirmation,
   then offer to delete the stale `config.md` — leaving it invites
   drift; the user may decline. Then continue to step 2 against the new
   file. If neither file exists: report "not a Lanes project — run
   /lanes-init" and stop.
2. **Run the subcommand** and render its JSON report readably — one
   line per check with status, then details for anything not `pass`.
3. **Backend reachability** (model-side): are `backend.dispatch_tool`
   and `backend.reply_tool` present among the session's callable MCP
   tools? Unreachable = warn, not fail — the backend may be legitimately
   offline or the session started without it; the message says what a
   DELEGATE dispatch would do (fail at the implementer with
   BACKEND_FAILURE).
4. **Verdict line.** One closing line: healthy / healthy with warnings /
   not safe to operate (any fail), with the single next action for the
   worst finding.

The command never edits `config.json` outside the migration path, and
never touches source.

## 6. `/lanes-init` changes

Phase 3 emits `.lanes/config.json` (schema v1, the §2 shape) instead of
`config.md`; the no-clobber rule now guards `config.json`. Phase 3's
template reference switches to `templates/config.example.json` as the
output shape, with `templates/config.example.md` as the field
documentation to consult. The final next-steps message gains "run
`/lanes-doctor` to verify the config against the repo." The readiness
floor, inspection, and interview phases are untouched.

## 7. Templates

- **`templates/config.example.json`** — new: the worked WIX example as a
  machine-valid schema-v1 file; `/lanes-init`'s output shape.
- **`templates/config.example.md`** — rewritten as field-by-field schema
  documentation: same explanatory guidance it carries today (what each
  field means, how init infers it, the WIX worked values), now organized
  by JSON key path with the JSON example inline. The issue's "the
  example/doc file stays as documentation."

## 8. Out of scope

- Conformance suite + CI (#4) — selftest grows schema vectors (§9);
  that is the seed, not the suite.
- Worktree isolation (#3), immutable-spec amendments (#8).
- ROUTING.md, the implementer status taxonomy, and the reviewer verdict
  taxonomy — untouched.
- Any change to gate/audit semantics beyond swapping their config
  loader.

## 9. Testing

`selftest` gains schema-validation vectors: a valid config passes; each
of these fails with the right reason — misspelled key (unknown-key
error), wrong type, `schema_version` absent / string / wrong number,
missing required block; `review_suite` absent still passes; empty-string
`lint` passes while empty-string `test` fails. Plus a parse check for
the command-resolution tokenizer (package-manager detection, script-name
extraction).

Manual e2e for the slice: run `doctor` in this repo against a fixture
config (expect glob previews and a baseline verdict); run the migration
path against a WIX-style `config.md` copy and diff the drafted JSON
against the expected §2 shape. These become automated fixtures in #4.
