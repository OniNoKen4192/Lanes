---
description: >
  Run the Roundabout conveyor: drive an approved, lane-tagged plan
  end-to-end unattended — emit, dispatch, review, act on verdicts,
  merge — parking anything that needs a human. Requires
  `.lanes/config.json` to declare `automation.level: "conveyor"`.
argument-hint: <path-to-approved-plan>
---

# /lanes-run <plan> — the conveyor

Argument: path to an approved plan carrying a Task/Lane Map. Behavior
spec: `docs/superpowers/specs/2026-07-25-roundabout-automation-design.md`
§3–§5. This command changes who turns the crank — never what the
machinery enforces: scope gate, audit, worktree isolation, and
immutable-spec amendments all apply to every dispatch exactly as always.

## Preconditions (refuse, naming the unmet one)

1. `.lanes/config.json` loads clean and `automation.level` is
   `"conveyor"` or `"highways"`. At `"manual"` or `"verdicts"` refuse —
   the declared trust level IS the authorization to run unattended; do
   not offer to proceed anyway.
2. The plan file exists and contains a Task/Lane Map table
   (`task | lane | tier | depends-on`).

## Procedure

1. **Emit if needed.** If any DELEGATE-routed task in the map lacks its
   spec file in the config's `tasks_dir`, run the `/lanes-emit`
   procedure for the plan first (it re-validates every lane against
   ROUTING.md, as always).
2. **Walk the Task/Lane Map in dependency order, serially** — never
   dispatch a task whose dependency has not landed:
   - **DELEGATE task** → first
     `node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" attention --spec <spec-path>`;
     any matching category parks the task on arrival, category in the
     reason — attention work never runs unattended. Otherwise the full
     existing cycle:
     `node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" worktree create --spec <spec-path>`,
     dispatch `lanes-implementer` (spec + worktree path), then
     `lanes-reviewer` (spec + implementer report + the SAME worktree
     path), then act on the verdict:
     - **APPROVE** → commit the work inside the worktree, merge
       `lanes/<task-id>` into the working branch, `worktree remove
       --task <task-id>`, record the merge commit for the run report.
     - **FIX** → apply the delta spec, re-dispatch implementer and
       reviewer, up to `automation.max_fix_rounds` rounds total; when
       the cap is reached, park the task.
     - **REJECT** → park the task. A REJECT is always a human decision;
       no automation level changes that.
   - **Ordinary KEEP task** → execute it inline yourself via the normal
     superpowers loop (implement, test, commit), exactly as in
     subagent-driven execution.
   - **Security-routed KEEP task** (its Touch matches
     `routing.security_routed`) → park it immediately. Security-routed
     work never runs unattended.
3. **Park, never halt.** A parked task — and every task downstream of
   it — leaves the conveyor; the walk continues with every task that
   does not depend on it. Park on: reviewer REJECT, FIX rounds
   exhausted, implementer BLOCKED, implementer BACKEND_FAILURE,
   RATE_LIMITED after tier fallback has exhausted every configured
   tier, security-routed arrival, or attention-category arrival. A parked task's worktree stays in
   place, inspectable — never `worktree remove --force` a parked task.
4. **Run report.** The run ends when nothing dispatchable remains.
   Report two lists: tasks landed (each with its merge commit) and
   tasks parked (each with its reason and, where one exists, its
   worktree path). Append to the pipeline ledger per task as always.

## Hard rules

- Security-routed and attention-matched work never runs unattended —
  parked on arrival, every time.
- REJECT always stops that task for the human. Never re-dispatch past
  a REJECT.
- Never push to a remote. Merges stay local; publishing is the human's
  decision.
- Never run at `automation.level` below `"conveyor"` — including "just
  this once" at the human's live prompting; the config declaration is
  the only authorization this command accepts.
