# Lanes v3 "Highways" — parallel stream orchestration (design spec)

**Date:** 2026-07-25
**Status:** approved by Ken (design presented and accepted in session)
**Author:** Claude, with Ken's decisions at every fork
**Graduates:** whiteboard idea "v3: Highways"
**Builds on:** `2026-07-25-roundabout-automation-design.md` (Roundabout)

## 1. What this is

Roundabout's conveyor drives one approved plan end-to-end, serially.
Highways adds the topology above it: `/lanes-highway <feature-brief>`
takes a feature, decomposes it into independent work streams, gets one
human approval (the stream map), then runs everything else unattended —
per-stream frontier planning in parallel, interleaved conveyor execution
across streams, stream merges, a cross-stream integration review, and a
review document the human reads afterward. Lanes' economics make this
affordable: frontier judgment sits at the head of every stream, while
each stream's implementation work drops to the DELEGATE backend.

Decisions (Ken's, at each fork):

1. **Full two-level topology**, not just parallel dispatch inside one
   conveyor. Top level decomposes into streams; each stream gets its own
   frontier-written, lane-tagged plan; streams execute concurrently.
2. **One human gate: stream-map approval.** Stream plans are checked by
   machine + the top-level session, not by the human. In exchange, the
   run's output is fully contained (Section 4 step 7) and the after-run
   review document is a first-class deliverable.
3. **Attention topics** — a configurable park-routing vocabulary
   (`routing.attention`): named categories of path globs that always
   park for the human in unattended runs. Generalizes the
   `security_routed` idea into declared attention areas.
4. **Matching is path-glob only**, identical in mechanism to
   `security_routed` — deterministic, validator-enforced, testable. No
   semantic/prose matching.
5. **A new trust rung**: the ladder becomes
   `manual | verdicts | conveyor | highways`. Letting subagent-written
   plans run unattended is a bigger trust step than conveyor and gets
   its own declaration.
6. **Integration: park conflicts, then review.** Stream merges that
   conflict park the stream; a frontier integration review runs across
   the combined result; nothing ever lands on the human's working
   branch.
7. **Architecture: parallel planning fan-out, single execution driver.**
   Platform reality: subagents cannot spawn subagents, so a per-stream
   orchestrator subagent could never dispatch implementers or fresh
   reviewers. Planning fans out to one frontier planner subagent per
   stream; execution is driven by the one top-level session, which is
   the only context holding the Agent tool — preserving reviewer
   independence (a fresh reviewer subagent per verdict), Lanes' core
   guarantee.

## 2. Config schema

`schema_version` stays `1`. Two additive changes:

### 2.1 `automation.level` gains `"highways"`

The enum becomes exactly `"manual"`, `"verdicts"`, `"conveyor"`,
`"highways"` — any other value is a refusal naming all four. Rungs are
cumulative: each level authorizes everything below it. Concretely:

- `/lanes-run` (conveyor) requires level `"conveyor"` **or**
  `"highways"` — its precondition wording changes from "exactly
  conveyor" to name both.
- `/lanes-highway` requires exactly `"highways"` and refuses below it,
  same refusal pattern as `/lanes-run`: the declared trust level IS the
  authorization; no "just this once".

### 2.2 `routing.attention` — attention topics

A new OPTIONAL key inside the existing required `routing` block:

```json
"routing": {
  "security_routed": ["src/auth.ts"],
  "do_not_touch": [".env"],
  "attention": {
    "billing": ["src/billing/**"],
    "schema": ["prisma/migrations/**"]
  }
}
```

- Shape: an object map — category name (non-empty string) → array of
  glob strings (each non-empty). An empty map is allowed. Non-object
  values, non-array categories, and non-string globs are refusals.
  Validation follows the existing map-typed precedent
  (`review_suite.route_map`); this is the schema's first
  optional-key-inside-a-required-block, so the field-type table gains an
  optional-map case.
- Absent key ⇒ normalized to `{}` by `loadConfig` (same
  always-present-after-load contract as `automation`).
- Glob semantics: `docs/PATH-MATCHING.md`, same `matchAny` machinery as
  `security_routed`. Attention patterns join the doctor's
  pattern-hygiene check (malformed pattern = fail), and the doctor
  report's informational section lists the declared categories.
- **Semantics:** in any unattended walk (a `/lanes-run` conveyor or a
  `/lanes-highway` run), a task whose Touch list matches an attention
  glob **parks on arrival**, with the category name in the park reason.
  Unlike `security_routed`, attention does NOT force KEEP routing and is
  NOT a gate refusal — the scope gate is unchanged. It is purely "this
  topic waits for me." At `manual` and `verdicts`, attention has no
  effect.
- Determinism: the validator gains an `attention --spec <path>`
  subcommand that prints the matching categories (JSON:
  `{ "matches": { "<category>": ["<touch path>", …] } }`, empty map when
  none). Conveyor and highway procedures call it per task instead of
  re-implementing glob matching in prose.

## 3. The stream map

`/lanes-highway <feature-brief>` first writes a stream map to the
config's `plans_dir` as `YYYY-MM-DD-<feature>-streams.md`. Per stream:

- **id** — kebab-case, unique; `integration` is reserved and refused.
- **mission** — one paragraph of what the stream builds.
- **territory** — the glob list of files this stream may touch.
  Territories must be pairwise disjoint; overlap means the decomposition
  is wrong and is reworked before the human ever sees the map. (Shared
  infrastructure a stream must edit belongs to exactly one stream, with
  other streams consuming it via declared interfaces.)
- **depends-on** — other stream ids, or none. Cross-stream coupling
  lives ONLY here; task-level `Depends on` inside a stream plan may
  reference tasks of that stream only.
- **interfaces** — what this stream exposes to / consumes from other
  streams, as real signatures where they exist.

The map also records the **base commit** (HEAD of the working branch at
run start) — every stream branch and the integration branch are cut from
it (dependent streams: Section 4 step 5).

**The gate:** the map is presented to the human for approval and the run
waits. This is the run's only human touch. Feedback reworks the map and
re-presents it.

## 4. The run

1. **Refuse or proceed.** Preconditions: `.lanes/config.json` loads
   clean with `automation.level` exactly `"highways"`; the feature brief
   exists (argument or file). Refuse naming the unmet one.
2. **Decompose + gate** per Section 3.
3. **Planner fan-out.** One frontier planner subagent per stream
   (`agents/lanes-stream-planner.md`), all dispatched in parallel. Input:
   the stream's map entry (mission, territory, depends-on, interfaces)
   and the lane-tagging rules of `skills/lanes/SKILL.md` Section B.
   Output: a normal lane-tagged plan with a Task/Lane Map, written to
   `plans_dir` as `YYYY-MM-DD-<feature>-<stream-id>.md`. Stream plans
   are NOT individually approved by the human.
4. **Plan check** (top-level session, before any execution): every
   task's Touch stays inside the stream's territory plus pipeline-owned
   paths; task `Depends on` references only tasks in the same stream;
   the Task/Lane Map is well-formed. A violating plan **parks its
   stream** — it never executes on a bad map. Lanes are re-validated
   against ROUTING.md at emit, as always.
5. **Execute.** Streams run concurrently, each on its own branch:
   - Stream setup: `worktree create --stream <id>` → worktree
     `.lanes/worktrees/stream-<id>`, branch `highway/<id>`, cut from the
     base commit — or, for a stream with `depends-on`, from
     `highway/integration` after ALL its dependencies have merged
     (step 6); until then the stream waits. A stream whose dependency
     parks, parks.
   - Within a stream: serial, dependency order, Roundabout verdict
     handling verbatim (`2026-07-25-roundabout-automation-design.md`
     §3–§4) with one substitution — task worktrees are based on the
     stream branch (`worktree create --spec <path> --base
     highway/<id>`), and APPROVE merges `lanes/<task-id>` into the
     STREAM branch inside the stream worktree.
   - KEEP tasks run inline in the stream worktree via the normal
     superpowers loop. (Honest concurrency note: DELEGATE implementers
     for different streams run concurrently as background agents; KEEP
     work is executed by the session itself and is therefore serial
     globally.)
   - Every review is a fresh `lanes-reviewer` subagent; implementer and
     reviewer audit the same task worktree, as always.
   - Attention-matched and security-routed tasks park on arrival.
6. **Integrate.** When a stream's graph completes (all tasks landed),
   its branch merges into `highway/integration` in stream-dependency
   order, inside the integration worktree (`worktree create --stream
   integration` at run start). A merge conflict → abort that merge, park
   the stream (branch intact), continue with streams not depending on
   it. A stream with parked tasks is **partial**: its landed work still
   merges (it never depended on the parked tasks — downstream of a park
   is never dispatched) and is marked partial in the review doc, but any
   stream depending on it parks — its promised interfaces may be
   incomplete.
7. **Integration review.** After the last merge, a fresh frontier
   reviewer subagent reviews the combined diff (base commit →
   `highway/integration`): cross-stream interfaces, duplicated work,
   seams, territory leaks. Findings go into the review doc by severity;
   REJECT-grade findings are marked blocking. Nothing is auto-fixed and
   nothing further merges.
8. **Output.** The run's entire product is the `highway/integration`
   branch plus the review doc (Section 5). The human's working branch is
   NEVER touched — no commits, no merges. Landing the branch
   (`git merge highway/integration`) is the human's one-command act
   after reading the review. Deliberate difference from `/lanes-run`:
   with the per-plan approval gate removed, the whole run stays
   containable in one branch the human can inspect, land, or discard
   whole.

## 5. The review doc

Written to `docs/superpowers/highways/YYYY-MM-DD-<feature>-run.md` in
the main tree and left uncommitted (the run never commits to the working
branch). Contents, in order:

- Stream map recap + the base commit + the gate record (when approved).
- Per stream: plan path; tasks landed (each with merge commit); tasks
  parked (each with reason and worktree path); FIX rounds used;
  implementer deviations.
- Integration: merge order; conflicts parked; integration-review
  findings by severity (blocking ones flagged); attention parks grouped
  by category.
- Landing instruction, and pointers to the pipeline ledger entries.

The bar: complete enough that the human can review the run without
replaying it.

## 6. Parks

Task-level (all Roundabout causes, plus one):

- reviewer REJECT · FIX rounds exhausted · implementer BLOCKED ·
  BACKEND_FAILURE · RATE_LIMITED after tier exhaustion ·
  security-routed arrival · **attention-category arrival**

Stream-level (new):

- territory/structure violation at plan check (step 4)
- dependency stream parked or partial (steps 5–6)
- merge conflict at integration (step 6)

A parked task's worktree and a parked stream's branch + worktrees stay
intact and inspectable; nothing is ever `--force` removed by the run.
Parked streams are not re-planned or re-dispatched unattended.

## 7. Safety floor — invariant, extended

Everything in Roundabout §5, plus:

- Attention-matched work never runs unattended.
- A highway run never commits to, merges into, or checks out the
  human's working branch; its writes are stream/integration branches,
  worktrees under `.lanes/worktrees/`, `plans_dir`/`tasks_dir`
  artifacts, and the uncommitted review doc.
- REJECT is always a human decision; the conveyor and the highway never
  push to a remote; scope gate, audit, worktree isolation, and
  immutable-spec amendments apply to every dispatch exactly as built.

## 8. Deliverables

- **`bin/lanes-validate.mjs`** — `"highways"` in the level enum;
  `routing.attention` schema (optional map, category → glob list) +
  `loadConfig` normalization to `{}`; `attention --spec <path>`
  subcommand; `worktree create --stream <id> --base <commit-or-branch>`
  and `worktree create --spec <path> --base <branch>` (+ matching
  `worktree remove --stream <id>`); doctor: attention patterns join
  pattern hygiene, report lists declared categories and the level.
- **`commands/lanes-highway.md`** — thin command: preconditions,
  Sections 3–5 procedure, hard rules (same pattern as
  `commands/lanes-run.md`).
- **`agents/lanes-stream-planner.md`** — the per-stream planner:
  consumes a stream-map entry, produces a lane-tagged plan at contract
  depth for DELEGATE tasks, never executes anything.
- **`commands/lanes-run.md`** — precondition accepts `"conveyor"` or
  `"highways"`; the walk parks attention-matched tasks on arrival
  (calling `attention --spec`).
- **`skills/lanes/SKILL.md`** — Section A ladder sentence names four
  rungs; Section C item 6 gains the `highways` rung and points at
  `/lanes-highway`.
- **`templates/config.example.json`** — `attention` example inside
  `routing` (level stays `"manual"`; the example never models turning
  automation on).
- **`templates/config.example.md`** — `attention` documented under
  `## routing`; `## automation` documents the fourth rung.
- **`whiteboard.md`** — move "v3: Highways" to Graduated with a link to
  this spec.
- **Tests** —
  - behavioral (`tests/validator.test.mjs`): `"highways"` accepted;
    absent `attention` normalized to `{}`; valid attention map accepted;
    refusals for non-object attention, non-array category, non-string
    glob; `attention --spec` prints matching categories and `{}` for no
    match; `worktree create --base` cuts the task branch from the named
    branch; doctor reports the level and categories.
  - structural (`tests/conformance.test.mjs`): `commands/lanes-highway.md`
    exists, names the stream-map gate, the park causes, and the
    never-touch-working-branch rule, and contains no `git push`;
    `agents/lanes-stream-planner.md` exists and forbids execution;
    `lanes-run.md` names both accepted levels; SKILL.md references
    `/lanes-highway`; both config templates document `attention`.

## 9. Out of scope (YAGNI)

- Parallel dispatch inside a single `/lanes-run` conveyor — the conveyor
  stays serial; parallelism lives in highway runs.
- Remote push automation; notifications/paging (the review doc is the
  surface).
- Earned/auto-revoking trust.
- Cross-repo streams.
- Unattended re-planning or retry of parked streams.
