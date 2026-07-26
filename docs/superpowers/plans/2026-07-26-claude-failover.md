# Claude Failover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the DELEGATE backend is fully rate-limited, a declared `backend.failover_tiers` config lets unattended runs re-dispatch the task once to a new `lanes-claude-implementer` agent (Claude writes the code itself) instead of parking.

**Architecture:** Three layers, one task each: (1) the config surface — schema field `backend.failover_tiers` (`"string[]?"`), loadConfig normalization to `[]`, doctor reporting, templates + conformance vocab lockstep; (2) the agent — `agents/lanes-claude-implementer.md`, same contract as `lanes-implementer` with the dispatch seam replaced by "implement it yourself"; (3) the controller flow — a Declared-failover section in `commands/lanes-run.md` (inherited by `commands/lanes-highway.md`), USER-GUIDE paragraph, conformance needles, whiteboard graduation. Spec: `docs/superpowers/specs/2026-07-26-claude-failover-design.md`.

**Tech Stack:** Node built-ins only. Tests: `node --test` (node:test + node:assert/strict). No dependencies.

## Global Constraints

- Run the suite as bare `node --test` from the repo root — NEVER `node --test tests/` (silently runs nothing on Windows).
- The validator stays fail-closed: any unexpected error is a refusal, never a pass.
- `schema_version` stays `1`. The example config keeps `automation.level: "manual"`.
- §5.5 lockstep: SCHEMA_V1, the conformance VOCAB, `templates/config.example.json`, and `templates/config.example.md` change together, in Task 1, in the same commit.
- Do NOT modify `agents/lanes-implementer.md`, `hooks/hooks.json`, or README's honesty note (spec §8).
- `failover_tiers` ordering is best→cheapest (same convention as `tiers`); mapping is index-for-index with clamp to the last entry (spec §2).
- Exact strings matter: every needle quoted in a conformance test step must appear verbatim in the target file.
- `git add` explicit paths only. NEVER stage `HelloWorld.txt` (untracked personal file at repo root) — no `git add -A`, no `git add .`.
- Every commit message ends with the trailer line: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Baseline before Task 1: 71 tests passing. After Task 1: 73. After Task 2: 74. After Task 3: 75.

---

### Task 1: Config surface — `backend.failover_tiers` (schema, normalization, doctor, templates, vocab lockstep)

**Files:**
- Modify: `bin/lanes-validate.mjs` (SCHEMA_V1 ~line 70; validateConfig type chain ~line 134; loadConfig normalization ~line 176; doctor output ~line 811; SCHEMA_VECTORS ~line 300)
- Modify: `templates/config.example.json` (backend block)
- Modify: `templates/config.example.md` (`## backend` section)
- Modify: `tests/conformance.test.mjs` (VOCAB, ~line 120)
- Test: `tests/validator.test.mjs` (two new doctor describes, appended at end of file)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: config key `backend.failover_tiers` — optional `string[]`, normalized by loadConfig to `[]` when absent, so every downstream consumer reads `config.backend.failover_tiers` without branching on absence. Doctor JSON gains top-level `failover_tiers` (array, or `null` when config failed to load). Error message for a bad value is exactly: `'backend.failover_tiers' must be an array of strings`.

- [ ] **Step 1: Add the two failing doctor tests**

Append to the END of `tests/validator.test.mjs`:

```js
describe("doctor: failover_tiers reported when declared", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => { c.backend.failover_tiers = ["opus", "sonnet", "haiku"]; } });
  after(() => fx.cleanup());

  test("doctor: failover_tiers reported when declared", () => {
    const r = validate(fx.dir, "doctor");
    assert.equal(r.status, 0);
    assert.deepEqual(r.json.failover_tiers, ["opus", "sonnet", "haiku"]);
  });
});

describe("doctor: failover_tiers normalized to [] when absent", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("doctor: failover_tiers normalized to [] when absent", () => {
    const r = validate(fx.dir, "doctor");
    assert.equal(r.status, 0);
    assert.deepEqual(r.json.failover_tiers, []);
  });
});
```

- [ ] **Step 2: Run the suite to verify they fail**

