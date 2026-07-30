# /lanes-config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One slash command (`/lanes-config`) that reads and sets the five operational knobs in `.lanes/config.json` via a new deterministic `config get`/`config set` subcommand in the validator, plus the trust-level rename `conveyor` → `roundabout` across every live surface.

**Architecture:** `bin/lanes-validate.mjs` gains a `config` subcommand — the ONLY write path for the knobs; it validates the mutated config with the existing `validateConfig` before writing, fail-closed. `commands/lanes-config.md` is a thin wrapper that renders the subcommand's JSON. The rename lands first so the new subcommand is born speaking `roundabout`.

**Tech Stack:** Node ≥ 18 built-ins only (the validator is dependency-free), `node --test` conformance suite, markdown command/agent prompts.

**Spec:** `docs/superpowers/specs/2026-07-29-lanes-config-design.md` (approved). Read it before starting.

## Global Constraints

- Zero dependencies; no `package.json` at repo root. Tests run with `node --test` from the repo root.
- `node bin/lanes-validate.mjs selftest` AND `node --test` must both be green at every task's commit.
- Never edit anything under `docs/superpowers/specs/` or `docs/superpowers/plans/` (historical records), `whiteboard.md`, or `docs/RELEASING.md` — their `conveyor`/`Roundabout` mentions stay.
- Do not bump `.claude-plugin/plugin.json` version — that happens at release time per `docs/RELEASING.md`.
- The trust ladder is `manual | verdicts | roundabout | highways`. The ladder's nickname is "the trust ladder" — never "the Roundabout trust ladder" (collides with the level name).
- All knob writes go through `config set`. No other code path writes `.lanes/config.json` except `/lanes-init` drafting and the `/lanes-doctor` migration (both pre-existing, untouched).

---

### Task 1: Rename the trust level `conveyor` → `roundabout`

**Files:**
- Modify: `bin/lanes-validate.mjs` (lines 150-151 enum, 319/324/325 selftest vectors, 644 comment)
- Modify: `tests/validator.test.mjs` (lines 354, 395, 401)
- Modify: `tests/conformance.test.mjs` (lines 401, 406, 422, 458, 488; one new test)
- Modify: `commands/lanes-run.md`, `commands/lanes-highway.md`, `agents/lanes-stream-planner.md`, `agents/lanes-claude-implementer.md`, `skills/lanes/SKILL.md`, `templates/config.example.md`, `README.md`, `docs/USER-GUIDE.md`

**Interfaces:**
- Produces: `validateConfig` accepts `automation.level: "roundabout"`, refuses `"conveyor"` with an error containing `renamed to "roundabout"`. Tasks 2-4 assume the level vocabulary is `manual|verdicts|roundabout|highways`.

- [ ] **Step 1: Update test expectations (failing first)**

In `tests/validator.test.mjs`:
- Line 354 (`gate: valid automation block accepted` fixture): `c.automation = { level: "conveyor", max_fix_rounds: 3 };` → `c.automation = { level: "roundabout", max_fix_rounds: 3 };`
- Line 395 (`doctor: reports declared automation level` fixture): `c.automation = { level: "conveyor" };` → `c.automation = { level: "roundabout" };`
- Line 401: `assert.equal(r.json.automation.level, "conveyor");` → `assert.equal(r.json.automation.level, "roundabout");`

Add a new describe block directly after the `gate: bad automation level refused` block (ends near line 378):

```js
describe("gate: legacy conveyor level names the rename", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.automation = { level: "conveyor" };
  } });
  after(() => fx.cleanup());

  test("gate: legacy conveyor level names the rename", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.notEqual(r.status, 0);
    assert.ok((r.stdout + r.stderr).includes('renamed to "roundabout"'),
      `expected the conveyor→roundabout rename hint, got: ${r.stdout} ${r.stderr}`);
  });
});
```

