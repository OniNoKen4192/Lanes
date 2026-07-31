# Lanes User Guide

Everything you need to go from finding this repo to running fully
unattended, multi-stream builds. Read top to bottom the first time; each
section stands alone afterward.

Lanes routes each task in a plan to the cheapest model that can do it
correctly. Frontier Claude (the model you're talking to) keeps the work
that needs judgment — planning, review, anything security-critical. A
subscription-priced backend (v1: Codex via MCP) grinds through the
well-bounded implementation work in between. You spend frontier quota
only where it earns its keep.

Lanes is an add-on to
[superpowers](https://github.com/obra/superpowers), not a replacement:
superpowers stays your brainstorm → plan → execute loop; Lanes changes
what a plan's tasks look like and adds a compile/dispatch/review path
for the delegated ones.

## The ideas, in 90 seconds

- **Lanes.** Every task in a plan is tagged `KEEP` (frontier Claude does
  it in-session, the normal superpowers way) or `DELEGATE` (compiled to
  a spec and dispatched to the backend). The routing rules live in one
  file, `templates/ROUTING.md`; security-critical work always routes
  KEEP.
- **Specs.** A DELEGATE task becomes one immutable spec file — the
  complete contract: files it may touch, interfaces, acceptance command.
  The backend gets the spec verbatim, nothing else.
- **The scope gate.** A deterministic Node script
  (`bin/lanes-validate.mjs`) checks every dispatch before it happens and
  audits every result after: clean baseline, no security-routed paths,
  no out-of-scope edits, no spec tampering. Fail-closed — anything
  malformed refuses loudly.
- **Worktrees.** Each dispatched task runs in its own git worktree
  (`.lanes/worktrees/<task-id>`, branch `lanes/<task-id>`), so delegated
  work never touches your tree or another task's.
- **Verdicts.** A frontier reviewer re-checks every delegated result
  itself and returns exactly one of: APPROVE (merge it), FIX (delta
  spec, re-dispatch), REJECT (a human problem now).
- **Parks.** When unattended machinery hits something that needs a
  human — a REJECT, a security-routed task, an exhausted fix cap — it
  doesn't halt and it doesn't guess. The task **parks**: work stops on
  it (and anything depending on it), its worktree stays inspectable, and
  the run continues elsewhere. You review parks afterward.
- **The trust ladder.** How much of the pipeline runs unattended is a
  per-project declaration in `.lanes/config.json`:
  `manual → verdicts → roundabout → highways`. You climb it when a
  project's history has earned your trust — nothing climbs it for you.

## Install

Prerequisites: Claude Code, superpowers installed, and a DELEGATE
backend (v1 ships one: Codex via the `codex` MCP server — without it,
everything simply stays KEEP).

```
/plugin marketplace add OniNoKen4192/Lanes
/plugin install lanes@lanes
```

One check: `agents/lanes-reviewer.md` ships with `model: fable` in its
frontmatter. Confirm that alias resolves to your own frontier model, or
override it, before your first review.

## Set up a project

From the root of the project Lanes will operate on:

1. **`/lanes-init`** — inspects your repo and drafts
   `.lanes/config.json`, the one per-project file every Lanes surface
   reads: verification commands, backend tiers, security-routed paths,
   pipeline directories. It refuses on repos below a readiness floor (a
   real manifest, at least one runnable verification command, a
   non-trivial source tree) — build the walking skeleton with
   superpowers first if you're not there yet.
2. **`/lanes-doctor`** — the health check, safe to run any time. It
   validates the config against its schema, previews what every routing
   glob actually matches, resolves your commands against the manifest,
   checks the clean baseline, verifies the dispatch gate's hook matcher
   covers your configured backend tool, and confirms the backend's MCP
   tools are reachable. It ends with exactly one verdict: healthy /
   healthy with warnings / not safe to operate — and the one action that
   unblocks the worst finding. It certifies configuration and repository
   readiness, not that a live dispatch will succeed. It is also the
   one-time migration path from a legacy Markdown config.

The full field-by-field config reference is
[`templates/config.example.md`](../templates/config.example.md), with
[`templates/config.example.json`](../templates/config.example.json) as a
complete worked example. The fields you'll actually revisit:

| Field | What it declares |
|---|---|
| `routing.security_routed` | Paths that force a task KEEP, no exceptions — auth, authz, migrations |
| `routing.do_not_touch` | Files the DELEGATE lane may never modify — lockfiles, secrets, pinned UI |
| `routing.attention` | Named categories of paths that always **park for you** in unattended runs (see the ladder) |
| `backend.tiers` | DELEGATE model tiers, best → cheapest; rate limits fall back down the list |
| `automation` | Your rung on the trust ladder (absent = `manual`) |

## Day one: the manual pipeline

At `manual` (the default — an absent `automation` block means exactly
this), every stage change is yours. You drive by talking to Claude; the
commands below are what Claude runs on your behalf.

1. **Plan.** Brainstorm and plan an effort with superpowers as usual. In
   a Lanes project, the planning hook tags every task `(LANE: KEEP)` or
   `(LANE: DELEGATE, tier <t>)` as the plan is written and puts a
   Task/Lane Map table near the top. You approve the plan as always.
2. **Compile: `/lanes-emit <plan>`.** Re-validates every task's lane
   against the routing rules (the plan proposes, ROUTING.md decides) and
   emits one spec file per DELEGATE task into your `tasks_dir`. KEEP
   tasks get no spec — nothing about them changes, ever.
3. **Dispatch, one spec at a time.** For each spec, in dependency
   order: Claude creates the task's isolation worktree, hands the spec
   to the `lanes-implementer` agent (which validates it, dispatches to
   the backend verbatim, then verifies the result with its own eyes —
   scope, acceptance, regressions, interfaces), and reports one of
   IMPLEMENTED / IMPLEMENTED_WITH_DEVIATIONS / BLOCKED /
   BACKEND_FAILURE / RATE_LIMITED.
4. **Review.** The `lanes-reviewer` agent (frontier judgment) reruns
   every check itself and returns APPROVE, FIX (with a delta spec), or
   REJECT. Scope violations and security-routed touches are automatic
   REJECTs no matter how green the tests are.
5. **You act on the verdict.** APPROVE → merge the task branch, remove
   the worktree, next task. FIX → apply the delta, re-dispatch. REJECT →
   it's yours now.

KEEP tasks run through the ordinary superpowers inner loop the whole
time, exactly as if Lanes weren't installed.

Run a few efforts this way. The pipeline ledger accumulates the
evidence you'll consult when deciding a project has earned the next
rung.

## The trust ladder

Declared per project in `.lanes/config.json`:

```json
"automation": { "level": "verdicts", "max_fix_rounds": 2 }
```

Trust is **declared, not earned by machinery** — you flip the level when
you judge the project ready; the ledger history is evidence you consult,
not a mechanism that flips anything for you. Each rung includes
everything below it.

| Rung | You still do | Runs unattended | Command |
|---|---|---|---|
| `manual` | Everything (the default) | Nothing | — |
| `verdicts` | Plan, emit, dispatch each spec | Verdict handling: APPROVE → merge + clean up; FIX → re-dispatch up to `max_fix_rounds`, then park | — |
| `roundabout` | Approve the plan | The whole task graph: emit → dispatch → review → verdict → merge, serially | `/lanes-run <plan>` |
| `highways` | Approve one stream map | Multi-stream: per-stream planning, concurrent roundabouts, integration + review doc | `/lanes-highway <feature>` |

**The safety floor holds at every rung.** No level, ever:

- runs security-routed or attention-matched work unattended — it parks
  on arrival, every time;
- acts on a REJECT — that is always a human decision;
- pushes to a remote — merges stay local, publishing is yours;
- force-removes parked work — parked worktrees and branches stay
  inspectable;
- changes what the machinery enforces — scope gate, audit, worktree
  isolation, and immutable specs apply to every dispatch identically.
  Automation changes who turns the crank, never what the machinery
  enforces.

`routing.attention` is how you keep topics in your hands while
everything else flows: name a category, list its path globs
(`"billing": ["src/billing/**"]`), and any task touching those paths
parks for you in every unattended run, with the category in the park
reason. Unlike `security_routed` it doesn't force a task KEEP — it just
waits for you.

The commands enforce their rung: `/lanes-run` refuses below `roundabout`,
`/lanes-highway` refuses below `highways`, and neither accepts "just
this once" at the prompt — the config declaration is the only
authorization.

You flip rungs (and the other operational knobs — the fix-round cap,
the backend approval mode, the tier lists) with `/lanes-config`:
`/lanes-config` alone shows current values, `/lanes-config trust
roundabout` sets one. Every write is schema-validated before it lands;
a refused value leaves the file untouched.

## The roundabout: `/lanes-run <plan>`

Point it at an approved, lane-tagged plan. It emits specs if they're
missing, then walks the Task/Lane Map serially in dependency order:
DELEGATE tasks through the full worktree → implementer → reviewer →
verdict cycle; ordinary KEEP tasks inline via the normal superpowers
loop; security-routed and attention-matched tasks parked on arrival.

A task parks — and everything downstream of it leaves the roundabout
while the rest continues — on any of: reviewer REJECT, FIX rounds
exhausted, implementer BLOCKED, backend failure, rate limits after
every tier fell back, security-routed arrival, attention-category
arrival.

**Declared failover.** Set `backend.failover_tiers` (Claude model
aliases, best → cheapest — e.g. `["opus", "sonnet", "haiku"]`) and a
task that exhausts every backend tier doesn't park: it re-dispatches
once to `lanes-claude-implementer`, where Claude writes the code
itself at the alias mapped to the task's tier — same gate before, an
extra controller-run audit after, the same frontier review. Declaring
the field is you pre-authorizing Claude-quota spend for exactly this
case; the run report marks each such task
`implemented-by: claude/<model>`. Leave it out (or `[]`) and
exhaustion parks, as always. (One honest note: the hook that
hard-gates backend dispatches can't fire here — there is no backend
call to intercept — so the agent runs the same deterministic gate
itself, and the controller re-runs the audit on every report.)

The run ends when nothing dispatchable remains and reports two lists:
**landed** (each with its merge commit) and **parked** (each with its
reason and worktree path). Details: [`commands/lanes-run.md`](../commands/lanes-run.md).

## Highways: `/lanes-highway <feature>`

The top rung takes a whole feature, not a plan. What happens:

1. **Stream map.** Claude decomposes the feature into independent work
   streams — each with a mission, a *territory* (the file globs it may
   touch; territories never overlap), dependencies on other streams,
   and the interfaces it exposes to them.
2. **Your one gate.** You approve the stream map. That's the run's only
   human touch.
3. **Walk away.** One frontier planner subagent writes each stream's
   lane-tagged plan (in parallel); a plan check verifies every task
   stays inside its stream's territory; streams then execute
   concurrently, each on its own `highway/<stream-id>` branch, each
   running the same roundabout cycle as `/lanes-run`.
4. **Integration.** Completed streams merge into a `highway/integration`
   branch in dependency order — a merge conflict parks the stream, it
   never gets hand-resolved unattended — and a frontier integration
   review runs across the combined result: cross-stream interfaces,
   duplicated work, seams.
5. **Come back to two things.** The `highway/integration` branch and a
   review document (`docs/superpowers/highways/<date>-<feature>-run.md`)
   with the whole run laid out: per-stream landings and parks,
   integration findings by severity, attention parks by category. Your
   working branch was never touched — read the review, then land the
   run with `git merge highway/integration`, or discard the branch and
   nothing happened.

Details: [`commands/lanes-highway.md`](../commands/lanes-highway.md).

## Rest stops: `/lanes-rest-stop`

Any rung, any time — even before `/lanes-init` (it's the one command
that doesn't need `.lanes/config.json`; config just adds the
Lanes-specific findings). Run it when you're wrapping up a session. It
gathers the evidence (the session's commits, dirty and unpushed work,
leftover task worktrees, your `whiteboard.md` if you keep one),
proposes a summary and record updates — you confirm every one — then
writes two artifacts and commits them locally:

- **`triplog.md`** (repo root): permanent project memory, newest entry
  first — what shipped, what was decided and why, what was left loose.
  Come back months later and read the story top-down.
- **`.lanes/seed.md`**: the resume pointer — where you left off, what's
  parked, and the first action to take next time. One rolling file;
  git history is the archive.

Next session, a Lanes hook prints one line if a seed exists — "A rest-stop seed from <date> exists — read .lanes/seed.md to resume." — and you (or Claude) decide whether to pick it up. Nothing is
auto-loaded, and the ritual never pushes.

Details: [`commands/lanes-rest-stop.md`](../commands/lanes-rest-stop.md).

## What's on disk

| Path | What it is |
|---|---|
| `.lanes/config.json` | The one config every surface reads (schema-validated) |
| `.lanes/state/` | Dispatch baselines the gate/audit compare against — don't edit |
| `.lanes/worktrees/` | Per-task and per-stream isolation worktrees (git-excluded) |
| `.lanes/seed.md` | The rolling resume seed `/lanes-rest-stop` writes (committed) |
| `triplog.md` | Permanent session-by-session project memory (repo root, committed) |
| `<tasks_dir>` | Emitted DELEGATE specs, one per task |
| `<plans_dir>` | Plans and Highways stream maps |
| `<ledger>` | Append-only pipeline history, one entry per task |
| `docs/superpowers/highways/` | Highway run review docs (left uncommitted for you) |

## When something refuses

Everything in Lanes fails closed and names its reason — the refusal
message is the troubleshooting guide. The common ones:

- **Doctor says "not safe to operate."** It names the failed check and
  the one action that unblocks it. Do that; re-run.
- **"unknown key …" on a config that looks right.** Either a typo (the
  strictness is the point — a misspelled security list must die loudly)
  or an older installed plugin reading a newer config: update the
  plugin.
- **Gate: "working tree is not clean."** Commit or stash before
  dispatching — every post-task diff must be attributable to the
  delegate. (Pipeline-owned paths like specs and plans are exempt.)
- **Gate: Touch path matches `security_routed`.** That task can't be
  delegated, period. Re-plan it as KEEP.
- **Backend tools unreachable (doctor warning).** The MCP server isn't
  connected in this session. DELEGATE dispatch would fail until it is;
  KEEP work is unaffected.
- **RATE_LIMITED.** The dispatcher falls back a tier automatically;
  when every configured tier is exhausted, the task parks rather than
  hammering the backend — unless `backend.failover_tiers` is declared,
  in which case it re-dispatches once to `lanes-claude-implementer`
  (see the roundabout section).
- **"worktree already exists" / leftover parked worktrees.** Inspect,
  then dispose:
  `worktree remove --task <id>` (add `--force` to discard uncommitted
  work — parked work is never force-removed for you).

## Going deeper

| Doc | What's in it |
|---|---|
| [`templates/config.example.md`](../templates/config.example.md) | Every config field, with a worked example |
| [`templates/ROUTING.md`](../templates/ROUTING.md) | The routing authority: what may be delegated |
| [`skills/lanes/SKILL.md`](../skills/lanes/SKILL.md) | The whole pipeline on one screen (what Claude follows) |
| [`commands/lanes-run.md`](../commands/lanes-run.md) | Roundabout procedure, park semantics, hard rules |
| [`commands/lanes-highway.md`](../commands/lanes-highway.md) | Highways procedure, stream maps, review doc contents |
| [`docs/PATH-MATCHING.md`](PATH-MATCHING.md) | Glob semantics for every routing pattern |
| `docs/superpowers/specs/` | The dated design specs behind each behavior |
