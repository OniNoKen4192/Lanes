# Claude Failover — Design

**Date:** 2026-07-26
**Status:** Approved (design review with Ken, 2026-07-26)
**Depends on:** 2026-07-25-roundabout-automation-design.md (conveyor, park semantics),
2026-07-25-highways-streams-design.md (execution driver, review doc)

## 1. Problem

When the DELEGATE backend's subscription pool is exhausted entirely — not a
per-tier blip but an account-level usage cap — every dispatch walks the
`backend.tiers` ladder, hits the `ratelimit_signal` on each rung, and the
task parks as RATE_LIMITED. In an unattended conveyor or highway run this
stalls the whole remaining task graph for hours, even though the caps reset
on a schedule and the work could have kept flowing on a declared
alternative.

Detection already exists and is not this design's concern: the implementer
reports RATE_LIMITED, never retries, never waits, never self-implements —
"the dispatcher owns rerouting." This design is the rerouting.

## 2. Config surface

One new **optional** field in the `backend` block:

```json
"failover_tiers": ["opus", "sonnet", "haiku"]
```

- **Meaning:** Claude model aliases (values for the Agent tool's `model`
  parameter), ordered **best → cheapest** — the same ordering convention as
  `backend.tiers`.
- **Mapping rule:** a spec's `Model hint` names a tier in `backend.tiers`;
  let `i` be its index there. The failover model is
  `failover_tiers[min(i, failover_tiers.length - 1)]` — index-for-index,
  clamped to the last (cheapest) entry when the failover list is shorter.
- **Schema:** new type `"string[]?"` in SCHEMA_V1 — optional; when present
  it must satisfy `isStringArray`, with error message
  `'backend.failover_tiers' must be an array of strings`. An empty array is
  valid and means the same as absence: no failover. (Unlike `tiers`, there
  is no non-empty rule.)
- **Normalization (loadConfig):** `cfg.backend.failover_tiers =
  cfg.backend.failover_tiers ?? [];` — downstream consumers never branch on
  absence, matching the `automation` / `routing.attention` precedent.
- **Doctor:** the report gains `failover_tiers: config ?
  config.backend.failover_tiers : null`. No alias validation — Claude model
  aliases evolve; `config.example.md` carries the guidance instead.
- **§5.5 lockstep applies:** SCHEMA_V1 ↔ conformance VOCAB ↔
  `templates/config.example.json` ↔ `templates/config.example.md` change in
  the same task. The example config gains the field (so the vocab test can
  pin it) and documents it in the .md; the example remains
  `automation.level: "manual"` as always.

## 3. The `lanes-claude-implementer` agent (new)

`agents/lanes-claude-implementer.md` — the backend-in-an-agent. It follows
the `lanes-implementer` contract with Phase 2 replaced by "you write the
code yourself." It is dispatched by a run controller via the Agent tool
with an explicit `model:` override (the mapped failover tier); it is never
invoked directly by a user and never chosen for first-line dispatch.

- **Frontmatter:** `name: lanes-claude-implementer`; `tools: Read, Grep,
  Glob, Bash, Edit, Write`. Description says: use ONLY when a Lanes run
  controller re-dispatches a RATE_LIMITED task under declared failover
  (`backend.failover_tiers`); input is a spec file path plus a worktree
  path.
- **Phase 1 — Validation Gate:** identical to `lanes-implementer`: run
  `node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" gate --spec <path>`
  from inside the worktree first; any non-zero exit → BLOCKED with the
  gate's JSON reason, never second-guessed. Then the same checks:
  acceptance command runs red, Touch list non-empty with existing parent
  dirs, Interfaces present when dependencies exist, dependencies merged.
- **Phase 2 — Implement (replaces the dispatch seam):** implement the spec
  literally, yourself, inside the worktree. Modify ONLY paths listed under
  Touch. No features, options, refactors, or documentation beyond the
  spec. **Never run any git command that writes** — no commit, branch,
  checkout, merge, rebase, reset, stash, or tag; every change stays
  uncommitted; the controller owns git state. If the spec is impossible to
  satisfy as written, stop and report BLOCKED instead of improvising.
- **Phase 3 — Verification:** same as `lanes-implementer`: run
  `audit --task <id>`, run the acceptance command, run the regression
  guard, compare implemented signatures against Interfaces.
- **Phase 4 — Report:** the same Report Format. Reachable statuses:
  IMPLEMENTED, IMPLEMENTED_WITH_DEVIATIONS, BLOCKED. BACKEND_FAILURE and
  RATE_LIMITED do not exist for this agent — there is no external backend.
  One acceptance-fix attempt maximum, same as the dispatch implementer.
- **Not in the SEAM:** this agent is not "the second backend" the
  implementer's SEAM block documents. The SEAM contract (replace the
  block + four config fields + tools line + hook matcher) is for a real
  external backend replacing Codex; failover is additive and lives
  entirely outside `lanes-implementer.md`, which does not change.

## 4. Controller flow

Failover engages in exactly two places — the `/lanes-run` conveyor and the
`/lanes-highway` execution driver — and nowhere else.

1. A task dispatches to `lanes-implementer` exactly as today.
2. If the report is RATE_LIMITED **and** `backend.failover_tiers` is
   non-empty: re-dispatch the SAME task — same spec, same worktree — to
   `lanes-claude-implementer` via the Agent tool with
   `model: <mapped alias>` (mapping rule in §2). This is one re-dispatch,
   not a ladder walk: the failover list maps by tier, it is not a retry
   chain.