In `tests/conformance.test.mjs`:
- Line 401 needle list: `"conveyor",` → `"roundabout",`
- Line 406 message: `"the conveyor must never push to a remote"` → `"the roundabout walk must never push to a remote"`
- Line 422 term list: `["manual", "verdicts", "conveyor", "max_fix_rounds"]` → `["manual", "verdicts", "roundabout", "max_fix_rounds"]`
- Line 458: `assert.ok(cmd.includes('"conveyor"') && cmd.includes('"highways"'),` → `assert.ok(cmd.includes('"roundabout"') && cmd.includes('"highways"'),`
- Line 488: `` assert.ok(guide.includes("`manual → verdicts → conveyor → highways`"), `` → `` assert.ok(guide.includes("`manual → verdicts → roundabout → highways`"), ``

Add a sweep-completeness needle after the `roundabout: config examples document automation` test (ends near line 425):

```js
test("rename: no live surface still says 'conveyor'", () => {
  // Historical records (docs/superpowers/**, whiteboard.md, RELEASING.md)
  // and this test file keep their mentions; every operative surface must not.
  const offenders = [];
  const scan = (rel) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true })) {
      const relPath = `${rel}/${entry.name}`;
      if (entry.isDirectory()) scan(relPath);
      else if (/conveyor/i.test(fs.readFileSync(path.join(repoRoot, relPath), "utf8"))) {
        offenders.push(relPath);
      }
    }
  };
  for (const dir of ["bin", "commands", "agents", "skills", "templates", "hooks"]) scan(dir);
  for (const file of ["README.md", "docs/USER-GUIDE.md"]) {
    if (/conveyor/i.test(read(file))) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `live surfaces still mention 'conveyor': ${offenders.join(", ")}`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run from repo root: `node --test`
Expected: FAIL — the new hint test, the sweep needle (listing ~9 files), and every edited expectation.

- [ ] **Step 3: Rename in the validator**

In `bin/lanes-validate.mjs`, replace lines 150-152:

```js
  if (cfg.automation && !["manual", "verdicts", "roundabout", "highways"].includes(cfg.automation.level)) {
    errors.push(cfg.automation.level === "conveyor"
      ? `'automation.level' "conveyor" was renamed to "roundabout" — edit .lanes/config.json and set automation.level to "roundabout"`
      : `'automation.level' must be "manual", "verdicts", "roundabout", or "highways", got ${JSON.stringify(cfg.automation.level)}`);
  }
```

In the `SCHEMA_VECTORS` selftest table:
- Line 319: `["automation conveyor with cap", (c) => { c.automation = { level: "conveyor", max_fix_rounds: 3 }; }, null],` → `["automation roundabout with cap", (c) => { c.automation = { level: "roundabout", max_fix_rounds: 3 }; }, null],`
- Line 324: `{ level: "conveyor", max_fix_rounds: 0 }` → `{ level: "roundabout", max_fix_rounds: 0 }`
- Line 325: `{ level: "conveyor", max_fix_rounds: "2" }` → `{ level: "roundabout", max_fix_rounds: "2" }`
- Add one vector directly after line 326 (`["automation highways", ...]`):

```js
  ["automation legacy conveyor names the rename", (c) => { c.automation = { level: "conveyor" }; }, 'renamed to "roundabout"'],
```

- Line 644 comment: `// without matches; the conveyor/highway procedures park a task on any` → `// without matches; the roundabout/highway procedures park a task on any`

- [ ] **Step 4: Sweep the live docs**

Exact replacements, one per line (all are single-occurrence on their line):

| File:line | Old fragment | New fragment |
|---|---|---|
| `README.md:112` | `` \| `conveyor` \| Approve the plan \| `` | `` \| `roundabout` \| Approve the plan \| `` |
| `docs/USER-GUIDE.md:48` | `` `manual → verdicts → conveyor → highways` `` | `` `manual → verdicts → roundabout → highways` `` |
| `docs/USER-GUIDE.md:152` | `` \| `conveyor` \| Approve the plan \| `` | `` \| `roundabout` \| Approve the plan \| `` |
| `docs/USER-GUIDE.md:153` | `concurrent conveyors` | `concurrent roundabouts` |
| `docs/USER-GUIDE.md:175` | `` refuses below `conveyor` `` | `` refuses below `roundabout` `` |
| `docs/USER-GUIDE.md:180` | `## The conveyor: \`/lanes-run <plan>\`` | `## The roundabout: \`/lanes-run <plan>\`` |
| `docs/USER-GUIDE.md:188` | `leaves the conveyor` | `leaves the roundabout` |
| `docs/USER-GUIDE.md:226` | `running the same conveyor cycle as` | `running the same roundabout cycle as` |
| `docs/USER-GUIDE.md:301` | `(see the conveyor section)` | `(see the roundabout section)` |
| `templates/config.example.md:104` | `` `conveyor` or above `` | `` `roundabout` or above `` |
| `templates/config.example.md:137` | `The Roundabout trust ladder:` | `The trust ladder:` |
| `templates/config.example.md:147` | `- \`"conveyor"\` — \`/lanes-run <plan>\` drives` | `- \`"roundabout"\` — \`/lanes-run <plan>\` drives` |
| `templates/config.example.md:153` | `Includes everything \`"conveyor"\` authorizes.` | `Includes everything \`"roundabout"\` authorizes.` |
| `commands/lanes-run.md:3` | `Run the Roundabout conveyor: drive` | `Run the roundabout: drive` |
| `commands/lanes-run.md:6` | `automation.level: "conveyor"` | `automation.level: "roundabout"` |
| `commands/lanes-run.md:10` | `# /lanes-run <plan> — the conveyor` | `# /lanes-run <plan> — the roundabout` |
| `commands/lanes-run.md:21` | `` `"conveyor"` or `"highways"` `` | `` `"roundabout"` or `"highways"` `` |
| `commands/lanes-run.md:63` | `leaves the conveyor` | `leaves the roundabout` |
| `commands/lanes-run.md:128` | `below \`"conveyor"\`` | `below \`"roundabout"\`` |
| `commands/lanes-highway.md:5` | `drive every stream's conveyor` | `drive every stream's roundabout` |
| `commands/lanes-highway.md:18` | `Like the conveyor, this command` | `Like the roundabout, this command` |
| `skills/lanes/SKILL.md:55` | `the Roundabout trust ladder` | `the trust ladder` |
| `skills/lanes/SKILL.md:120` | `**Automation (Roundabout).**` | `**Automation (trust ladder).**` |
| `skills/lanes/SKILL.md:126` | `At \`"conveyor"\`, run` | `At \`"roundabout"\`, run` |
| `skills/lanes/SKILL.md:131` | `the conveyor: stream decomposition` | `the roundabout: stream decomposition` |
| `agents/lanes-stream-planner.md:7` | `runs a conveyor` | `runs a roundabout` |
| `agents/lanes-claude-implementer.md:7` | `(conveyor or highway walk)` | `(roundabout or highway walk)` |

Line numbers are from the current commit — verify each with a grep for `conveyor`/`Roundabout` before editing; the fragment text is authoritative, not the line number. After the sweep, `grep -rni conveyor bin commands agents skills templates hooks README.md docs/USER-GUIDE.md` must return nothing.

- [ ] **Step 5: Run selftest and the full suite to verify they pass**

Run: `node bin/lanes-validate.mjs selftest` — expect `selftest OK`.
Run: `node --test` — expect 0 failures (84 tests: 82 prior + the hint test + the sweep needle).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: rename trust level conveyor -> roundabout (with migration hint)"
```

---

### Task 2: `config get` subcommand

**Files:**
- Modify: `bin/lanes-validate.mjs` (new section after `runSeedCheck`, ~line 996; CLI dispatch ~line 1022; usage string line 1028)
- Test: `tests/validator.test.mjs`

**Interfaces:**
- Consumes: `loadConfig()` (existing — returns the normalized config or throws), the `roundabout` vocabulary from Task 1.
- Produces: `node bin/lanes-validate.mjs config get` → stdout JSON `{ trust, fix_rounds, approval, tiers, failover }` (normalized values), exit 0. `KNOBS` array and `configError(reason)` helper (prints `{ ok:false, check:"config", reason }`, exits 1) — Task 3 uses both.

- [ ] **Step 1: Write the failing tests**

In `tests/validator.test.mjs`, after the `doctor: absent automation block reports manual` describe block:

```js
describe("config get: normalized defaults on a minimal config", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("config get: normalized defaults on a minimal config", () => {
    const r = validate(fx.dir, "config", "get");
    assert.equal(r.status, 0);
    assert.deepEqual(r.json, {
      trust: "manual",
      fix_rounds: 2,
      approval: "pilot",
      tiers: ["alpha", "beta"],
      failover: [],
    });
  });
});

describe("config get: reports declared values", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.automation = { level: "roundabout", max_fix_rounds: 3 };
    c.backend.failover_tiers = ["opus", "sonnet"];
  } });
  after(() => fx.cleanup());

  test("config get: reports declared values", () => {
    const r = validate(fx.dir, "config", "get");
    assert.equal(r.status, 0);
    assert.deepEqual(r.json, {
      trust: "roundabout",
      fix_rounds: 3,
      approval: "pilot",
      tiers: ["alpha", "beta"],
      failover: ["opus", "sonnet"],
    });
  });
});