Run: `node --test` (repo root)
Expected: 2 failures — the first because doctor refuses the unknown key `backend.failover_tiers` (exit 2, so `r.status` is 2), the second because `r.json.failover_tiers` is `undefined`.

- [ ] **Step 3: Schema field.** In `bin/lanes-validate.mjs` SCHEMA_V1, change:

```js
    tiers: "string[]",
    ratelimit_signal: "string[]",
  },
```

to:

```js
    tiers: "string[]",
    ratelimit_signal: "string[]",
    failover_tiers: "string[]?",
  },
```

- [ ] **Step 4: Type branch.** In `validateConfig`'s type chain, change:

```js
      } else if (type === "string[]" && !isStringArray(v)) {
        errors.push(`'${block}.${key}' must be an array of strings`);
      } else if (type === "route_map"
```

to:

```js
      } else if (type === "string[]" && !isStringArray(v)) {
        errors.push(`'${block}.${key}' must be an array of strings`);
      } else if (type === "string[]?" && !isStringArray(v)) {
        errors.push(`'${block}.${key}' must be an array of strings`);
      } else if (type === "route_map"
```

- [ ] **Step 5: Normalization.** In `loadConfig`, change:

```js
  // Normalize (design specs 2026-07-25-roundabout-automation §2,
  // 2026-07-25-highways-streams §2.2): downstream consumers never branch
  // on absence — automation and routing.attention are always present.
  cfg.automation = {
    level: cfg.automation?.level ?? "manual",
    max_fix_rounds: cfg.automation?.max_fix_rounds ?? 2,
  };
  cfg.routing.attention = cfg.routing.attention ?? {};
  return cfg;
```

to:

```js
  // Normalize (design specs 2026-07-25-roundabout-automation §2,
  // 2026-07-25-highways-streams §2.2, 2026-07-26-claude-failover §2):
  // downstream consumers never branch on absence — automation,
  // routing.attention, and backend.failover_tiers are always present.
  cfg.automation = {
    level: cfg.automation?.level ?? "manual",
    max_fix_rounds: cfg.automation?.max_fix_rounds ?? 2,
  };
  cfg.routing.attention = cfg.routing.attention ?? {};
  cfg.backend.failover_tiers = cfg.backend.failover_tiers ?? [];
  return cfg;
```

- [ ] **Step 6: Doctor output.** In `runDoctor`'s final `console.log`, change:

```js
      automation: config ? config.automation : null,
      attention: config ? Object.keys(config.routing.attention) : null,
```

to:

```js
      automation: config ? config.automation : null,
      attention: config ? Object.keys(config.routing.attention) : null,
      failover_tiers: config ? config.backend.failover_tiers : null,
```

- [ ] **Step 7: Selftest vectors.** In SCHEMA_VECTORS, immediately after the `["empty tiers", ...]` entry, insert:

```js
  ["failover_tiers declared", (c) => { c.backend.failover_tiers = ["opus", "sonnet", "haiku"]; }, null],
  ["failover_tiers empty allowed", (c) => { c.backend.failover_tiers = []; }, null],
  ["failover_tiers wrong type", (c) => { c.backend.failover_tiers = "opus"; }, "array of strings"],
  ["failover_tiers non-string entry", (c) => { c.backend.failover_tiers = [1]; }, "array of strings"],
```

- [ ] **Step 8: Run the selftest**

Run: `node bin/lanes-validate.mjs selftest`
Expected: exit 0, stdout includes `selftest OK`.

- [ ] **Step 9: Example config.** In `templates/config.example.json`, change:

```json
    "ratelimit_signal": [
      "usage-cap",
      "429",
      "rate limit"
    ]
  },
```

to:

```json
    "ratelimit_signal": [
      "usage-cap",
      "429",
      "rate limit"
    ],
    "failover_tiers": [
      "opus",
      "sonnet",
      "haiku"
    ]
  },
```

- [ ] **Step 10: Field reference.** In `templates/config.example.md`, at the end of the `## backend` section (immediately after the `ratelimit_signal` bullet, before the `## routing` heading), add:

```markdown
- `failover_tiers` (array of strings, optional): declared Claude
  failover. Claude model aliases for the Agent tool's `model` parameter,
  best→cheapest like `tiers`. In an unattended run, a task whose
  dispatch exhausts every backend tier re-dispatches ONCE to
  `lanes-claude-implementer` at `failover_tiers[i]`, where `i` is the
  task tier's index in `tiers`, clamped to the last entry. Absent or
  `[]` means no failover — exhaustion parks the task, as always.
  Declaring this field IS the pre-authorization to spend Claude quota
  on DELEGATE-routed work; there is no per-run prompt. Aliases are not
  validated (they evolve with the platform); a bad alias fails the
  Agent dispatch and the task parks.
```

- [ ] **Step 11: Vocab lockstep.** In `tests/conformance.test.mjs`, in the `§5.5 config vocabulary sync` test's VOCAB, change:

```js
    backend: ["name", "dispatch_tool", "reply_tool", "approval_mode", "tiers", "ratelimit_signal"],
```

to:

```js
    backend: ["name", "dispatch_tool", "reply_tool", "approval_mode", "tiers", "ratelimit_signal", "failover_tiers"],
```

Do NOT add `failover_tiers` to the `legacyFields` list in check (d) — the field postdates the legacy config format; there is nothing to migrate.

- [ ] **Step 12: Run the full suite**

Run: `node --test` (repo root)
Expected: 73/73 pass (71 baseline + the 2 doctor tests from Step 1).

- [ ] **Step 13: Commit**

```bash
git add bin/lanes-validate.mjs templates/config.example.json templates/config.example.md tests/conformance.test.mjs tests/validator.test.mjs
git commit -m "feat: backend.failover_tiers config surface (schema, doctor, templates, vocab)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: The `lanes-claude-implementer` agent

**Files:**
- Create: `agents/lanes-claude-implementer.md`
- Test: `tests/conformance.test.mjs` (new test appended at end of file)

**Interfaces:**
- Consumes: config key `backend.failover_tiers` (Task 1) — mentioned in prose only; the agent itself never reads it (the controller already chose the model).
- Produces: the agent contract Task 3's commands reference by name: invoked with a spec file path + a worktree path; reports `STATUS: IMPLEMENTED | IMPLEMENTED_WITH_DEVIATIONS | BLOCKED` in the spec's Report Format. The conformance needles below are the frozen surface.

- [ ] **Step 1: Add the failing conformance test**

Append to the END of `tests/conformance.test.mjs`:

```js
// ------------------------------------------------ Claude failover (2026-07-26)

test("failover agent: lanes-claude-implementer contract", () => {
  const agent = read("agents/lanes-claude-implementer.md");
  assert.ok(agent.includes("name: lanes-claude-implementer"),
    "agent frontmatter should carry its name");
  assert.ok(!agent.includes("mcp__"),
    "the failover agent must not name any MCP tool — it has no external backend");
  for (const term of [
    "gate --spec",
    "audit --task",
    "Never run any git command that writes",
    "the controller owns git state",
    "STATUS: IMPLEMENTED | IMPLEMENTED_WITH_DEVIATIONS | BLOCKED",
  ]) {
    assert.ok(agent.includes(term), `lanes-claude-implementer.md should mention ${JSON.stringify(term)}`);
  }
  assert.ok(!agent.includes("BLOCKED | BACKEND_FAILURE"),
    "the failover agent must not enumerate the five-status taxonomy — only three statuses are reachable");
});
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `node --test` (repo root)
Expected: 1 failure — `read("agents/lanes-claude-implementer.md")` throws (file does not exist).

- [ ] **Step 3: Create the agent file**

Create `agents/lanes-claude-implementer.md` with exactly this content:

````markdown
---
name: lanes-claude-implementer
description: >
  Declared-failover implementer: writes the code for a single Lanes
  spec ITSELF when the DELEGATE backend is rate-limited and the project
  declares `backend.failover_tiers` (`.lanes/config.json`). Dispatched
  ONLY by a Lanes run controller (conveyor or highway walk) via the
  Agent tool with an explicit `model:` override — never first-line
  dispatch, never user-invoked, never for exploratory work,
  architectural decisions, or any task without a runnable acceptance
  test command. Input is a spec file path plus a worktree path.
tools: Read, Grep, Glob, Bash, Edit, Write
---

