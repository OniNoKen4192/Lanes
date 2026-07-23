# Lanes — design spec

**Date:** 2026-07-23
**Status:** approved (brainstorming), ready for implementation planning
**Author:** Ken + Claude

## 1. What this is

**Lanes** is a portable, project-agnostic extraction of the cross-model
development workflow currently running inside `S:\GirlsSchedulingProject`
(the "Wisconsin Ice Exchange" / WIX project). It is packaged as a Claude
Code **plugin** distributed from a shareable GitHub repo, so it can be
installed into any suitably-formed project — and shared with friends —
without copying machinery around by hand.

The workflow it packages: **route each development task to the cheapest
model that can do it correctly.** Frontier Claude spends its quota only on
planning and review (where judgment pays) and on security-critical code;
everything else is delegated to a subscription-pool model (today: Codex /
GPT-5.6 via the codex MCP server). This preserves the frontier usage pool
for the work that actually needs frontier judgment.

Lanes is **already proven in production** inside WIX. This project is an
*extraction*, not an invention: the goal is to lift the proven pipeline
into a generic form that stays faithful to the original discipline while
shedding every WIX-specific fact.

### Vocabulary

Two words carry the whole model, chosen so they survive a backend swap
(nothing presumes Codex):

- **KEEP** — work that stays with frontier Claude: all planning, all
  review, and anything security-critical. *"Keep it in-house."*
- **DELEGATE** — work pushed to the subscription-pool model via the
  configured backend. *"Delegate it out."*

The original pipeline's `CLAUDE` / `CODEX` lane labels map to KEEP /
DELEGATE respectively.

Tagline: *"Lanes routes each task to the cheapest model that can do it
correctly — frontier judgment for planning and review, delegated muscle
for the rest — so you burn your frontier quota only where it earns its
keep."*

## 2. Scope

**v1 is the extraction, not new capability.** The following are explicit
NON-goals for v1 and are named in §11 as future work:

- No second delegate backend (Codex/MCP is the only implemented backend).
- No N-lane framework — the model is strictly binary KEEP/DELEGATE.
- No new verification/test harness for Lanes itself.

If it isn't in the WIX pipeline today, it is out of scope for v1.

## 3. Foundational decisions (settled during brainstorming)

1. **Dependency:** Lanes is an **add-on to superpowers**. It assumes the
   superpowers SDD loop exists (brainstorming → writing-plans →
   executing-plans), plans live in `docs/superpowers/plans/`, and the
   ledger lives at `.superpowers/sdd/progress.md`. The KEEP lane *is* the
   existing superpowers inner loop; Lanes adds routing, contract emission,
   dispatch, and review around it. Friends install superpowers first.
2. **Lane model:** binary **KEEP / DELEGATE**, with a **swappable delegate
   backend**. The delegate backend and its tier names are configured per
   project. Routing stays a first-match-wins rule set.
3. **Config surface:** the machinery (agents, commands, routing rules,
   spec template) ships **generic in the plugin** and is **never copied
   into projects**. Project-specific facts live in two files in the target
   repo: `AGENTS.md` (stack, commands, do-not-touch — already a
   cross-tool standard the delegate model reads anyway) and
   `.lanes/config.md` (Lanes-specific settings). Plugin updates propagate
   to every project for free.
4. **Onboarding:** a `/lanes-init` command **inspects the repo** (reads the
   package manifest for real script names, detects the app subdir, greps
   for security-critical files) and **drafts** `.lanes/config.md` for
   approval — the same "read the real thing, never guess" discipline the
   pipeline already enforces.
5. **Readiness floor:** `/lanes-init` requires a *formed* project. Below a
   named floor it refuses, writes nothing, and prints the greenfield path.
   Above the floor it inspects everything inferable and interviews the
   user only about the residue.
6. **Backend depth (v1):** ship **one working backend (Codex MCP) behind a
   documented seam** — every Codex-specific fact isolated to one config
   section and one labeled block in the implementer agent. Not a backend
   framework; a single named replacement point.

## 4. Repository & distribution

A single GitHub repo, `lanes`, that is simultaneously a Claude Code
**plugin** and its own **marketplace**. Install is two commands, then
`/lanes-init` per project:

```
/plugin marketplace add <you>/lanes
/plugin install lanes@lanes
```

### Layout

```
lanes/
├─ .claude-plugin/
│  ├─ plugin.json          # name, version, homepage, MIT license
│  └─ marketplace.json     # repo advertises itself as a marketplace
├─ agents/
│  ├─ lanes-implementer.md  # generic dispatch-and-verify (was codex-implementer)
│  └─ lanes-reviewer.md     # generic review, frontier judgment (was codex-reviewer)
├─ commands/
│  ├─ lanes-init.md
│  └─ lanes-emit.md         # was /emit-tasks
├─ skills/
│  └─ lanes/                # "how the pipeline works" + lane-planning hook
├─ templates/
│  ├─ ROUTING.md            # generic rule shapes, parameterized by config
│  ├─ TEMPLATE.md           # generic spec contract
│  └─ config.example.md     # the .lanes/config.md a project fills in
├─ README.md               # friend-facing pitch + quickstart
└─ LICENSE                 # MIT (matches superpowers)
```

