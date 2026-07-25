# Roundabout Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the declared-trust automation ladder (`automation` config block, `manual | verdicts | conveyor`) and the `/lanes-run` conveyor command, per docs/superpowers/specs/2026-07-25-roundabout-automation-design.md.

**Architecture:** The machine-checkable surface (schema validation, normalization, doctor reporting) goes into `bin/lanes-validate.mjs` with selftest vectors and behavioral tests; the conveyor procedure is prose in a new thin command `commands/lanes-run.md`; SKILL.md and the config templates document the ladder. No agent files change — the per-task enforcement machinery is untouched.

**Tech Stack:** Node ≥ 20 ESM, zero dependencies, `node --test` conformance suite.

## Global Constraints

- Zero runtime dependencies; tests run with bare `node --test` from the repo root (never `node --test tests/` — it breaks on Windows Node 22).
- Validation is strict and fail-closed: unknown keys, wrong types, bad enum values are refusals with messages naming the offending key (spec §2).
- `schema_version` stays `1`; the `automation` block is OPTIONAL; block absent ⇒ behavior identical to today (spec §2).
- After validation, `loadConfig` always returns `config.automation` filled in — defaults `level: "manual"`, `max_fix_rounds: 2` (spec §2).
- Safety floor wording must appear in every prose surface that describes automation: security-routed work never runs unattended; REJECT is always human; never push to a remote (spec §5).
- The legacy `.lanes/config.md` may be mentioned ONLY in commands/lanes-doctor.md, bin/lanes-validate.mjs, templates/config.example.md — do not add mentions elsewhere.
- Tests read repo files via `read()` from tests/helpers.mjs (it normalizes CRLF for Windows checkouts); behavioral tests spawn the validator via `validate()` — never import bin/lanes-validate.mjs.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Validator — `automation` schema block + normalization

**Files:**
- Modify: `bin/lanes-validate.mjs` (SCHEMA_V1 table ~line 62, OPTIONAL_BLOCKS ~line 87, validateConfig field loop ~lines 117-130, post-structure rules ~lines 133-141, loadConfig ~line 162, SCHEMA_VECTORS ~line 253)
- Test: `tests/validator.test.mjs` (append)

**Interfaces:**
- Consumes: existing `validateConfig(cfg)`, `loadConfig(rootDir)`, `SCHEMA_VECTORS` selftest table.
- Produces: `loadConfig()` return value always carries `automation: { level: "manual"|"verdicts"|"conveyor", max_fix_rounds: number }` (Task 2 relies on this). Field type string `"posint?"` meaning optional-integer-≥-1.

- [ ] **Step 1: Write the failing behavioral tests**