<!-- This agent is NOT the "second backend" the dispatch implementer's
SEAM block documents — that contract (SEAM block + four backend config
fields + tools line + hook matcher) is for a real external backend
replacing the shipped one. Failover is additive: it lives in the run
commands' Declared-failover step and this file; the dispatch
implementer does not change. Spec:
docs/superpowers/specs/2026-07-26-claude-failover-design.md §3. -->

You are the declared-failover implementer. Unlike the dispatch
implementer, you write the code yourself — there is no external
backend behind you, so there is nothing to dispatch to and nothing to
be rate-limited by. Everything else is the same contract: validate the
spec, implement it literally, verify with your own eyes, report in the
spec's Report Format. Nothing else.

# Input

You will be invoked with a path to a spec file AND a worktree path — a
per-task isolation workspace the controller created (checked out at
`.lanes/worktrees/<task-id>`, branch `lanes/<task-id>`). The worktree
is the working root for EVERYTHING: the Phase 1 gate, the acceptance
red-check, the implementation, and every verification command; the
spec path is worktree-relative. Config reads take `.lanes/config.json`
from the MAIN repo, not the worktree's snapshot copy. The baseline
record lands in the main repo's `.lanes/state/` — the validator
handles that placement itself; never write there. If you were invoked
without a spec file path, without a worktree path, or with prose
instead of a spec, report BLOCKED immediately — you do not accept
freehand tasks.

# Phase 1 — Validation Gate (before writing anything)

Read the spec and check, in order:

1. **Run the deterministic gate.** Execute (Bash, from inside the
   worktree):

       cd <worktree> && node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" gate --spec <spec-file-path>

   Exit 0 → proceed. Any other exit → report BLOCKED immediately with
   the gate's JSON `reason` as BLOCKED_REASON. Never second-guess a
   gate failure, never re-derive its checks by hand, and do not
   proceed to any other item.
2. **Acceptance test command exists and is runnable.** Actually run it
   (Bash). Expected outcome: it FAILS (red), because the task isn't
   done yet — or the spec's first Touch entry is creating the test. If
   the command errors for environmental reasons (missing dep, wrong
   path), that's BLOCKED, not an implementation problem.
3. **Touch list is non-empty** and every listed path's parent
   directory exists (Glob).
4. **Interfaces section present** if the spec's Meta lists any
   dependency or dependent tasks.
5. **Dependencies merged.** For each task ID in `Depends on`, confirm
   its spec file's status marker or check the plan doc. If
   unverifiable, say so in the report rather than guessing.

Any failure → report STATUS: BLOCKED with BLOCKED_REASON naming which
gate failed and what the planner must add. Do NOT attempt to repair
the spec yourself. A bad spec is the planner's bug; patching it here
hides the bug.

# Phase 2 — Implement (you are the backend)

Implement the spec literally, inside the worktree:

- Modify ONLY paths listed under **Touch**. Do not add features,
  options, refactors, or documentation beyond the spec.
- **Never run any git command that writes** — no commit, branch,
  checkout, merge, rebase, reset, stash, or tag. Every change stays
  uncommitted in the worktree; the controller owns git state.
- Follow the spec's Interfaces section exactly — names, parameter
  order, types, error contracts.
- If the spec is impossible to satisfy as written, stop and report
  BLOCKED with the contradiction as BLOCKED_REASON instead of
  improvising.

# Phase 3 — Verification (never trust your own memory of what you did)

After implementing, from inside the worktree:

1. Run the deterministic audit (Bash):

       node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" audit --task <task-id>

   Its JSON report is the changed-file evidence, covering all four
   surfaces — commits past the recorded baseline, staged, unstaged,
   and untracked. Do not build the list from `git status` yourself.
2. **Scope check** — read the report: every `out_of_scope` path, every
   `forbidden` path, and every entry in `commits_past_base` is a
   violation. `allowlisted` paths are pipeline-owned artifacts and are
   not violations. List every violation under DEVIATIONS.
3. Run the **Acceptance test command**. Capture output.
4. Run the **Regression guard** command — the project's
   `command_prefix` + `test` command (`.lanes/config.json`). Capture
   output.
5. Compare what you implemented against the **Interfaces** section
   one final time. Any mismatch is a deviation.

