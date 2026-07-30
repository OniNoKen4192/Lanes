---
description: >
  Run a Highways orchestration: decompose a feature into independent
  work streams, get ONE human approval (the stream map), then plan each
  stream with a frontier subagent and drive every stream's roundabout
  concurrently — landing everything on a highway/integration branch
  plus an after-run review document. Never touches the working branch.
  Requires `.lanes/config.json` to declare
  `automation.level: "highways"`.
argument-hint: <feature-brief-or-path>
---

# /lanes-highway <feature-brief> — parallel streams

Argument: the feature to build — inline prose or a path to a brief/spec
file. Behavior spec:
`docs/superpowers/specs/2026-07-25-highways-streams-design.md` §3–§7.
Like the roundabout, this command changes who turns the crank — never
what the machinery enforces: scope gate, audit, worktree isolation, and
immutable-spec amendments apply to every dispatch exactly as always.

## Preconditions (refuse, naming the unmet one)

1. `.lanes/config.json` loads clean and `automation.level` is exactly
   `"highways"`. At any lower level refuse — the declared trust level
   IS the authorization to run unattended; do not offer to proceed
   anyway.
2. The feature brief exists (argument prose, or a readable file when a
   path was given).

## Procedure

1. **Stream map.** Decompose the feature into independent streams and
   write the map to the config's `plans_dir` as
   `YYYY-MM-DD-<feature>-streams.md`. Per stream: a kebab-case unique
   **id** (`integration` is reserved — refuse a map that uses it); a
   one-paragraph **mission**; a **territory** (globs of the files the
   stream may touch — pairwise disjoint across streams; shared
   infrastructure belongs to exactly ONE stream, consumed by the others
   via declared interfaces); **depends-on** (stream ids, or none —
   cross-stream coupling lives ONLY here); **interfaces** (what the
   stream exposes/consumes, as real signatures where they exist).
   Record the **base commit** — the working branch's HEAD now.
2. **The gate.** Present the map and wait for explicit approval — the
   run's only human touch. Feedback reworks the map and re-presents it.
3. **Plan fan-out.** Dispatch one `lanes-stream-planner` subagent per
   stream, all in parallel, each given its map entry verbatim plus the
   plan output path (`plans_dir/YYYY-MM-DD-<feature>-<stream-id>.md`)
   and the base commit. Stream plans are NOT individually approved by
   the human — step 4 is their check.
4. **Plan check** (before any execution): every task's Touch stays
   inside its stream's territory plus pipeline-owned paths
   (`tasks_dir`, `plans_dir`, the ledger, `.lanes/`); task
   `Depends on` references only tasks of the same stream; the plan
   carries a well-formed Task/Lane Map. A violation parks the stream —
   it never executes on a bad map.
5. **Execute.** Create the integration worktree first:
   `node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" worktree create --stream integration --base <base-commit>`.
   Run streams concurrently, each set up with
   `… worktree create --stream <id> --base <base-commit>` — except a
   stream with depends-on, which is based on `highway/integration`
   AFTER all its dependencies have merged; until then it waits, and it
   parks if any dependency parks or lands partial. Within a stream,
   walk its Task/Lane Map serially in dependency order exactly as
   `/lanes-run` does — including its Declared failover section: a
   RATE_LIMITED task with `backend.failover_tiers` declared re-dispatches
   once to `lanes-claude-implementer` (mapped model, mandatory
   controller-side `audit --task` re-run; the task worktree is already
   cut from the stream branch) — with three substitutions:
   - **Attention check first.** Before dispatching any DELEGATE task, run
     `… attention --spec <spec-path>`; any matching category parks the task on
     arrival, category in the reason. A KEEP task whose Touch matches any `routing.attention` category
     (or `routing.security_routed`) parks the same way — attention-matched and
     security-routed work never runs unattended.
   - **Task worktrees cut from the stream branch:**
     `… worktree create --spec <spec-path> --base highway/<id>`; an
     APPROVE merges `lanes/<task-id>` into the STREAM branch inside the
     stream worktree, then `… worktree remove --task <task-id>`.
   - **KEEP tasks run inline in the stream worktree** via the normal
     superpowers loop. DELEGATE implementers for DIFFERENT streams may
     run concurrently as background agents; within one stream dispatch
     stays serial, and every review is a fresh `lanes-reviewer` given
     the spec, the implementer report, and the SAME task worktree.
6. **Integrate.** When a stream's graph completes, merge `highway/<id>`
   into `highway/integration` in stream-dependency order, inside the
   integration worktree. A merge conflict → abort that merge, park the
   stream (branch intact), continue with streams not depending on it.
   A stream with parked tasks is **partial**: its landed work still
   merges (nothing downstream of a park was ever dispatched), but
   streams depending on it park — its promised interfaces may be
   incomplete.
7. **Integration review.** After the last merge, dispatch a fresh
   frontier reviewer over the combined diff (base commit →
   `highway/integration`): cross-stream interfaces, duplicated work,
   seams, territory leaks. Findings go in the review doc by severity;
   REJECT-grade findings are marked blocking. Nothing is auto-fixed and
   nothing further merges.
8. **Review doc.** Write
   `docs/superpowers/highways/YYYY-MM-DD-<feature>-run.md` in the main
   tree and leave it uncommitted (the run never commits to the working
   branch). Contents, in order: stream map recap + base commit + gate
   record; per stream — plan path, tasks landed (each with its merge
   commit), tasks parked (each with reason and worktree path), FIX
   rounds used, deviations, failover-implemented tasks marked
   `implemented-by: claude/<model>` (with a run-level failover count
   in the recap); integration — merge order, conflicts
   parked, review findings by severity, attention parks grouped by
   category; the landing instruction
   (`git merge highway/integration`) and pointers to the pipeline
   ledger entries (append to the ledger per task as always). The bar:
   reviewable without replaying the run.

## Hard rules

- The human's working branch is never committed to, merged into, or checked
  out. The run's entire product is the `highway/integration` branch
  plus the review doc; landing it is the human's decision.
- Attention-matched and security-routed work never runs unattended —
  parked on arrival, every time.
- REJECT always stops that task for the human. Never re-dispatch past
  a REJECT.
- Never push to a remote.
- Never run below `automation.level: "highways"` — including "just
  this once" at the human's live prompting; the config declaration is
  the only authorization this command accepts.
- Parked tasks and streams keep their worktrees and branches intact —
  never remove parked work with `--force`; parked streams are never
  re-planned or re-dispatched unattended.