## 5. The generic / per-project split (the heart of the extraction)

The whole extraction is one rule: **behavior is generic and lives in the
plugin; facts are per-project and live in the repo being worked on.**

| Concern | Generic (plugin) | Per-project (target repo) |
|---|---|---|
| Dispatch-and-verify loop | `agents/lanes-implementer.md` | — |
| Review discipline, verdict format | `agents/lanes-reviewer.md` | — |
| Routing *rules* (a/b/c, tiers, doubt defaults) | `templates/ROUTING.md` | the **file lists** those rules match against |
| Spec contract structure | `templates/TEMPLATE.md` | the `command_prefix`, command names |
| Stack, commands, do-not-touch | — | `AGENTS.md` |
| Backend, tiers, security list, review-suite map | — | `.lanes/config.md` |
| Emitted specs (pipeline output) | — | `docs/superpowers/tasks/` |

### The parameterization move

ROUTING.md today *names* `src/auth.ts`, `src/lib/availability.ts`, etc.
Generic ROUTING.md instead states the rule against a config reference:

> *Rule (a): any file in the config's `security-routed` list → KEEP lane.*

The rule logic is universal; the file list is the parameter. Agents and
commands read the plugin copies via `${CLAUDE_PLUGIN_ROOT}` and resolve
the parameters from the project's `AGENTS.md` + `.lanes/config.md` at
runtime. Consequences:

- A plugin update reaches every project instantly.
- No project ever holds a fork of the machinery.
- The per-project surface is two small files a human can read in full.

## 6. `.lanes/config.md` — the per-project parameter file

Human-readable markdown with labeled fields, so both the user and the
agents can read it. Every WIX-specific fact in the current agents traces
to exactly one field here. Illustrative content (WIX values shown; a
non-JS project fills the same fields with its own):

```
# Lanes config

## App root
app_subdir: wisconsin-ice-exchange     # "" if repo root is the app
command_prefix: cd wisconsin-ice-exchange &&

## Verification commands   (resolved from the manifest at init)
test:       pnpm vitest run
lint:       pnpm eslint
typecheck:  pnpm tsc --noEmit
acceptance_runner: pnpm vitest run     # what a spec's acceptance command builds on

## Delegate backend  ← THE SEAM (see §8)
backend:        codex-mcp
dispatch_tool:  mcp__codex__codex
reply_tool:     mcp__codex__codex-reply
tiers:          [sol, terra, luna]     # delegate-lane tier names, best→cheapest
ratelimit_signal: "usage-cap | 429 | rate limit"

## Security-routed files  → always KEEP lane (ROUTING rule a)
- src/auth.ts
- src/lib/authz.ts
- src/lib/availability.ts
- prisma/schema.prisma
- prisma/migrations/**

## Do-NOT-touch (standing exclusions, echoed into every spec)
- src/components/ui/**
- pnpm-lock.yaml

## Review suite  (optional; reviewer's e2e mapping)
suite_command: pnpm test:ux
id_pattern:    "<id>-"
route_map:
  src/app/admin/**: [a1, a2, a3]
  src/app/teams/**: [s5, s6, s7]
```

A Python project's file would set `command_prefix:` empty, `test: pytest`,
a security list like `[app/auth.py, alembic/versions/**]`, and omit the
Review-suite section entirely. The exact field set is finalized during
implementation planning against the real content of the current WIX
`AGENTS.md`, `ROUTING.md`, and `TEMPLATE.md`; the above is the contract
shape, not the frozen schema.

## 7. `/lanes-init` behavior

Four phases, refusing rather than guessing:

1. **Readiness floor.** Require: a package manifest (`package.json` /
   `pyproject.toml` / `Cargo.toml` / `go.mod` / …), at least one runnable
   verification command derivable from it, and a real source tree. Below
   the floor → **write nothing**; print exactly what is missing plus the
   greenfield path ("build the walking skeleton with superpowers first,
   then `/lanes-init`").
2. **Inspect.** Read the manifest for stack + package manager + script
   names; detect the app subdir; grep for auth/authz/schema/migration
   files to *propose* the security-routed list; check for an existing
   `AGENTS.md` / `CLAUDE.md` to lift conventions.
3. **Residue interview.** Ask only what inspection cannot settle — confirm
   the proposed security list, choose the delegate backend + tier names,
   confirm the app prefix. One question at a time.
4. **Emit + confirm.** Write `.lanes/config.md` (and a starter `AGENTS.md`
   if absent), show the draft, print the "commit these, then plan your
   first effort" next step. **Never overwrites** an existing
   `.lanes/config.md` — reports and stops, matching the emitter's own
   no-clobber rule. Its output is the documented template, so hand-editing
   remains fully supported afterward.

## 8. Planning hook & the backend seam

### Planning hook

Lane assignment happens *inside* superpowers' `writing-plans`, not as a
separate step. Lanes ships a `skills/lanes` skill whose planning guidance
states: *after task breakdown, before elaboration, assign every task a
lane per ROUTING.md; record `(LANE: KEEP)` / `(LANE: DELEGATE, tier <t>)`
in each task heading plus a Task/Lane Map table near the top of the plan;
elaborate KEEP tasks to full SDD depth, DELEGATE tasks to **contract depth
only** — files, real interfaces read off the codebase, constraints,
behavioral criteria, acceptance command, no finished code.*

That last rule is the economic core: writing implementation into a
DELEGATE task spends planning-tier tokens on implementation-tier work and
defeats delegation. The skill is the generic home for the lane-planning
instructions the WIX `CLAUDE.md` carries inline today.

### The backend seam

One labeled block in `lanes-implementer.md`: *dispatch via the
`dispatch_tool` named in `.lanes/config.md`; on a follow-up question use
`reply_tool`; treat output matching `ratelimit_signal` as RATE_LIMITED.*
Everything else in the agent is backend-agnostic — the verbatim-spec rule,
the git-derived scope check, the self-rerun of acceptance + regression,
the report format.

v1 ships `backend: codex-mcp` as the one real value, with this block
documented as the single place a second backend plugs in. Because MCP tool
names must appear in the agent's `tools:` frontmatter, v1's implementer
lists the codex tools there; adding a second backend is a documented "add
your tool to `tools:` and set the config fields" change, not a rewrite.

## 9. The four pipeline stages (unchanged from WIX, now generic)

1. **Plan (KEEP, frontier Claude).** superpowers `writing-plans` +
   the Lanes planning hook. Every task gets a lane; DELEGATE tasks stop at
   contract depth.
2. **Emit (`/lanes-emit`).** A compiler, not a planner. Takes an approved
   plan, validates each task's proposed lane against ROUTING.md, and emits
   one TEMPLATE-conformant spec file per DELEGATE task into
   `docs/superpowers/tasks/`. KEEP tasks get no spec file — they stay in
   the superpowers inner loop. **Emits but never dispatches.** Gate-checks
   its own output (runs each acceptance command to confirm it is red).
3. **Implement (`lanes-implementer`).** Dispatch-and-verify; writes no code
   itself. Validates the spec, passes it to the backend **verbatim**, then
   verifies with its own eyes (git-derived file list, scope check vs
   Touch, self-rerun of acceptance + regression). `RATE_LIMITED` is a
   first-class status — never falls back to implementing the task itself.
4. **Review (`lanes-reviewer`, frontier judgment).** The only stage
   allowed to run e2e. Never edits — one verdict: APPROVE / FIX / REJECT.
   Scope is a gate, not a factor. Accepted deviations return as
   `SPEC_UPDATE` instructions for the controller to apply, preserving the
   reviewer's no-write property while keeping the audit trail truthful.

## 10. README (friend-facing)

Ordered: one-paragraph what/why → prerequisites (superpowers + a delegate
backend, currently Codex via MCP) → the two install commands →
`/lanes-init` → "plan an effort, then `/lanes-emit`, then dispatch" → a
diagram of the four stages → the "one working backend, documented seam"
honesty note. MIT license, matching superpowers.

## 11. Future work (named, not built in v1)

- **Second delegate backend** — design the adapter interface against a
  real second implementation (Gemini, plain GPT, a local model), not
  speculatively. The §8 seam is the intended growth point.
- **N-lane / tiered-cost routing** — more than two lanes (e.g. a cheap
  lane for boilerplate, a mid lane for CRUD, frontier for security) if the
  binary model proves too coarse in practice.
- **Verification fixtures** — small fixture projects (one JS, one non-JS)
  plus a checklist to catch leaked stack assumptions and regressions in
  the machinery.
- **Faithfulness check** — a scratch-clone comparison of `/lanes-init`
  output against the hand-written WIX `ROUTING.md` / `AGENTS.md` as a
  ground-truth diff.

## 12. Open items for implementation planning

- Final `.lanes/config.md` field set, pinned against the actual current
  content of WIX's `AGENTS.md`, `ROUTING.md`, and `TEMPLATE.md` (read them
  fresh at plan time — they are the source of truth for what must
  parameterize).
- Exact `${CLAUDE_PLUGIN_ROOT}` reference mechanics for how commands and
  agents locate the generic ROUTING/TEMPLATE at runtime.
- `plugin.json` / `marketplace.json` field values and version scheme.
- Whether the starter `AGENTS.md` that `/lanes-init` can write is a
  full draft or a minimal stub pointing at the config.
```