test("config get: not a Lanes project refuses with a /lanes-init pointer", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-noconfig-"));
  try {
    const r = validate(dir, "config", "get");
    assert.notEqual(r.status, 0);
    assert.ok((r.stdout + r.stderr).includes("/lanes-init"),
      `expected a /lanes-init pointer, got: ${r.stdout} ${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

(`fs`, `path`, `os`, `makeFixtureRepo`, `validate` are already imported at the top of the file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test`
Expected: the three new tests FAIL — `config get` hits the CLI usage error (exit 1, no JSON).

- [ ] **Step 3: Implement `config get`**

In `bin/lanes-validate.mjs`, insert a new section between `runSeedCheck` (ends line 996) and the `// CLI` banner (line 998):

```js
// ---------------------------------------------------------------- config knobs

// The five operational knobs /lanes-config exposes (design spec
// 2026-07-29-lanes-config §2-3). `config set` is the ONLY write path
// for them — validated with validateConfig before the write,
// fail-closed: any refusal leaves the file untouched.
const KNOBS = ["trust", "fix-rounds", "approval", "tiers", "failover"];

function configError(reason) {
  console.log(JSON.stringify({ ok: false, check: "config", reason }));
  process.exit(1);
}

function knobValues(cfg) {
  return {
    trust: cfg.automation.level,
    fix_rounds: cfg.automation.max_fix_rounds,
    approval: cfg.backend.approval_mode,
    tiers: cfg.backend.tiers,
    failover: cfg.backend.failover_tiers,
  };
}

function runConfigGet() {
  // loadConfig throws on missing/invalid config — the top-level catch
  // reports it (existing refusal text, /lanes-init or migration pointer).
  console.log(JSON.stringify(knobValues(loadConfig())));
}
```

In the CLI dispatch, before the final `else`:

```js
  else if (cmd === "config" && rest[0] === "get") runConfigGet();
```

Extend the usage string (line 1028): after `seed --check`, add `config get | config set <knob> <value>` (the `set` half lands in Task 3 but the usage line is written once, here):

```
usage: lanes-validate.mjs <gate --spec <path> | audit --task <id> | doctor | attention --spec <path> | seed --check | config get | config set <knob> <value> | worktree create --spec <path> [--base <ref>] | worktree create --stream <id> [--base <ref>] | worktree remove --task <id> [--force] | worktree remove --stream <id> [--force] | selftest>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node bin/lanes-validate.mjs selftest` — expect `selftest OK`.
Run: `node --test` — expect 0 failures.

- [ ] **Step 5: Commit**

```bash
git add bin/lanes-validate.mjs tests/validator.test.mjs
git commit -m "feat: config get subcommand — the five operational knobs, normalized"
```

---

### Task 3: `config set` subcommand

**Files:**
- Modify: `bin/lanes-validate.mjs` (the `config knobs` section from Task 2; CLI dispatch)
- Test: `tests/validator.test.mjs`

**Interfaces:**
- Consumes: `KNOBS`, `configError`, `knobValues`, `loadConfig`, `validateConfig` (Tasks 1-2).
- Produces: `node bin/lanes-validate.mjs config set <knob> <value>` → writes `.lanes/config.json`, stdout `{ ok:true, knob, old, new }`, exit 0; on any refusal `{ ok:false, check:"config", reason }`, exit 1, file byte-identical. Task 4's command doc calls exactly this.

- [ ] **Step 1: Write the failing tests**

In `tests/validator.test.mjs`, after the `config get` tests from Task 2:

```js
function readConfigFile(dir) {
  return fs.readFileSync(path.join(dir, ".lanes", "config.json"));
}

describe("config set: happy paths", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("set trust creates the automation block with defaults", () => {
    const r = validate(fx.dir, "config", "set", "trust", "roundabout");
    assert.equal(r.status, 0);
    assert.deepEqual(r.json, { ok: true, knob: "trust", old: "manual", new: "roundabout" });
    const cfg = JSON.parse(readConfigFile(fx.dir).toString());
    assert.deepEqual(cfg.automation, { level: "roundabout", max_fix_rounds: 2 });
  });

  test("set fix-rounds updates the existing block", () => {
    const r = validate(fx.dir, "config", "set", "fix-rounds", "3");
    assert.equal(r.status, 0);
    assert.deepEqual(r.json, { ok: true, knob: "fix-rounds", old: 2, new: 3 });
    const cfg = JSON.parse(readConfigFile(fx.dir).toString());
    assert.deepEqual(cfg.automation, { level: "roundabout", max_fix_rounds: 3 });
  });

  test("set approval automated", () => {
    const r = validate(fx.dir, "config", "set", "approval", "automated");
    assert.equal(r.status, 0);
    assert.deepEqual(r.json, { ok: true, knob: "approval", old: "pilot", new: "automated" });
  });

  test("set tiers splits on commas and trims", () => {
    const r = validate(fx.dir, "config", "set", "tiers", "sol, terra ,luna");
    assert.equal(r.status, 0);
    assert.deepEqual(r.json.new, ["sol", "terra", "luna"]);
    assert.deepEqual(r.json.old, ["alpha", "beta"]);
  });

  test("set failover declares the tiers", () => {
    const r = validate(fx.dir, "config", "set", "failover", "opus,sonnet");
    assert.equal(r.status, 0);
    assert.deepEqual(r.json, { ok: true, knob: "failover", old: [], new: ["opus", "sonnet"] });
  });

  test("set failover none clears to []", () => {
    const r = validate(fx.dir, "config", "set", "failover", "none");
    assert.equal(r.status, 0);
    assert.deepEqual(r.json, { ok: true, knob: "failover", old: ["opus", "sonnet"], new: [] });
    const cfg = JSON.parse(readConfigFile(fx.dir).toString());
    assert.deepEqual(cfg.backend.failover_tiers, []);
  });

  test("get round-trips the set values", () => {
    const r = validate(fx.dir, "config", "get");
    assert.deepEqual(r.json, {
      trust: "roundabout",
      fix_rounds: 3,
      approval: "automated",
      tiers: ["sol", "terra", "luna"],
      failover: [],
    });
  });
});

describe("config set: refusals leave the file byte-identical", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  // [label, knob, value, expected reason substring]
  const REFUSALS = [
    ["unknown knob", "widget", "x", "unknown knob 'widget'"],
    ["bad trust value", "trust", "yolo", "automation.level"],
    ["legacy conveyor names the rename", "trust", "conveyor", 'renamed to "roundabout"'],
    ["non-integer fix-rounds", "fix-rounds", "three", "integer >= 1"],
    ["fractional fix-rounds", "fix-rounds", "3.5", "integer >= 1"],
    ["zero fix-rounds", "fix-rounds", "0", "integer >= 1"],
    ["bad approval", "approval", "yolo", "approval_mode"],
    ["empty tiers", "tiers", "", "empty"],
    ["empty list entry", "tiers", "sol,,luna", "empty"],
    ["missing value", "trust", undefined, "usage"],
  ];

  for (const [label, knob, value, want] of REFUSALS) {
    test(`config set refusal: ${label}`, () => {
      const before = readConfigFile(fx.dir);
      const args = value === undefined
        ? ["config", "set", knob]
        : ["config", "set", knob, value];
      const r = validate(fx.dir, ...args);
      assert.equal(r.status, 1);
      assert.equal(r.json.ok, false);
      assert.ok(r.json.reason.includes(want),
        `expected reason to include ${JSON.stringify(want)}, got: ${r.json.reason}`);
      assert.ok(before.equals(readConfigFile(fx.dir)),
        "a refused set must leave the file byte-identical");
    });
  }

  test("config set refusal: unknown knob lists the five knobs", () => {
    const r = validate(fx.dir, "config", "set", "widget", "x");
    for (const knob of ["trust", "fix-rounds", "approval", "tiers", "failover"]) {
      assert.ok(r.json.reason.includes(knob), `refusal should list knob ${knob}`);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test`
Expected: every new `config set` test FAILS (usage error — no `set` dispatch yet). The Task 2 `config get` tests must still pass.

- [ ] **Step 3: Implement `config set`**

In the `config knobs` section of `bin/lanes-validate.mjs`, after `runConfigGet`:

```js
function runConfigSet(knob, value) {
  if (!KNOBS.includes(knob)) {
    configError(`unknown knob '${knob}' — knobs are: ${KNOBS.join(", ")}`);
  }
  if (value === undefined) configError(`usage: config set ${knob} <value>`);

  // Normalized view for the old value + the existing refusals on a
  // missing/invalid config (fail closed: a broken config cannot be
  // "fixed" through this path).
  const before = knobValues(loadConfig());
  const old = before[knob.replace("-", "_")];

  // Parse the value per knob (spec §3 step 2) — before any mutation.
  let parsed = value;
  if (knob === "fix-rounds") {
    if (!/^\d+$/.test(value)) configError(`'fix-rounds' must be an integer >= 1, got ${JSON.stringify(value)}`);
    parsed = Number(value);
  } else if (knob === "tiers" || knob === "failover") {
    parsed = knob === "failover" && value === "none"
      ? []
      : value.split(",").map((s) => s.trim());
    if (parsed.some((s) => s === "")) {
      configError(`'${knob}' must be a comma-separated list with no empty entries, got ${JSON.stringify(value)}`);
    }
  }

  // Mutate the RAW file, not the normalized view — loadConfig's
  // defaults must not leak into the file, except deliberately when
  // setting a knob creates the automation block (spec §3).
  const p = path.join(".", ".lanes", "config.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  if (knob === "trust" || knob === "fix-rounds") {
    const block = raw.automation ?? { level: "manual", max_fix_rounds: 2 };
    if (knob === "trust") block.level = parsed;
    else block.max_fix_rounds = parsed;
    raw.automation = block;
  } else if (knob === "approval") {
    raw.backend.approval_mode = parsed;
  } else if (knob === "tiers") {
    raw.backend.tiers = parsed;
  } else {
    raw.backend.failover_tiers = parsed;
  }

  const errors = validateConfig(raw);
  if (errors.length) configError(errors.join("; ")); // file untouched
  fs.writeFileSync(p, JSON.stringify(raw, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, knob, old, new: parsed }));
}
```

CLI dispatch, directly after the `config get` line:

```js
  else if (cmd === "config" && rest[0] === "set") runConfigSet(rest[1], rest[2]);
```

Note the fix-rounds `0` case: `/^\d+$/` accepts it, `validateConfig` refuses it with `must be an integer >= 1` — the refusal test expects that substring, so both rejection paths satisfy it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node bin/lanes-validate.mjs selftest` — expect `selftest OK`.
Run: `node --test` — expect 0 failures.

- [ ] **Step 5: Commit**

```bash
git add bin/lanes-validate.mjs tests/validator.test.mjs
git commit -m "feat: config set subcommand — validated, fail-closed knob writes"
```

---

### Task 4: `/lanes-config` command + docs

**Files:**
- Create: `commands/lanes-config.md`
- Modify: `README.md` (trust-ladder section, after the rung table ~line 115), `docs/USER-GUIDE.md` (trust-ladder section ~line 175), `templates/config.example.md` (`backend` and `automation` sections)
- Test: `tests/conformance.test.mjs`

**Interfaces:**
- Consumes: `config get` / `config set` (Tasks 2-3) — the command NEVER edits the JSON itself.

- [ ] **Step 1: Write the failing conformance needles**

In `tests/conformance.test.mjs`, after the sweep needle from Task 1:

```js
// ------------------------------------------------ /lanes-config (2026-07-29)

test("config command: structure and hard rules", () => {
  const cmd = read("commands/lanes-config.md");
  assert.ok(cmd.startsWith("---\n"), "lanes-config.md should start with a frontmatter fence");
  for (const knob of ["trust", "fix-rounds", "approval", "tiers", "failover"]) {
    assert.ok(cmd.includes("`" + knob + "`"), `lanes-config.md should name the ${knob} knob`);
  }
  assert.ok(cmd.includes("config get") && cmd.includes("config set"),
    "lanes-config.md should call the config subcommand for both read and write");
  assert.ok(cmd.includes("ONLY write path"),
    "lanes-config.md should state the only-write-path rule");
  assert.ok(cmd.includes("never ask for confirmation"),
    "lanes-config.md should state immediate apply");
  assert.ok(cmd.includes("pre-authorization to"),
    "lanes-config.md should state the failover quota consequence");
});

test("config command: docs teach /lanes-config", () => {
  assert.ok(read("README.md").includes("/lanes-config"),
    "README should mention /lanes-config");
  assert.ok(read("docs/USER-GUIDE.md").includes("/lanes-config"),
    "the user guide should mention /lanes-config");
  assert.ok(read("templates/config.example.md").includes("/lanes-config"),
    "config.example.md should point at /lanes-config");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test`
Expected: both new tests FAIL (`lanes-config.md` does not exist; docs lack the mention).

- [ ] **Step 3: Write `commands/lanes-config.md`**

Create the file with exactly this content:

````markdown
---
description: >
  Read and set the five operational knobs in `.lanes/config.json`:
  `trust` (automation.level), `fix-rounds` (automation.max_fix_rounds),
  `approval` (backend.approval_mode), `tiers` (backend.tiers), and
  `failover` (backend.failover_tiers). No argument shows current
  values; `<knob> <value>` sets one — validated before the write,
  applied immediately, fail-closed.
---

# /lanes-config [<knob> <value>] — the operational knobs

Run from the root of a Lanes project. These are the settings you flip
between runs; structural config (routing globs, commands, pipeline
paths, review_suite, project) is hand-edited and checked by
`/lanes-doctor` — never changed from here.

## No argument — show the knobs

Run (Bash):

    node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" config get

Render its JSON as a table — knob, current value, allowed values:

| Knob | Sets | Allowed |
|---|---|---|
| `trust` | `automation.level` | `manual` \| `verdicts` \| `roundabout` \| `highways` |
| `fix-rounds` | `automation.max_fix_rounds` | integer ≥ 1 |
| `approval` | `backend.approval_mode` | `pilot` \| `automated` |
| `tiers` | `backend.tiers` | comma-separated tier names, best→cheapest |
| `failover` | `backend.failover_tiers` | comma-separated Claude aliases, or `none` |

On error, render the subcommand's reason verbatim and stop — when
there is no config, point at `/lanes-init`.

## `<knob> <value>` — set one

Run (Bash), quoting the value:

    node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" config set <knob> "<value>"

Apply immediately — typing the command IS the explicit human decision;
never ask for confirmation. On `ok: true`, report old → new, then
state plainly what the new value means:

- `trust manual` — every stage change is a human handoff again.
- `trust verdicts` — reviewer verdicts are acted on unattended
  (APPROVE → merge + clean up; FIX → re-dispatch up to the cap).
  REJECT still always stops for a human.
- `trust roundabout` — `/lanes-run <plan>` now drives the whole task
  graph end-to-end; security-routed and attention-matched work still
  parks, REJECT still stops for a human.
- `trust highways` — `/lanes-highway <feature>` may run the full
  two-level stream orchestration; includes everything `roundabout`
  authorizes.
- `fix-rounds N` — a task now gets N FIX rounds before parking as
  needs-human.
- `approval pilot` / `approval automated` — the DELEGATE backend asks
  on-request / never asks.
- `tiers …` — the DELEGATE tier ladder, best→cheapest.
- `failover …` — declaring failover tiers IS the pre-authorization to
  spend Claude quota on DELEGATE-routed work when the backend's tiers
  are exhausted; `failover none` revokes it.

On `ok: false`, render the reason verbatim and stop — the file was not
modified; there is nothing to undo.

## Hard rules

- Never edit `.lanes/config.json` yourself — the `config set`
  subcommand is the ONLY write path, and its validation is the only
  gate. If it refuses, fix the value; never hand-edit around it.
- The five knobs are the complete set; never change any other config
  key from this command.
- Never touch anything else: no source, no specs, no `.lanes/state/`.
- Not a Lanes project → report it and point at `/lanes-init`; never
  scaffold.
````

- [ ] **Step 4: Add the docs mentions**

`README.md` — directly after the rung table (after the `highways` row, before the "Trust is declared…" paragraph), insert:

```markdown
Flip the rung — and the other operational knobs (fix-round cap,
approval mode, tier lists) — with `/lanes-config`, e.g. `/lanes-config
trust roundabout`. It validates before writing and applies immediately.
```

`docs/USER-GUIDE.md` — in "## The trust ladder", directly after the line "The commands enforce their rung: `/lanes-run` refuses below `roundabout`, …" paragraph, insert:

```markdown
You flip rungs (and the other operational knobs — the fix-round cap,
the backend approval mode, the tier lists) with `/lanes-config`:
`/lanes-config` alone shows current values, `/lanes-config trust
roundabout` sets one. Every write is schema-validated before it lands;
a refused value leaves the file untouched.
```

`templates/config.example.md` — two one-line notes.

At the end of the `## backend` section (after the `failover_tiers` bullet), insert:

```markdown
Flip `approval_mode`, `tiers`, and `failover_tiers` any time with
`/lanes-config` — the validated write path.
```

At the end of the `## automation` section (after the safety-floor paragraph), insert:

```markdown
Flip `level` and `max_fix_rounds` with `/lanes-config` (e.g.
`/lanes-config trust roundabout`) rather than hand-editing.
```

- [ ] **Step 5: Run the full suite to verify it passes**

Run: `node bin/lanes-validate.mjs selftest` — expect `selftest OK`.
Run: `node --test` — expect 0 failures (the Task 1 sweep needle also re-checks the new `commands/lanes-config.md` contains no `conveyor`).

- [ ] **Step 6: Commit**

```bash
git add commands/lanes-config.md README.md docs/USER-GUIDE.md templates/config.example.md tests/conformance.test.mjs
git commit -m "feat: /lanes-config — read and set the five operational knobs"
```