# Phase 4 — Report

Return exactly the spec's Report Format:

    STATUS: IMPLEMENTED | IMPLEMENTED_WITH_DEVIATIONS | BLOCKED
    FILES_CHANGED: <from the audit report (in_scope + out_of_scope + forbidden), one line each>
    TEST_OUTPUT: <last 20 lines of the acceptance command AS YOU RAN IT>
    DEVIATIONS: <scope violations, interface mismatches, anything done
      differently than specified — or "none">
    BLOCKED_REASON: <only if BLOCKED>

STATUS rules:

- **IMPLEMENTED** requires ALL of: acceptance passes, regression guard
  passes, the audit verdict is `clean`, and DEVIATIONS is "none".
  Failing tests are never IMPLEMENTED.
- **IMPLEMENTED_WITH_DEVIATIONS**: acceptance and regression pass, but
  deviations exist and every one is listed under DEVIATIONS for the
  reviewer to rule on. DEVIATIONS must be non-empty; if it would be
  "none", the status is IMPLEMENTED.
- **BLOCKED**: spec gap, environment failure, or the spec is
  unsatisfiable as written. Include the specifics.
- BACKEND_FAILURE and RATE_LIMITED do not exist for this agent — there
  is no external backend. Only the three statuses above are reachable.
- **Implementation done but acceptance failing**: you get ONE fix
  attempt, and only when the failure message clearly points at the
  implementation rather than the spec. If it still fails, report
  STATUS: BLOCKED with BLOCKED_REASON: "implementation complete,
  acceptance failing after one fix attempt" plus the full test output.
  Never loop on fix attempts.

The controller re-runs the audit itself on every report you send —
your report informs; it never substitutes for that evidence.

# Hard Rules

- Never touch a path outside the spec's Touch list, no matter how
  small or obviously beneficial the change seems.
- Never call any external backend or delegate the work further.
- Never report either IMPLEMENTED status with a failing acceptance or
  regression run.
- One task per invocation. If the spec smells like two tasks, that's a
  Phase 1 BLOCKED (planner must split it), not something you manage.
````

- [ ] **Step 4: Run the suite to verify it passes**

Run: `node --test` (repo root)
Expected: 74/74 pass.

- [ ] **Step 5: Commit**

```bash
git add agents/lanes-claude-implementer.md tests/conformance.test.mjs
git commit -m "feat: lanes-claude-implementer — declared-failover agent

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Controller failover step — conveyor, highways, guide, whiteboard

**Files:**
- Modify: `commands/lanes-run.md` (dispatch sentence, park list, new Declared-failover section, hard rule)
- Modify: `commands/lanes-highway.md` (step 5 lead-in, step 8 review-doc contents)
- Modify: `docs/USER-GUIDE.md` (conveyor section paragraph, RATE_LIMITED refusal bullet)
- Modify: `whiteboard.md` (graduate the idea)
- Test: `tests/conformance.test.mjs` (new test appended at end of file)

**Interfaces:**
- Consumes: `backend.failover_tiers` (Task 1); the `lanes-claude-implementer` agent name and three-status report (Task 2).
- Produces: user-facing behavior documentation only; no code interfaces.

- [ ] **Step 1: Add the failing conformance test**

Append to the END of `tests/conformance.test.mjs`:

```js
test("failover controller flow: commands, guide, templates agree", () => {
  const run = read("commands/lanes-run.md");
  const hwy = read("commands/lanes-highway.md");
  const guide = read("docs/USER-GUIDE.md");
  for (const [label, text] of [["lanes-run.md", run], ["lanes-highway.md", hwy], ["USER-GUIDE.md", guide]]) {
    assert.ok(text.includes("lanes-claude-implementer"), `${label} should name the failover agent`);
    assert.ok(text.includes("failover_tiers"), `${label} should name the config field`);
  }
  for (const term of [
    "audit --task",
    "implemented-by: claude/",
    "No third fallback",
    "No dry-state latch",
    "at the same model",
  ]) {
    assert.ok(run.includes(term), `lanes-run.md should mention ${JSON.stringify(term)}`);
  }
  assert.ok(hwy.includes("implemented-by: claude/"),
    "lanes-highway.md review doc should carry the provenance marker");
  const exampleMd = read("templates/config.example.md");
  assert.ok(exampleMd.includes("lanes-claude-implementer"),
    "config.example.md should say who implements under failover");
});
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `node --test` (repo root)
Expected: 1 failure — `lanes-run.md` does not yet mention `lanes-claude-implementer`.