(Coverage mapping, per the design spec §6: acceptance of each level and the `max_fix_rounds` refusals are pinned by the Step 4 selftest vectors — which the suite executes via the existing "selftest passes" test — while the three spawned tests below pin the end-to-end CLI behavior. Together they cover the spec's behavioral list.)

Append to `tests/validator.test.mjs`:

```js
describe("gate: valid automation block accepted", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.automation = { level: "conveyor", max_fix_rounds: 3 };
  } });
  after(() => fx.cleanup());

  test("gate: valid automation block accepted", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(r.status, 0);
    assert.equal(r.json.ok, true);
  });
});

describe("gate: bad automation level refused", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.automation = { level: "yolo" };
  } });
  after(() => fx.cleanup());

  test("gate: bad automation level refused", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.notEqual(r.status, 0);
    assert.ok((r.stdout + r.stderr).includes("automation.level"),
      `expected an automation.level error, got: ${r.stdout} ${r.stderr}`);
  });
});

describe("gate: unknown automation key refused", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.automation = { level: "manual", turbo: true };
  } });
  after(() => fx.cleanup());

  test("gate: unknown automation key refused", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.notEqual(r.status, 0);
    assert.ok((r.stdout + r.stderr).includes("automation.turbo"),
      `expected an unknown-key error naming automation.turbo, got: ${r.stdout} ${r.stderr}`);
  });
});
```

(`describe`, `after`, `test`, `assert`, `makeFixtureRepo`, `validate` are already imported at the top of the file.)

- [ ] **Step 2: Run to verify the new tests fail**

Run from the repo root: `node --test`
Expected: the three new tests FAIL (`automation` is currently an unknown key, so the "accepted" test refuses and the two "refused" tests fail on the wrong error text). All pre-existing tests still pass.

- [ ] **Step 3: Implement the schema change**

In `bin/lanes-validate.mjs`:

3a. Add to `SCHEMA_V1` (after the `pipeline` entry):

```js
  automation: { level: "string", max_fix_rounds: "posint?" },
```

3b. Change `OPTIONAL_BLOCKS` to:

```js
const OPTIONAL_BLOCKS = new Set(["review_suite", "automation"]);
```

3c. In the field loop inside `validateConfig`, make `?`-suffixed types optional and add the `posint?` check. Replace:

```js
      if (v === undefined) {
        errors.push(`required field '${block}.${key}' is missing`);
      } else if (type === "string" && typeof v !== "string") {
```

with:

```js
      if (v === undefined) {
        if (!type.endsWith("?")) errors.push(`required field '${block}.${key}' is missing`);
      } else if (type === "posint?" && !(Number.isInteger(v) && v >= 1)) {
        errors.push(`'${block}.${key}' must be an integer >= 1`);
      } else if (type === "string" && typeof v !== "string") {
```

3d. Add the enum rule with the other post-structure rules, immediately after the `approval_mode` check:

```js
  if (cfg.automation && !["manual", "verdicts", "conveyor"].includes(cfg.automation.level)) {
    errors.push(`'automation.level' must be "manual", "verdicts", or "conveyor", got ${JSON.stringify(cfg.automation.level)}`);
  }
```

3e. In `loadConfig`, replace the final `return cfg;` with:

```js
  // Normalize (design spec 2026-07-25-roundabout-automation §2): downstream
  // consumers never branch on absence — automation is always present.
  cfg.automation = {
    level: cfg.automation?.level ?? "manual",
    max_fix_rounds: cfg.automation?.max_fix_rounds ?? 2,
  };
  return cfg;
```

- [ ] **Step 4: Add selftest vectors**

Append to `SCHEMA_VECTORS` (before the closing `];`):

```js
  ["automation manual", (c) => { c.automation = { level: "manual" }; }, null],
  ["automation verdicts", (c) => { c.automation = { level: "verdicts" }; }, null],
  ["automation conveyor with cap", (c) => { c.automation = { level: "conveyor", max_fix_rounds: 3 }; }, null],
  ["automation absent is valid", (c) => { delete c.automation; }, null],
  ["automation bad level", (c) => { c.automation = { level: "yolo" }; }, "automation.level"],
  ["automation missing level", (c) => { c.automation = { max_fix_rounds: 2 }; }, "required field 'automation.level'"],
  ["automation unknown key", (c) => { c.automation = { level: "manual", turbo: true }; }, "unknown key 'automation.turbo'"],
  ["automation zero cap", (c) => { c.automation = { level: "conveyor", max_fix_rounds: 0 }; }, "integer >= 1"],
  ["automation string cap", (c) => { c.automation = { level: "conveyor", max_fix_rounds: "2" }; }, "integer >= 1"],
```

(`VALID_CONFIG` has no `automation` key, so "automation absent is valid" duplicates "valid config" — keep it anyway; it pins the optionality rule against future edits to `VALID_CONFIG`.)

- [ ] **Step 5: Run selftest and the full suite**

Run from the repo root: `node bin/lanes-validate.mjs selftest` — expected: `selftest OK` with the schema-vector count grown by 9, exit 0.
Run: `node --test` — expected: ALL tests pass, including the three from Step 1.

- [ ] **Step 6: Commit**

```bash
git add bin/lanes-validate.mjs tests/validator.test.mjs
git commit -m "feat: automation block in config schema v1 (declared-trust ladder)"
```

---

### Task 2: Doctor reports the declared automation level

**Files:**
- Modify: `bin/lanes-validate.mjs` (`runDoctor` final report, ~line 732)
- Modify: `commands/lanes-doctor.md` (Step 1 rendering paragraph)
- Test: `tests/validator.test.mjs` (append)

**Interfaces:**
- Consumes: `loadConfig()` normalization from Task 1 (`config.automation` always present after a clean load).
- Produces: doctor JSON gains a top-level `automation` field: `{ level, max_fix_rounds }` when the config loaded, `null` when it didn't. It is informational — never a check, never affects `verdict` or the exit code.

- [ ] **Step 1: Write the failing behavioral tests**

Append to `tests/validator.test.mjs`:

```js
describe("doctor: reports declared automation level", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.automation = { level: "conveyor" };
  } });
  after(() => fx.cleanup());

  test("doctor: reports declared automation level", () => {
    const r = validate(fx.dir, "doctor");
    assert.equal(r.json.automation.level, "conveyor");
    assert.equal(r.json.automation.max_fix_rounds, 2);
  });
});

describe("doctor: absent automation block reports manual", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("doctor: absent automation block reports manual", () => {
    const r = validate(fx.dir, "doctor");
    assert.equal(r.json.automation.level, "manual");
    assert.equal(r.json.automation.max_fix_rounds, 2);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test`
Expected: both new tests FAIL (`r.json.automation` is undefined). Everything else passes.

- [ ] **Step 3: Implement**

In `runDoctor`, replace the final report line:

```js
  console.log(JSON.stringify({ verdict: failed ? "not_safe" : "ok", checks }, null, 2));
```

with:

```js
  // Informational only (design spec 2026-07-25-roundabout-automation §6):
  // the declared trust level is reported, never judged — not a check.
  console.log(JSON.stringify(
    { verdict: failed ? "not_safe" : "ok", automation: config ? config.automation : null, checks },
    null, 2));
```

- [ ] **Step 4: Update the doctor command prose**

In `commands/lanes-doctor.md`, at the end of the Step 1 paragraph (after "…the subcommand's output is the authority (matching semantics: `${CLAUDE_PLUGIN_ROOT}/docs/PATH-MATCHING.md`)."), append this sentence to the paragraph:

```
Also render the report's top-level `automation` field as one
informational line — the declared trust level and fix cap (defaults
`manual` / `2` when the config has no `automation` block). It is
information, not a check: it never affects the verdict.
```

- [ ] **Step 5: Run selftest and the full suite**

Run: `node bin/lanes-validate.mjs selftest` — expected `selftest OK`, exit 0.
Run: `node --test` — expected ALL tests pass.

- [ ] **Step 6: Commit**

```bash
git add bin/lanes-validate.mjs commands/lanes-doctor.md tests/validator.test.mjs
git commit -m "feat: doctor reports declared automation level (informational)"
```

---

### Task 3: `/lanes-run` conveyor command

**Files:**
- Create: `commands/lanes-run.md`
- Test: `tests/conformance.test.mjs` (append)

**Interfaces:**
- Consumes: the normalized `automation` config (Task 1), the existing worktree lifecycle (`worktree create --spec` / `worktree remove --task`), the implementer's five statuses, the reviewer's three verdicts.
- Produces: the command file other docs reference as `/lanes-run` (Task 4 links to it from SKILL.md).

- [ ] **Step 1: Write the failing structural test**

Append to `tests/conformance.test.mjs`:

```js
// ------------------------------------------------- Roundabout (2026-07-25)

test("roundabout: /lanes-run command structure", () => {
  const cmd = read("commands/lanes-run.md");
  assert.ok(cmd.startsWith("---\n"), "lanes-run.md should start with a frontmatter fence");
  for (const term of [
    "conveyor", "max_fix_rounds", "REJECT", "BLOCKED", "BACKEND_FAILURE",
    "RATE_LIMITED", "security-routed", "park", "worktree create", "Task/Lane Map",
  ]) {
    assert.ok(cmd.includes(term), `lanes-run.md should mention ${JSON.stringify(term)}`);
  }
  assert.ok(!cmd.includes("git push"), "the conveyor must never push to a remote");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test`
Expected: the new test FAILS (`commands/lanes-run.md` does not exist). Note: the pre-existing "§5.3 frontmatter" test will ALSO start covering `commands/lanes-run.md` automatically once the file exists — that is intended.

- [ ] **Step 3: Create the command file**

Create `commands/lanes-run.md` with exactly this content:

````markdown
---
description: >
  Run the Roundabout conveyor: drive an approved, lane-tagged plan
  end-to-end unattended — emit, dispatch, review, act on verdicts,
  merge — parking anything that needs a human. Requires
  `.lanes/config.json` to declare `automation.level: "conveyor"`.
---

# /lanes-run <plan> — the conveyor

Argument: path to an approved plan carrying a Task/Lane Map. Behavior
spec: `docs/superpowers/specs/2026-07-25-roundabout-automation-design.md`
§3–§5. This command changes who turns the crank — never what the
machinery enforces: scope gate, audit, worktree isolation, and
immutable-spec amendments all apply to every dispatch exactly as always.

## Preconditions (refuse, naming the unmet one)

1. `.lanes/config.json` loads clean and `automation.level` is exactly
   `"conveyor"`. At `"manual"` or `"verdicts"` refuse — the declared
   trust level IS the authorization to run unattended; do not offer to
   proceed anyway.
2. The plan file exists and contains a Task/Lane Map table
   (`task | lane | tier | depends-on`).

## Procedure

1. **Emit if needed.** If any DELEGATE-routed task in the map lacks its
   spec file in the config's `tasks_dir`, run the `/lanes-emit`
   procedure for the plan first (it re-validates every lane against
   ROUTING.md, as always).
2. **Walk the Task/Lane Map in dependency order, serially** — never
   dispatch a task whose dependency has not landed:
   - **DELEGATE task** → the full existing cycle:
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
   tier, or security-routed arrival. A parked task's worktree stays in
   place, inspectable — never `worktree remove --force` a parked task.
4. **Run report.** The run ends when nothing dispatchable remains.
   Report two lists: tasks landed (each with its merge commit) and
   tasks parked (each with its reason and, where one exists, its
   worktree path). Append to the pipeline ledger per task as always.

## Hard rules

- Security-routed work never runs unattended — parked on arrival,
  every time.
- REJECT always stops that task for the human. Never re-dispatch past
  a REJECT.
- Never push to a remote. Merges stay local; publishing is the human's
  decision.
- Never run at `automation.level` below `"conveyor"` — including "just
  this once" at the human's live prompting; the config declaration is
  the only authorization this command accepts.
````

- [ ] **Step 4: Run to verify it passes**

Run: `node --test`
Expected: ALL tests pass, including the new structural test and the frontmatter sweep now covering `lanes-run.md`.

- [ ] **Step 5: Commit**

```bash
git add commands/lanes-run.md tests/conformance.test.mjs
git commit -m "feat: /lanes-run conveyor command (Roundabout)"
```

---

### Task 4: Documentation — SKILL.md, config templates, whiteboard graduation

**Files:**
- Modify: `skills/lanes/SKILL.md` (Sections A and C)
- Modify: `templates/config.example.json` (add `automation` block)
- Modify: `templates/config.example.md` (add `## automation` section)
- Modify: `whiteboard.md` (graduate the Roundabout entry)
- Test: `tests/conformance.test.mjs` (append)

**Interfaces:**
- Consumes: `commands/lanes-run.md` from Task 3 (referenced as `/lanes-run`); the `automation` schema from Task 1.
- Produces: nothing downstream — this is the final task.

- [ ] **Step 1: Write the failing structural tests**

Append to `tests/conformance.test.mjs`:

```js
test("roundabout: SKILL.md references the automation ladder", () => {
  const skill = read("skills/lanes/SKILL.md");
  assert.ok(skill.includes("/lanes-run"), "SKILL.md should reference /lanes-run");
  assert.ok(skill.includes("automation.level"), "SKILL.md should reference automation.level");
});

test("roundabout: config examples document automation", () => {
  const json = JSON.parse(read("templates/config.example.json"));
  assert.equal(json.automation.level, "manual",
    "the example must not model turning automation on by default");
  assert.equal(json.automation.max_fix_rounds, 2);
  const md = read("templates/config.example.md");
  assert.ok(md.includes("## `automation`"), "config.example.md should have an automation section");
  for (const term of ["manual", "verdicts", "conveyor", "max_fix_rounds"]) {
    assert.ok(md.includes(term), `config.example.md should document ${JSON.stringify(term)}`);
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test`
Expected: both new tests FAIL. Everything else passes.

- [ ] **Step 3: Update `templates/config.example.json`**

Add between the `review_suite` block and the `pipeline` block (keeping 2-space indentation and the existing key order style):

```json
  "automation": {
    "level": "manual",
    "max_fix_rounds": 2
  },
```

- [ ] **Step 4: Update `templates/config.example.md`**

Insert this section between the `## review_suite` section and the `## pipeline` section:

```markdown
## `automation`  (optional — omit for today's fully-manual behavior)

The Roundabout trust ladder: how much of the pipeline runs unattended.
Trust is DECLARED — you flip this when you judge the project ready; the
ledger history is evidence you consult, not a mechanism.

- `level` (string): exactly one of
  - `"manual"` — every stage change is a human handoff (the default;
    an absent block means exactly this).
  - `"verdicts"` — you still emit and dispatch each spec; reviewer
    verdicts are acted on unattended (APPROVE → merge + clean up,
    FIX → re-dispatch up to the cap). REJECT always stops for you.
  - `"conveyor"` — `/lanes-run <plan>` drives the whole task graph
    end-to-end; see that command for park semantics.
- `max_fix_rounds` (integer ≥ 1, optional, default `2`): how many FIX
  rounds a task gets before it parks as needs-human.

The safety floor holds at every level: security-routed work never runs
unattended, REJECT is always a human decision, and nothing is ever
pushed to a remote.
```

- [ ] **Step 5: Update `skills/lanes/SKILL.md`**

5a. In Section A, after the sentence "**KEEP tasks never leave the superpowers inner loop.** …path." append a new short paragraph:

```markdown
When the project's `.lanes/config.json` declares an `automation.level`
above `"manual"`, the handoffs between these stages run unattended per
the Roundabout trust ladder — see Section C item 6 and `/lanes-run`.
```

5b. In Section C, append a new numbered item after item 5:

```markdown
6. **Automation (Roundabout).** All of the above assumes
   `automation.level: "manual"` (or no `automation` block) — every
   handoff is yours. At `"verdicts"`, handle reviewer verdicts
   unattended: APPROVE → commit in the worktree, merge, remove; FIX →
   apply the delta spec and re-dispatch, up to
   `automation.max_fix_rounds` rounds, then park for the human; REJECT
   → always stop for the human. At `"conveyor"`, run
   `/lanes-run <plan>` instead of stepping through items 1–5 manually —
   it drives the whole Task/Lane Map and parks anything needing a
   human. At every level: security-routed work never runs unattended,
   and nothing is ever pushed to a remote.
```

- [ ] **Step 6: Graduate the whiteboard entry**

In `whiteboard.md`:
- Delete the entire `### v2: Roundabout` entry (lines from `### v2: Roundabout` through its `- **Added:** 2026-07-24` line inclusive).
- In the `### v3: Highways` entry, change the line
  `  - Depends on Roundabout — parallel streams stop being a win if each one still needs a human at every handoff.`
  to
  `  - Depends on Roundabout (graduated 2026-07-25) — parallel streams stop being a win if each one still needs a human at every handoff.`
- Under `## Graduated`, below the explanatory line `Ideas that moved on to real planning (link to where they went).`, add:

```markdown
- **Roundabout (v2)** → `docs/superpowers/specs/2026-07-25-roundabout-automation-design.md` (declared-trust automation ladder + `/lanes-run`). Graduated 2026-07-25.
```

- [ ] **Step 7: Run the full suite**

Run: `node --test` — expected ALL tests pass.
Run: `node bin/lanes-validate.mjs selftest` — expected `selftest OK`, exit 0 (guards against the example-config edit breaking anything that reads it).

- [ ] **Step 8: Commit**

```bash
git add skills/lanes/SKILL.md templates/config.example.json templates/config.example.md whiteboard.md tests/conformance.test.mjs
git commit -m "docs: automation ladder in skill + config templates; graduate Roundabout"
```