3. If the report is RATE_LIMITED and `failover_tiers` is empty: park, as
   today. Unchanged.
4. **Controller-side audit re-run (mandatory):** on ANY report from
   `lanes-claude-implementer`, the controller runs
   `node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" audit --task <id>`
   itself, from the main tree, before acting on the report. The audit's
   JSON — not the agent's claims — is the changed-file evidence handed to
   review. Adjudication when they disagree: `out_of_scope` entries the
   report omitted → downgrade the task to IMPLEMENTED_WITH_DEVIATIONS
   with the audit's findings appended; any `forbidden` path or
   `commits_past_base` entry → park the task immediately (hard-rule
   violation, human review), regardless of what the report claimed.
5. The report then flows into the existing verdict machinery unchanged:
   `lanes-reviewer` reviews the diff exactly as it reviews Codex work —
   APPROVE merges, FIX re-dispatches (a FIX delta on a failover-implemented
   task re-dispatches to `lanes-claude-implementer` at the same model, not
   to Codex — the pool is presumed still dry for this task), REJECT parks
   for the human.
6. If the Agent dispatch itself fails (Claude-side capacity/usage
   failure), park the task with the error as the reason. There is no
   third fallback.

**No dry-state latch.** The controller records nothing about backend
health. The next task in the walk dispatches to `lanes-implementer` (the
Codex path) exactly as if nothing happened; if the cap has reset, work
flows back to Codex by itself, and if not, that task's RATE_LIMITED
re-routes it too. A dry Codex costs a few fast-failing MCP calls per task
— the price of having zero failover state to corrupt or resume.

**Modes:** failover auto-engages only in unattended walks (conveyor,
highways). At `manual` and `verdicts`, a RATE_LIMITED report surfaces to
the human as today; the human may of course dispatch
`lanes-claude-implementer` deliberately, but nothing does it for them.

## 5. Trust and safety

- **The safety floor is untouched.** Security-routed and
  attention-matched tasks park before ANY dispatch — failover can never
  see them. REJECT stays human. Nothing is pushed. Parked work is never
  force-cleaned.
- **Honest gap, named:** the PreToolUse hard gate hooks the MCP dispatch
  tool; a Claude implementer makes no MCP call, so that hook cannot fire
  for it. Compensations: (a) the agent runs the same deterministic gate
  itself in Phase 1; (b) the controller's mandatory audit re-run (§4.4)
  catches scope violations even if the agent lies or drifts; (c) the
  frontier reviewer sees every diff. Defense stays in depth; only the
  hook layer is absent, and the docs say so.
- **Quota honesty:** failover spends Claude quota on work the user routed
  away from Claude deliberately. That is why it is declared config
  (`failover_tiers` present = pre-authorization), never a default, and
  why provenance (§6) makes the spend visible after the fact.

## 6. Provenance

Every failover-implemented task is marked wherever the run records
outcomes:

- Run ledger entry: `implemented-by: claude/<model>` (e.g.
  `implemented-by: claude/haiku`).
- The conveyor run report and the Highways review doc each carry the same
  marker per task, and the review doc's summary counts failover tasks so
  the reader sees the spend at a glance.
- Codex-implemented tasks need no marker; absence means the normal path.

## 7. Deliverables

1. **Validator** (`bin/lanes-validate.mjs`): `"string[]?"` schema type;
   `backend.failover_tiers` field; loadConfig normalization; doctor report
   field. Selftest vectors: wrong type (`"opus"`), non-string entries
   (`[1]`); valid-with-field and valid-empty-array vectors.
2. **Agent** (`agents/lanes-claude-implementer.md`): new file per §3.
3. **Commands**: `commands/lanes-run.md` and `commands/lanes-highway.md`
   gain the failover step (§4) including the mandatory audit re-run, the
   FIX-stays-on-claude rule, and the park-on-Agent-failure rule.
4. **Templates**: `config.example.json` gains `failover_tiers` (example:
   `["opus", "sonnet", "haiku"]`); `config.example.md` documents the
   field, the best→cheapest ordering, the index-clamp mapping, and that
   absence/empty means park-as-today.
5. **Docs**: `docs/USER-GUIDE.md` — short failover paragraph in the
   conveyor section (it is pinned by conformance; the new text must keep
   every existing needle true); README honesty note unchanged (failover
   is not a second backend).
6. **Tests** (`tests/`): schema vectors above; conformance — VOCAB
   lockstep for the new field, agent file exists with load-bearing
   needles (gate command, "Never run any git command that writes",
   three-status rule, no MCP tools in frontmatter), both commands name
   `lanes-claude-implementer` and the controller-side `audit --task`
   re-run, example configs stay `"manual"`.
7. **Whiteboard**: graduate "Backend exhaustion failover" to Graduated,
   pointing at this spec.

## 8. YAGNI — explicitly not building

- No generic backend-failover framework or ordered backend chain; the
  SEAM doc already covers how a real second backend arrives.
- No cap-window recording, no exhaustion timestamps, no `/lanes-resume`
  command — re-invoking the run command IS the resume story.
- No dry-mode probe optimization or backend-health state of any kind.
- No failover at `manual`/`verdicts` rungs; no ask-first interactive mode.
- No alias validation for `failover_tiers` entries.
- No changes to `lanes-implementer.md`, the SEAM block, or
  `hooks/hooks.json`.
