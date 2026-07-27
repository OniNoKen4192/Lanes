# Lanes

Lanes routes each task to the cheapest model that can do it correctly —
frontier judgment for planning and review, delegated muscle for the rest —
so you burn your frontier quota only where it earns its keep. Concretely:
frontier Claude plans your work, assigns each task a lane, reviews
everything that comes back, and personally handles anything
security-critical; a subscription-priced backend (v1: Codex via the codex
MCP server) grinds through the well-bounded implementation work in
between. The point is frontier-quota preservation — you stop spending your
scarcest, most expensive model tokens on boilerplate and mechanical work
that a cheaper model can do just as correctly under a tight enough
contract.

**New here?** The [User Guide](docs/USER-GUIDE.md) walks the whole path
— install, first project, the manual pipeline, and the trust ladder up
to fully unattended runs.

## Prerequisites

- **[superpowers](https://github.com/obra/superpowers)** installed —
  Lanes is an add-on to it, not a replacement. It hooks superpowers'
  `writing-plans` skill and assumes the superpowers SDD loop
  (brainstorming → writing-plans → executing-plans) is already how you
  work.
- **A DELEGATE backend** configured — v1 ships one working backend, Codex
  via the `codex` MCP server. Without a backend, every task simply stays
  in the KEEP lane (see the honesty note below).
- **Claude Code**, obviously.
- `lanes-reviewer` ships with `model: fable` in its frontmatter — confirm
  that alias resolves to your own frontier model, or override it, before
  your first review.

## Install

```
/plugin marketplace add OniNoKen4192/Lanes
/plugin install lanes@lanes
```

## Set up a project

Run `/lanes-init` once, from the root of the project you want Lanes to
operate on. It inspects your package manifest, verification commands, and
source tree, then drafts `.lanes/config.json` — the one per-project file
every Lanes command and agent reads. It refuses to run below a documented
readiness floor: your project needs a real package manifest, at least one
runnable verification command, and a non-trivial source tree (manifest +
README alone isn't enough) — if you're still at that stage, build the
walking skeleton with superpowers first, then come back.

After init — or any time — run `/lanes-doctor`: it validates the config
against its schema, previews what your security globs actually match,
resolves your verification commands against the manifest, and reports
whether the repo and backend are safe to operate on. It is also the
migration path if your project still has a legacy Markdown config.

## Use it

1. **Plan an effort.** Lane assignment happens *inside* superpowers'
   `writing-plans` — the `lanes` skill hooks that step and tags every task
   `(LANE: KEEP)` or `(LANE: DELEGATE, tier <t>)` as the plan is written.
2. **`/lanes-emit <plan>`.** Compiles the approved plan: validates every
   task's lane against the routing rules and emits one spec file per
   DELEGATE-routed task into your project's tasks directory. KEEP tasks
   get no spec file at all.
3. **Dispatch DELEGATE specs to `lanes-implementer`.** Each task runs in
   its own controller-created git worktree (`.lanes/worktrees/<task-id>`),
   so delegated work never touches your tree or another task's — and a
   dirty main tree no longer blocks dispatch. The implementer validates the
   spec, hands it to the configured backend verbatim, verifies the result
   itself (scope, acceptance, regression, interfaces — never the backend's
   word alone), and reports IMPLEMENTED / IMPLEMENTED_WITH_DEVIATIONS /
   BLOCKED / BACKEND_FAILURE / RATE_LIMITED.
4. **Review with `lanes-reviewer`.** Frontier judgment, one verdict:
   APPROVE, FIX (with a delta spec), or REJECT. Scope violations and
   security-routed touches are automatic rejections, no matter how clean
   the tests look.

KEEP tasks never enter any of this — they run through the ordinary
superpowers inner loop exactly as if Lanes weren't installed.

## The four stages

```mermaid
flowchart LR
    A["Plan\n(KEEP — frontier Claude,\nwriting-plans + lanes skill)"] --> B["Emit\n(/lanes-emit)"]
    B -->|"DELEGATE task"| C["Implement\n(lanes-implementer →\nDELEGATE backend)"]
    B -->|"KEEP task: no spec file"| E["superpowers inner loop\n(unchanged)"]
    C --> D["Review\n(lanes-reviewer — KEEP,\nfrontier judgment)"]
    D -->|APPROVE| F["ledger + done"]
    D -->|"FIX (delta spec)"| C
    D -->|REJECT| A
```

Plan and Review are always KEEP (frontier judgment). Emit is a compiler,
not a lane itself. Implement is where DELEGATE-routed work actually runs;
KEEP-routed tasks skip Emit/Implement/Review entirely and stay in the
superpowers loop.

## The trust ladder: running unattended

Everything above is `manual` mode — every stage change is a human
handoff, and that's the default. When a project's pipeline history has
earned your trust, you declare a higher rung in `.lanes/config.json`
(`automation.level`) and the handoffs disappear one class at a time:

| Rung | You still do | Runs unattended |
|---|---|---|
| `manual` | Everything | Nothing |
| `verdicts` | Plan, emit, dispatch | Verdict handling (APPROVE → merge; FIX → re-dispatch up to a cap) |
| `conveyor` | Approve the plan | The whole task graph, via `/lanes-run <plan>` |
| `highways` | Approve one stream map | Multi-stream builds with parallel planning and an integration review, via `/lanes-highway <feature>` |

Trust is declared, not earned by machinery — you flip the setting; the
ledger history is evidence you consult, not a mechanism. A safety floor
holds at every rung: security-routed and `routing.attention`-matched
work always **parks** for a human instead of running unattended, REJECT
is always a human decision, nothing is ever pushed to a remote, and a
highway run never touches your working branch — its entire output is a
`highway/integration` branch plus a review document you read before
landing anything. And when the DELEGATE backend's usage pool runs dry
mid-run, tasks park by default — unless you've declared
`backend.failover_tiers`, in which case each exhausted task
re-dispatches once to a Claude implementer
(`lanes-claude-implementer`) under the same gate, audit, and review,
with the spend marked `implemented-by: claude/<model>` in the run
report. The [User Guide](docs/USER-GUIDE.md) covers the
ladder in detail.

When a session winds down, `/lanes-rest-stop` closes it out: a guided
ritual that summarizes the session, triages your whiteboard with you,
surfaces loose ends, prepends the story — decisions and the why behind
them — to a permanent `triplog.md`, and writes a resume seed that a
session-start hook announces next time. Config-optional, works in any
git repo, and it never pushes.

## Honesty note

v1 ships **one working backend (Codex/MCP)** behind a documented seam — it
is not a backend framework. Every Codex-specific fact (tool names,
dispatch/reply calls) is isolated to the block marked
`<!-- BEGIN BACKEND SEAM -->` / `<!-- END BACKEND SEAM -->` in
[`agents/lanes-implementer.md`](agents/lanes-implementer.md), plus four
fields in `.lanes/config.json` (`dispatch_tool`, `reply_tool`,
`approval_mode`, `ratelimit_signal`) and that agent's `tools:` frontmatter
line. A second backend is a config change plus a rewrite of that one
block — not a rewrite of the plugin.

## License

MIT — see [LICENSE](LICENSE).