- [ ] **Step 3: Conveyor — dispatch sentence.** In `commands/lanes-run.md`, change:

```markdown
     `node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" worktree create --spec <spec-path>`,
     dispatch `lanes-implementer` (spec + worktree path), then
     `lanes-reviewer` (spec + implementer report + the SAME worktree
     path), then act on the verdict:
```

to:

```markdown
     `node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" worktree create --spec <spec-path>`,
     dispatch `lanes-implementer` (spec + worktree path) — a
     RATE_LIMITED report with `backend.failover_tiers` declared
     non-empty takes the Declared failover section below instead of
     parking — then `lanes-reviewer` (spec + implementer report + the
     SAME worktree path), then act on the verdict:
```

- [ ] **Step 4: Conveyor — park list.** In `commands/lanes-run.md`, change:

```markdown
   RATE_LIMITED after tier fallback has exhausted every configured
   tier, security-routed arrival, or attention-category arrival. A parked task's worktree stays in
   place, inspectable — never `worktree remove --force` a parked task.
```

to:

```markdown
   RATE_LIMITED after tier fallback has exhausted every configured
   tier (and `backend.failover_tiers` is empty — otherwise the
   Declared failover section runs first, and only its failure parks),
   security-routed arrival, or attention-category arrival. A parked task's worktree stays in
   place, inspectable — never `worktree remove --force` a parked task.
```

- [ ] **Step 5: Conveyor — the Declared failover section.** In `commands/lanes-run.md`, insert between the end of the Procedure section (after the "**Run report.**" item) and the `## Hard rules` heading:

```markdown
## Declared failover (`backend.failover_tiers`)

When `lanes-implementer` reports RATE_LIMITED — every configured
backend tier exhausted — and the config's `backend.failover_tiers` is
non-empty, the task does not park. Spec:
`docs/superpowers/specs/2026-07-26-claude-failover-design.md` §4.

1. **Map the model.** Let `i` be the index of the spec's `Model hint`
   tier in `backend.tiers`; the failover model is
   `failover_tiers[min(i, failover_tiers.length - 1)]` — index for
   index, clamped to the last (cheapest) entry.
2. **Re-dispatch the SAME task** — same spec, same worktree — to
   `lanes-claude-implementer` via the Agent tool with `model:` set to
   the mapped alias. One re-dispatch, not a ladder walk: the failover
   list maps by tier; it is not a retry chain.
3. **Mandatory audit re-run.** On ANY report from
   `lanes-claude-implementer`, run
   `node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" audit --task <task-id>`
   yourself, from the main tree, BEFORE acting on the report. The
   audit's JSON — not the agent's claims — is the changed-file
   evidence handed to review. When they disagree: `out_of_scope`
   entries the report omitted → treat the task as
   IMPLEMENTED_WITH_DEVIATIONS with the audit's findings appended; any
   `forbidden` path or `commits_past_base` entry → park the task
   immediately, regardless of what the report claimed.
4. **Review as always.** `lanes-reviewer` gets the spec, the report,
   and the same worktree — a diff is a diff. A FIX round on a
   failover-implemented task re-dispatches to
   `lanes-claude-implementer` at the same model, not to the backend
   (the pool is presumed still dry for this task). The
   `automation.max_fix_rounds` cap applies unchanged.
5. **No third fallback.** If the Agent dispatch itself fails
   (Claude-side capacity or usage failure), park the task with the
   error as the reason.
6. **No dry-state latch.** Record nothing about backend health: the
   NEXT task dispatches to `lanes-implementer` (the backend path)
   exactly as always — if the cap has reset, work flows back to the
   backend by itself; if not, that task's RATE_LIMITED re-routes it
   too. A dry backend costs a few fast-failing calls per task; that is
   the price of having zero failover state to corrupt.
7. **Provenance.** Mark the task `implemented-by: claude/<model>` in
   its ledger entry and in the run report's landed/parked lists.
   Backend-implemented tasks carry no marker.
```

- [ ] **Step 6: Conveyor — hard rule.** In `commands/lanes-run.md`, in `## Hard rules`, change:

```markdown
- Never run at `automation.level` below `"conveyor"` — including "just
  this once" at the human's live prompting; the config declaration is
  the only authorization this command accepts.
```

to:

```markdown
- Never run at `automation.level` below `"conveyor"` — including "just
  this once" at the human's live prompting; the config declaration is
  the only authorization this command accepts.
- Failover never engages when `backend.failover_tiers` is absent or
  empty — parking is the default; the config declaration is the only
  authorization for spending Claude quota on DELEGATE-routed work.
```

- [ ] **Step 7: Highways — step 5 lead-in.** In `commands/lanes-highway.md`, change:

```markdown
   parks if any dependency parks or lands partial. Within a stream,
   walk its Task/Lane Map serially in dependency order exactly as
   `/lanes-run` does, with three substitutions:
```

to:

```markdown
   parks if any dependency parks or lands partial. Within a stream,
   walk its Task/Lane Map serially in dependency order exactly as
   `/lanes-run` does — including its Declared failover section: a
   RATE_LIMITED task with `backend.failover_tiers` declared re-dispatches
   once to `lanes-claude-implementer` (mapped model, mandatory
   controller-side `audit --task` re-run; the task worktree is already
   cut from the stream branch) — with three substitutions:
```

- [ ] **Step 8: Highways — review doc contents.** In `commands/lanes-highway.md`, change:

```markdown
   record; per stream — plan path, tasks landed (each with its merge
   commit), tasks parked (each with reason and worktree path), FIX
   rounds used, deviations; integration — merge order, conflicts
```

to:

```markdown
   record; per stream — plan path, tasks landed (each with its merge
   commit), tasks parked (each with reason and worktree path), FIX
   rounds used, deviations, failover-implemented tasks marked
   `implemented-by: claude/<model>` (with a run-level failover count
   in the recap); integration — merge order, conflicts
```

- [ ] **Step 9: Guide — conveyor paragraph.** In `docs/USER-GUIDE.md`, change:

```markdown
A task parks — and everything downstream of it leaves the conveyor
while the rest continues — on any of: reviewer REJECT, FIX rounds
exhausted, implementer BLOCKED, backend failure, rate limits after
every tier fell back, security-routed arrival, attention-category
arrival.
```

to:

```markdown
A task parks — and everything downstream of it leaves the conveyor
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
exhaustion parks, as always.
```

- [ ] **Step 10: Guide — refusal bullet.** In `docs/USER-GUIDE.md`, change:

```markdown
- **RATE_LIMITED.** The dispatcher falls back a tier automatically;
  when every configured tier is exhausted, the task parks rather than
  hammering the backend.
```

to:

```markdown
- **RATE_LIMITED.** The dispatcher falls back a tier automatically;
  when every configured tier is exhausted, the task parks rather than
  hammering the backend — unless `backend.failover_tiers` is declared,
  in which case it re-dispatches once to `lanes-claude-implementer`
  (see the conveyor section).
```

- [ ] **Step 11: Whiteboard graduation.** In `whiteboard.md`: delete the entire `### Backend exhaustion failover` entry (heading through its `- **Added:** 2026-07-25` line, inclusive). Under `## Graduated`, after the Highways line, add:

```markdown
- **Claude failover** → `docs/superpowers/specs/2026-07-26-claude-failover-design.md` (declared `backend.failover_tiers` + `lanes-claude-implementer` re-dispatch in unattended runs). Graduated 2026-07-26.
```

- [ ] **Step 12: Run the full suite**

Run: `node --test` (repo root)
Expected: 75/75 pass — including the pre-existing "user guide: load-bearing facts stay true" test (the guide edits are additive; every existing needle must still hold, and `git push` must still not appear in the guide).

- [ ] **Step 13: Commit**

```bash
git add commands/lanes-run.md commands/lanes-highway.md docs/USER-GUIDE.md whiteboard.md tests/conformance.test.mjs
git commit -m "feat: declared failover step in conveyor + highways; guide + whiteboard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
