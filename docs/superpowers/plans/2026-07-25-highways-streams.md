# Highways (Lanes v3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Highways layer: the `highways` trust rung, `routing.attention` park-routing topics, validator support (`attention --spec`, worktree `--base`/`--stream`), the `/lanes-highway` command, and the `lanes-stream-planner` agent — per `docs/superpowers/specs/2026-07-25-highways-streams-design.md`.

**Architecture:** Same cut as every existing piece of Lanes: everything machine-checkable lives in `bin/lanes-validate.mjs` with behavioral + structural tests; orchestration is thin prose commands the session follows. Tasks 1–3 are validator slices (schema, attention query + doctor, worktree); Task 4 is the prose surfaces (command, agent, skill, whiteboard) plus structural tests.

**Tech Stack:** Node ≥ 20 ESM, zero dependencies, `node --test`.

## Global Constraints

- Run the suite as bare `node --test` from the repo root — NEVER `node --test tests/` (breaks on Windows Node 22).
- Validation stays strict fail-closed; every refusal names what is allowed (spec §2).
- `schema_version` stays `1` (spec §2).
- `templates/config.example.json` keeps `"automation": { "level": "manual", ... }` — the example never models turning automation on (existing conformance test asserts this).
- The pre-existing conformance test "§5.5 config vocabulary sync" keeps `VOCAB` (in `tests/conformance.test.mjs`), `SCHEMA_V1` (validator), and `templates/config.example.json` key sets in exact lockstep — Task 1 touches all three in one commit, deliberately.
- Spec of record: `docs/superpowers/specs/2026-07-25-highways-streams-design.md`. Cite it in code comments the way existing comments cite their specs.
- Every commit message ends with the trailer line: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Coverage mapping note: several spec §8 behavioral items are satisfied via selftest `SCHEMA_VECTORS` executed through the existing "selftest passes" test; the per-task test lists below say which.

---

### Task 1: Schema — `highways` rung + `routing.attention`

**Files:**
- Modify: `bin/lanes-validate.mjs` (SCHEMA_V1, field-type chain, enum rule, loadConfig normalization, SCHEMA_VECTORS)
- Modify: `tests/conformance.test.mjs` (VOCAB only)
- Modify: `tests/validator.test.mjs` (3 new describes at end of file)
- Modify: `templates/config.example.json` (routing.attention)
- Modify: `templates/config.example.md` (routing bullet, automation rung, safety-floor sentence)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `validateConfig` accepts `automation.level: "highways"` and `routing.attention` (object map category → glob string array; optional). After `loadConfig()`, `config.routing.attention` is ALWAYS an object (absent ⇒ `{}`) — Tasks 2 and 4 rely on this. New field type token: `"topic_map?"`.

- [ ] **Step 1: Write the failing tests**

In `tests/conformance.test.mjs`, change the `routing` line of `VOCAB` (inside the "§5.5 config vocabulary sync" test):

```js
    routing: ["security_routed", "do_not_touch", "attention"],
```

Append to the end of `tests/validator.test.mjs`:

```js
describe("gate: highways level accepted", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.automation = { level: "highways" };
  } });
  after(() => fx.cleanup());

  test("gate: highways level accepted", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(r.status, 0);
    assert.equal(r.json.ok, true);
  });
});

describe("gate: valid attention config accepted", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.routing.attention = { lib: ["src/lib/**"], billing: ["src/billing/**"] };
  } });
  after(() => fx.cleanup());

  test("gate: valid attention config accepted", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(r.status, 0);
    assert.equal(r.json.ok, true);
  });
});

describe("gate: bad attention shape refused", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.routing.attention = { lib: "src/lib/**" };
  } });
  after(() => fx.cleanup());

  test("gate: bad attention shape refused", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.notEqual(r.status, 0);
    assert.ok((r.stdout + r.stderr).includes("routing.attention"),
      `expected a routing.attention error, got: ${r.stdout} ${r.stderr}`);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (repo root): `node --test`
Expected: FAIL — "§5.5 config vocabulary sync" (SCHEMA_V1 lacks `attention`, config.example.json routing keys mismatch), "gate: highways level accepted" (level refused), "gate: bad attention shape refused" (unknown key error instead of type error is a pass-by-accident risk — it will actually FAIL because the error says `unknown key 'routing.attention'`, which contains the needle; so rely on "gate: valid attention config accepted" failing to prove the schema change is needed).

- [ ] **Step 3: Implement the schema changes in `bin/lanes-validate.mjs`**

3a. Replace the one-line `routing` entry in `SCHEMA_V1`:

```js
  routing: {
    security_routed: "string[]",
    do_not_touch: "string[]",
    attention: "topic_map?",
  },
```

3b. In `validateConfig`'s field-type chain, insert a `topic_map?` case between the `posint?` case and the `string` case:

```js
      } else if (type === "posint?" && !(Number.isInteger(v) && v >= 1)) {
        errors.push(`'${block}.${key}' must be an integer >= 1`);
      } else if (type === "topic_map?"
          && (typeof v !== "object" || v === null || Array.isArray(v)
              || !Object.values(v).every(isStringArray))) {
        errors.push(`'${block}.${key}' must be an object mapping category names to arrays of glob strings`);
      } else if (type === "string" && typeof v !== "string") {
```

(The existing `if (v === undefined) { if (!type.endsWith("?")) … }` guard already makes any `?`-suffixed type optional — no change needed there.)

3c. Replace the automation enum rule:

```js
  if (cfg.automation && !["manual", "verdicts", "conveyor", "highways"].includes(cfg.automation.level)) {
    errors.push(`'automation.level' must be "manual", "verdicts", "conveyor", or "highways", got ${JSON.stringify(cfg.automation.level)}`);
  }
```

3d. In `loadConfig`, extend the normalization block (keep the existing comment, widen its citation):

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

3e. Append to `SCHEMA_VECTORS` (after the last automation vector):

```js
  ["automation highways", (c) => { c.automation = { level: "highways" }; }, null],
  ["attention empty map", (c) => { c.routing.attention = {}; }, null],
  ["attention valid map", (c) => { c.routing.attention = { billing: ["src/billing/**"], schema: ["prisma/migrations/**"] }; }, null],
  ["attention not an object", (c) => { c.routing.attention = ["src/billing/**"]; }, "routing.attention"],
  ["attention category not an array", (c) => { c.routing.attention = { billing: "src/billing/**" }; }, "routing.attention"],
  ["attention non-string glob", (c) => { c.routing.attention = { billing: [1] }; }, "routing.attention"],
```

- [ ] **Step 4: Update the two templates (vocab lockstep)**

4a. `templates/config.example.json` — add `attention` as the third key of `routing` (after `do_not_touch`):

```json
    "attention": {
      "billing": [
        "wisconsin-ice-exchange/src/lib/billing/**"
      ]
    }
```

(Full `routing` block afterward: `security_routed`, `do_not_touch`, `attention`. Mind the comma after the `do_not_touch` array.)

4b. `templates/config.example.md` — in the `## routing` section, after the `do_not_touch` bullet, add:

```markdown
- `attention` (object, optional): named attention categories — category
  name → list of path globs. In an unattended walk (`/lanes-run` at
  `conveyor` or above, or a `/lanes-highway` run), a task whose Touch
  list matches any of these globs parks on arrival, with the category
  named in the park reason — "this topic waits for me." Unlike
  `security_routed` it does not force KEEP routing and is not a gate
  refusal; at `manual` and `verdicts` it has no effect. Absent means no
  attention categories (`{}`).
```

4c. `templates/config.example.md` — in the `## automation` section's `level` list, after the `"conveyor"` bullet, add:

```markdown
  - `"highways"` — `/lanes-highway <feature>` runs the full two-level
    stream orchestration: one human gate (the stream map), unattended
    per-stream planning, concurrent stream execution, and an
    integration branch + review document — the working branch is never
    touched. Includes everything `"conveyor"` authorizes.
```

4d. `templates/config.example.md` — replace the section's closing safety-floor sentence:

```markdown
The safety floor holds at every level: security-routed and
attention-matched work never runs unattended, REJECT is always a human
decision, and nothing is ever pushed to a remote.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test` then `node bin/lanes-validate.mjs selftest`
Expected: all tests PASS; selftest OK with 29 schema vectors.

- [ ] **Step 6: Commit**

```bash
git add bin/lanes-validate.mjs tests/conformance.test.mjs tests/validator.test.mjs templates/config.example.json templates/config.example.md
git commit -m "feat: highways trust rung + routing.attention schema

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `attention --spec` subcommand + doctor integration

**Files:**
- Modify: `bin/lanes-validate.mjs` (new `runAttention`, doctor glob preview + report field, CLI dispatch + usage)
- Modify: `commands/lanes-doctor.md` (one Step 1 sentence)
- Modify: `tests/validator.test.mjs` (5 new describes at end of file)

**Interfaces:**
- Consumes: `config.routing.attention` always-an-object normalization from Task 1; existing `parseSpec`, `specBody`, `matchAny`, `normalizePath`, `loadConfig`, `mainRepoRoot`, `git`.
- Produces: CLI `attention --spec <path>` printing exactly `{ "matches": { "<category>": ["<touch path>", …] } }` (empty `matches` when none), exit 0 on success, exit 2 with `{ ok:false, check:"attention", reason }` on config/spec problems. Doctor JSON gains top-level `attention` (array of declared category names; `null` when config didn't load) and `routing.attention.<category>` entries in the glob preview. Task 4's command prose calls `attention --spec`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/validator.test.mjs`:

```js
describe("attention: matching categories reported", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.routing.attention = { lib: ["src/lib/**"], billing: ["src/billing/**"] };
  } });
  after(() => fx.cleanup());

  test("attention: matching categories reported", () => {
    const r = validate(fx.dir, "attention", "--spec", "docs/tasks/T1.md");
    assert.equal(r.status, 0);
    assert.deepEqual(r.json.matches, { lib: ["src/lib/thing.js", "src/lib/thing.test.js"] });
  });
});

describe("attention: no match is an empty map", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.routing.attention = { billing: ["src/billing/**"] };
  } });
  after(() => fx.cleanup());

  test("attention: no match is an empty map", () => {
    const r = validate(fx.dir, "attention", "--spec", "docs/tasks/T1.md");
    assert.equal(r.status, 0);
    assert.deepEqual(r.json.matches, {});
  });
});

describe("attention: absent block is an empty map", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("attention: absent block is an empty map", () => {
    const r = validate(fx.dir, "attention", "--spec", "docs/tasks/T1.md");
    assert.equal(r.status, 0);
    assert.deepEqual(r.json.matches, {});
  });
});

describe("attention: missing spec fails closed", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("attention: missing spec fails closed", () => {
    const r = validate(fx.dir, "attention", "--spec", "docs/tasks/NOPE.md");
    assert.equal(r.status, 2);
    assert.equal(r.json.check, "attention");
  });
});

describe("doctor: attention categories reported and previewed", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.routing.attention = { lib: ["src/lib/**"] };
  } });
  after(() => fx.cleanup());

  test("doctor: attention categories reported and previewed", () => {
    const r = validate(fx.dir, "doctor");
    assert.deepEqual(r.json.attention, ["lib"]);
    const entry = r.json.checks.globs.patterns.find((p) => p.list === "routing.attention.lib");
    assert.ok(entry, `expected a routing.attention.lib preview entry, got: ${JSON.stringify(r.json.checks.globs.patterns)}`);
    assert.ok(entry.matches >= 1, `expected src/lib/** to match tracked files, got: ${JSON.stringify(entry)}`);
  });
});
```

(An absent-attention doctor assertion rides along free: add `assert.deepEqual(r.json.attention, []);` inside the existing "doctor: absent automation block reports manual" test.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test`
Expected: FAIL — the four `attention:` describes hit the CLI usage error (unknown subcommand, exit 1), the doctor ones find no `attention` field / no preview entry.

- [ ] **Step 3: Implement in `bin/lanes-validate.mjs`**

3a. New section between the `audit` and `doctor` sections:

```js
// ---------------------------------------------------------------- attention

// Deterministic attention-topic query (design spec
// 2026-07-25-highways-streams §2.2): which routing.attention categories
// does this spec's Touch list match? Informational — exit 0 with or
// without matches; the conveyor/highway procedures park a task on any
// match instead of re-implementing glob matching in prose.
function runAttention(specPathArg) {
  if (!specPathArg) { console.error("attention: --spec <path> required"); process.exit(1); }
  const root = git("rev-parse", "--show-toplevel");
  process.chdir(root);
  let config;
  try { config = loadConfig(mainRepoRoot()); } catch (err) {
    console.log(JSON.stringify({ ok: false, check: "attention", reason: String(err.message || err) }));
    process.exit(2);
  }
  const specPath = normalizePath(specPathArg);
  if (!fs.existsSync(specPath)) {
    console.log(JSON.stringify({ ok: false, check: "attention", reason: `spec file not found: ${specPath}` }));
    process.exit(2);
  }
  const spec = parseSpec(specBody(fs.readFileSync(specPath, "utf8")));
  if (!spec.touch.length) {
    console.log(JSON.stringify({ ok: false, check: "attention", reason: "spec's Touch table is empty or unparseable" }));
    process.exit(2);
  }
  const matches = {};
  for (const [category, patterns] of Object.entries(config.routing.attention)) {
    const hits = spec.touch.map(normalizePath).filter((p) => matchAny(patterns, p));
    if (hits.length) matches[category] = hits;
  }
  console.log(JSON.stringify({ matches }));
}
```

3b. In `runDoctor`, extend the glob-preview `patterns` array (after the `review_suite.route_map` spread):

```js
      ...Object.entries(config.routing.attention).flatMap(([cat, globs]) =>
        globs.map((p) => [`routing.attention.${cat}`, p])),
```

3c. In `runDoctor`, widen the final report line (comment and object):

```js
  // Informational only (design specs 2026-07-25-roundabout-automation §6,
  // 2026-07-25-highways-streams §2.2): declared trust level and attention
  // categories are reported, never judged — not checks.
  console.log(JSON.stringify(
    {
      verdict: failed ? "not_safe" : "ok",
      automation: config ? config.automation : null,
      attention: config ? Object.keys(config.routing.attention) : null,
      checks,
    },
    null, 2));
```

3d. CLI dispatch — add before the `else` fallback:

```js
  else if (cmd === "attention") runAttention(argOf("--spec"));
```

and extend the usage string to include `attention --spec <path>`.

- [ ] **Step 4: Update `commands/lanes-doctor.md`**

In Step 1, immediately after the existing "Also render the report's top-level `automation` field…" sentence, add:

```markdown
Render the top-level `attention` field the same way — the declared
attention-category names (`[]` when none); their globs already appear
in the `globs` preview as `routing.attention.<category>` entries.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test` then `node bin/lanes-validate.mjs selftest`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add bin/lanes-validate.mjs commands/lanes-doctor.md tests/validator.test.mjs
git commit -m "feat: attention --spec subcommand + doctor attention reporting

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Worktree `--base` and `--stream`

**Files:**
- Modify: `bin/lanes-validate.mjs` (hoist `syncIn`, `--base` in `runWorktreeCreate`, new `runWorktreeCreateStream`, kind-parameterized `runWorktreeRemove`, CLI dispatch + usage)
- Modify: `tests/worktree.test.mjs` (5 new describes at end of file)

**Interfaces:**
- Consumes: existing `wtFail`, `ensureExcluded`, `git`, `mainRepoRoot`, `loadConfig`, `normalizePath`.
- Produces: CLI `worktree create --spec <path> [--base <ref>]` (task branch cut from `<ref>`, default HEAD; JSON unchanged plus accurate `base_sha`); `worktree create --stream <id> [--base <ref>]` → worktree `.lanes/worktrees/stream-<id>`, branch `highway/<id>`, JSON `{ ok, stream, path, branch, base_sha }`; `worktree remove --stream <id> [--force]`. Task 4's command prose uses all three forms.

- [ ] **Step 1: Write the failing tests**

Append to `tests/worktree.test.mjs`:

```js
describe("worktree create --base: task branch cut from named ref", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("worktree create --base: task branch cut from named ref", () => {
    fs.writeFileSync(path.join(fx.dir, "docs", "tasks", "T2.md"), T2_SPEC);
    gitC(fx.dir, "branch", "streambase");
    fs.appendFileSync(path.join(fx.dir, "src", "lib", "thing.js"), "// advance main\n");
    fx.commit("advance main");
    const baseSha = gitC(fx.dir, "rev-parse", "streambase");
    assert.notEqual(baseSha, gitC(fx.dir, "rev-parse", "HEAD"));

    const r = validate(fx.dir, "worktree", "create", "--spec", "docs/tasks/T2.md", "--base", "streambase");
    assert.equal(r.status, 0, `worktree create --base failed: ${r.stdout} ${r.stderr}`);
    assert.equal(r.json.base_sha, baseSha);
    assert.equal(gitC(fx.dir, "rev-parse", "lanes/T2"), baseSha);
  });
});

describe("worktree create --base: unknown ref refused", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("worktree create --base: unknown ref refused", () => {
    fs.writeFileSync(path.join(fx.dir, "docs", "tasks", "T2.md"), T2_SPEC);
    const r = validate(fx.dir, "worktree", "create", "--spec", "docs/tasks/T2.md", "--base", "no-such-ref");
    assert.equal(r.status, 2);
    assert.equal(r.json.check, "worktree");
    assert.ok(r.json.reason.includes("--base"), `expected reason to mention --base, got: ${r.json.reason}`);
  });
});

describe("worktree create --stream: golden", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("worktree create --stream: golden", () => {
    const r = validate(fx.dir, "worktree", "create", "--stream", "s1");
    assert.equal(r.status, 0, `worktree create --stream failed: ${r.stdout} ${r.stderr}`);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.stream, "s1");
    assert.equal(np(r.json.path), ".lanes/worktrees/stream-s1");
    assert.equal(r.json.branch, "highway/s1");
    assert.match(r.json.base_sha, HEX40);

    const wtDir = path.join(fx.dir, ".lanes", "worktrees", "stream-s1");
    assert.ok(fs.existsSync(wtDir), `expected stream worktree dir: ${wtDir}`);
    assert.ok(gitC(fx.dir, "branch", "--list", "highway/s1").trim().length > 0, "expected highway/s1 branch");
    assert.ok(fs.existsSync(path.join(wtDir, ".lanes", "config.json")), "expected config snapshot in stream worktree");
  });
});

describe("worktree create --stream: no clobber", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("worktree create --stream: no clobber", () => {
    assert.equal(validate(fx.dir, "worktree", "create", "--stream", "s1").status, 0);
    const r = validate(fx.dir, "worktree", "create", "--stream", "s1");
    assert.equal(r.status, 2);
    assert.ok(r.json.reason.includes("already exists"), `got: ${r.json.reason}`);
  });
});

describe("worktree remove --stream: clean removal", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("worktree remove --stream: clean removal", () => {
    assert.equal(validate(fx.dir, "worktree", "create", "--stream", "s1").status, 0);
    const r = validate(fx.dir, "worktree", "remove", "--stream", "s1");
    assert.equal(r.status, 0, `worktree remove --stream failed: ${r.stdout} ${r.stderr}`);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.stream, "s1");
    assert.ok(!fs.existsSync(path.join(fx.dir, ".lanes", "worktrees", "stream-s1")), "expected stream worktree gone");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test`
Expected: FAIL — `--base` is silently ignored today (base_sha equals HEAD, not streambase), `--stream` forms hit `--spec <path> required` / `--task <id> required` errors.

- [ ] **Step 3: Implement in `bin/lanes-validate.mjs`**

3a. Hoist the `syncIn` helper out of `runWorktreeCreate` to module level in the worktree section (keep its comment with it), so both create paths share it:

```js
// Snapshot dispatch inputs from the MAIN working tree into a worktree,
// overwriting the checkout's committed versions when they differ — the
// operator's current spec/config always win over stale committed
// copies. (The gate and audit read config from the main tree
// regardless; the worktree copy is a convenience snapshot for prose
// readers.)
function syncIn(srcRel, destAbs) {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  if (!fs.existsSync(destAbs)
      || !fs.readFileSync(srcRel).equals(fs.readFileSync(destAbs))) {
    fs.copyFileSync(srcRel, destAbs);
  }
}
```

3b. Add a shared base resolver next to it:

```js
// Resolve a --base ref to a commit, fail-closed (design spec
// 2026-07-25-highways-streams §4: task branches cut from the stream
// branch, stream branches from the run's base commit).
function resolveBase(baseArg) {
  const ref = baseArg ?? "HEAD";
  try { return git("rev-parse", "--verify", `${ref}^{commit}`); }
  catch { wtFail(`--base does not name a commit: ${ref}`); }
}
```

3c. `runWorktreeCreate(specPathArg, baseArg)` — add the parameter; replace the two lines

```js
  const base_sha = git("rev-parse", "HEAD");
  git("worktree", "add", wtPath, "-b", branch, "HEAD");
```

with

```js
  const base_sha = resolveBase(baseArg);
  git("worktree", "add", wtPath, "-b", branch, base_sha);
```

and delete the now-hoisted inner `syncIn` definition (the two call sites stay).

3d. New `runWorktreeCreateStream` after `runWorktreeCreate`:

```js
// Stream worktrees (design spec 2026-07-25-highways-streams §4): the
// per-stream working tree a highway run merges task branches into.
// Fixed conventions: worktree at .lanes/worktrees/stream-<id>, branch
// highway/<id>. The id "integration" is reserved in the stream MAP for
// the run's integration worktree — this subcommand creates it like any
// other stream.
function runWorktreeCreateStream(streamIdArg, baseArg) {
  if (!streamIdArg) { console.error("worktree create: --stream <id> required"); process.exit(1); }
  const root = git("rev-parse", "--show-toplevel");
  process.chdir(root);
  if (path.resolve(mainRepoRoot()) !== path.resolve(root)) {
    wtFail("worktree create must run from the main working tree, not a linked worktree");
  }
  try { loadConfig(); } catch (err) { wtFail(String(err.message || err)); }
  const streamFile = streamIdArg.replace(/[^A-Za-z0-9._-]/g, "_");
  const branch = `highway/${streamFile}`;
  const wtPath = `.lanes/worktrees/stream-${streamFile}`;
  if (fs.existsSync(wtPath)) {
    wtFail(`worktree already exists: ${wtPath} — run 'worktree remove --stream ${streamIdArg}' first`);
  }
  if (git("branch", "--list", branch).trim()) {
    wtFail(`branch already exists: ${branch} — integrate or delete it first`);
  }
  ensureExcluded(root);
  const base_sha = resolveBase(baseArg);
  git("worktree", "add", wtPath, "-b", branch, base_sha);
  syncIn(path.join(".lanes", "config.json"), path.join(wtPath, ".lanes", "config.json"));
  console.log(JSON.stringify({ ok: true, stream: streamIdArg, path: wtPath, branch, base_sha }));
}
```

3e. Parameterize `runWorktreeRemove(idArg, force, kind)` (`kind` is `"task"` or `"stream"`). Changes only at the top and in the output key — the prune/refuse/force logic is untouched:

```js
function runWorktreeRemove(idArg, force, kind) {
  const flag = kind === "stream" ? "--stream" : "--task";
  if (!idArg) { console.error(`worktree remove: ${flag} <id> required`); process.exit(1); }
  const root = git("rev-parse", "--show-toplevel");
  process.chdir(root);
  const idFile = idArg.replace(/[^A-Za-z0-9._-]/g, "_");
  const wtPath = kind === "stream" ? `.lanes/worktrees/stream-${idFile}` : `.lanes/worktrees/${idFile}`;
  const branch = kind === "stream" ? `highway/${idFile}` : `lanes/${idFile}`;
  const idKey = kind === "stream" ? "stream" : "task";
```

…and both `console.log(JSON.stringify({ ok: true, task: … }))` lines become `{ ok: true, [idKey]: idArg, … }` (rest of each object unchanged).

3f. CLI dispatch — replace the two worktree lines with four (order matters: `--stream` checks first):

```js
  else if (cmd === "worktree" && rest[0] === "create" && rest.includes("--stream")) runWorktreeCreateStream(argOf("--stream"), argOf("--base"));
  else if (cmd === "worktree" && rest[0] === "create") runWorktreeCreate(argOf("--spec"), argOf("--base"));
  else if (cmd === "worktree" && rest[0] === "remove" && rest.includes("--stream")) runWorktreeRemove(argOf("--stream"), rest.includes("--force"), "stream");
  else if (cmd === "worktree" && rest[0] === "remove") runWorktreeRemove(argOf("--task"), rest.includes("--force"), "task");
```

3g. Update the usage string:

```js
    console.error("usage: lanes-validate.mjs <gate --spec <path> | audit --task <id> | doctor | attention --spec <path> | worktree create --spec <path> [--base <ref>] | worktree create --stream <id> [--base <ref>] | worktree remove --task <id> [--force] | worktree remove --stream <id> [--force] | selftest>");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test` then `node bin/lanes-validate.mjs selftest`
Expected: all PASS, including every pre-existing worktree test (the `--task` JSON still says `task:`).

- [ ] **Step 5: Commit**

```bash
git add bin/lanes-validate.mjs tests/worktree.test.mjs
git commit -m "feat: worktree --base refs and --stream worktrees for highway runs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Prose surfaces — `/lanes-highway`, stream planner, skill, whiteboard + structural tests

**Files:**
- Create: `commands/lanes-highway.md`
- Create: `agents/lanes-stream-planner.md`
- Modify: `commands/lanes-run.md` (precondition, attention parking, park list, hard rule)
- Modify: `skills/lanes/SKILL.md` (Section A sentence, Section C item 6)
- Modify: `whiteboard.md` (graduate Highways)
- Modify: `tests/conformance.test.mjs` (5 new structural tests at end of file)

**Interfaces:**
- Consumes: `automation.level: "highways"` enum (Task 1), `attention --spec <path>` (Task 2), `worktree create --spec <path> --base <ref>` / `worktree create --stream <id> --base <ref>` / `worktree remove --stream <id>` (Task 3).
- Produces: the user-facing Highways surface. No code interfaces.

- [ ] **Step 1: Write the failing structural tests**

Append to `tests/conformance.test.mjs`:

```js
// -------------------------------------------------- Highways (2026-07-25)

test("highways: /lanes-highway command structure", () => {
  const cmd = read("commands/lanes-highway.md");
  assert.ok(cmd.startsWith("---\n"), "lanes-highway.md should start with a frontmatter fence");
  for (const term of [
    "highways", "stream map", "territory", "depends-on", "lanes-stream-planner",
    "attention", "highway/integration", "park", "Integration review", "Task/Lane Map",
    "worktree create --stream",
  ]) {
    assert.ok(cmd.includes(term), `lanes-highway.md should mention ${JSON.stringify(term)}`);
  }
  assert.ok(!cmd.includes("git push"), "a highway run must never push to a remote");
  assert.ok(cmd.includes("never committed to, merged into, or checked"),
    "lanes-highway.md should state the never-touch-working-branch rule");
});

test("highways: stream planner agent plans only", () => {
  const agent = read("agents/lanes-stream-planner.md");
  assert.ok(agent.includes("name: lanes-stream-planner"), "agent frontmatter should carry its name");
  for (const term of ["territory", "Task/Lane Map", "(LANE: KEEP)", "interfaces"]) {
    assert.ok(agent.includes(term), `lanes-stream-planner.md should mention ${JSON.stringify(term)}`);
  }
  assert.ok(agent.includes("You never execute anything"),
    "the stream planner must declare itself planning-only");
});

test("highways: lanes-run accepts both levels and parks attention", () => {
  const cmd = read("commands/lanes-run.md");
  assert.ok(cmd.includes('"conveyor"') && cmd.includes('"highways"'),
    "lanes-run.md precondition should name both accepted levels");
  assert.ok(cmd.includes("attention --spec"), "lanes-run.md should call the attention subcommand");
});

test("highways: SKILL.md references /lanes-highway", () => {
  const skill = read("skills/lanes/SKILL.md");
  assert.ok(skill.includes("/lanes-highway"), "SKILL.md should reference /lanes-highway");
  assert.ok(skill.includes("routing.attention"), "SKILL.md should reference routing.attention");
});

test("highways: config templates document attention and the fourth rung", () => {
  const json = JSON.parse(read("templates/config.example.json"));
  assert.ok(json.routing.attention && typeof json.routing.attention === "object" && !Array.isArray(json.routing.attention),
    "config.example.json should carry a routing.attention object");
  assert.equal(json.automation.level, "manual",
    "the example must still not model turning automation on");
  const md = read("templates/config.example.md");
  assert.ok(md.includes("`attention`"), "config.example.md should document attention");
  assert.ok(md.includes('"highways"'), "config.example.md should document the highways rung");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test`
Expected: FAIL — the two new files don't exist; lanes-run.md and SKILL.md lack the new terms. (The template test already passes — Task 1 landed those; it pins them structurally from now on.)

- [ ] **Step 3: Create `commands/lanes-highway.md`**

```markdown
---
description: >
  Run a Highways orchestration: decompose a feature into independent
  work streams, get ONE human approval (the stream map), then plan each
  stream with a frontier subagent and drive every stream's conveyor
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
Like the conveyor, this command changes who turns the crank — never
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
   `/lanes-run` does, with three substitutions:
   - **Attention check first.** Before dispatching any task, run
     `… attention --spec <spec-path>`; any matching category parks the
     task on arrival, category in the reason — attention work never
     runs unattended, exactly like security-routed arrival.
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
   rounds used, deviations; integration — merge order, conflicts
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
```

- [ ] **Step 4: Create `agents/lanes-stream-planner.md`**

```markdown
---
name: lanes-stream-planner
description: >
  Plans ONE Highways stream: takes a stream-map entry (mission,
  territory, depends-on, interfaces) and writes that stream's
  lane-tagged implementation plan. Planning only — this agent never
  implements, dispatches, emits specs, or runs a conveyor. Use only
  from /lanes-highway.
tools: Read, Grep, Glob, Write, Bash
---

You are the planning head of one Highways stream. Your entire output
is one plan file. You never execute anything.

# Input

You are invoked with one stream's map entry, verbatim: id, mission,
territory (the globs your plan may touch), depends-on, interfaces
(what other streams expose to you and expect from you) — plus the plan
output path and the base commit the run builds from.

# Rules

1. **Write the plan** with superpowers `writing-plans` discipline and
   the lane rules of Section B of
   `${CLAUDE_PLUGIN_ROOT}/skills/lanes/SKILL.md`: every task heading
   carries `(LANE: KEEP)` or `(LANE: DELEGATE, tier <t>)` per
   `${CLAUDE_PLUGIN_ROOT}/templates/ROUTING.md`, with a Task/Lane Map
   table (`task | lane | tier | depends-on`) near the top. DELEGATE
   tasks stop at contract depth (files, real interfaces read off the
   codebase, constraints, acceptance command — no finished code); KEEP
   tasks get full detail.
2. **Stay inside the territory.** Every path any task touches must
   match the stream's territory globs (pipeline-owned paths —
   `tasks_dir`, `plans_dir`, the ledger — are implicitly allowed). A
   genuine need outside the territory is a decomposition problem, not
   yours to solve: record it under a `## Territory concerns` heading
   instead of planning it. The controller parks the stream on
   violations — flagging beats hiding.
3. **Depends-on stays in-stream.** Task `Depends on` may reference
   only this stream's tasks. Work another stream must finish first is
   already expressed at the stream level — build against its declared
   interfaces as given.
4. **Interfaces are contracts.** What the map says you expose, your
   plan must produce — exact names and signatures. What it says you
   consume, you use as declared. Never invent or "improve" a
   cross-stream interface; a mismatch you can't plan around goes under
   `## Territory concerns`.
5. Reference existing code by pattern name, never line numbers. A
   DELEGATE task whose Interfaces section can't be written as real
   code off the current source routes KEEP instead.

# Report

Return only: the plan file path, the task count by lane, and any
territory concerns (say "none" if none). The plan file is the
deliverable — do not restate its contents.
```

- [ ] **Step 5: Update `commands/lanes-run.md`**

5a. Precondition 1, replace the first sentence pair:

```markdown
1. `.lanes/config.json` loads clean and `automation.level` is
   `"conveyor"` or `"highways"`. At `"manual"` or `"verdicts"` refuse —
   the declared trust level IS the authorization to run unattended; do
   not offer to proceed anyway.
```

5b. Procedure step 2, the DELEGATE bullet — insert the attention check so the bullet begins:

```markdown
   - **DELEGATE task** → first
     `node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" attention --spec <spec-path>`;
     any matching category parks the task on arrival, category in the
     reason — attention work never runs unattended. Otherwise the full
     existing cycle:
```

(The rest of the bullet — `worktree create`, dispatches, verdicts — is unchanged.)

5c. Procedure step 3's park-cause list: replace `or security-routed arrival` with `security-routed arrival, or attention-category arrival`.

5d. Hard rules, first rule becomes:

```markdown
- Security-routed and attention-matched work never runs unattended —
  parked on arrival, every time.
```

- [ ] **Step 6: Update `skills/lanes/SKILL.md`**

6a. Section A's closing paragraph, replace the final clause:

```markdown
When the project's `.lanes/config.json` declares an `automation.level`
above `"manual"`, the handoffs between these stages run unattended per
the Roundabout trust ladder — see Section C item 6, `/lanes-run`, and
(at the top rung) `/lanes-highway`.
```

6b. Section C item 6 — after the sentence ending "it drives the whole Task/Lane Map and parks anything needing a human.", insert:

```markdown
   At `"highways"`, `/lanes-highway <feature>` adds the level above
   the conveyor: stream decomposition with one human gate (the stream
   map), unattended per-stream planning via `lanes-stream-planner`,
   concurrent stream execution, and a `highway/integration` branch +
   review document — the working branch is never touched. In any
   unattended walk, a task whose Touch matches a `routing.attention`
   category parks for the human, exactly like security-routed work.
```

(The item's closing sentence "At every level: security-routed work never runs unattended, and nothing is ever pushed to a remote." stays last.)

- [ ] **Step 7: Graduate the whiteboard idea**

In `whiteboard.md`: delete the entire `### v3: Highways` entry from **Ideas** (the `## Ideas` heading and the template comment stay), and add under **Graduated**, after the Roundabout line:

```markdown
- **Highways (v3)** → `docs/superpowers/specs/2026-07-25-highways-streams-design.md` (two-level stream orchestration: stream map + `/lanes-highway` + `routing.attention`). Graduated 2026-07-25.
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test` then `node bin/lanes-validate.mjs selftest`
Expected: all PASS (frontmatter, cross-reference, DONE-token, and fixture-leakage sweeps now also cover the two new files).

- [ ] **Step 9: Commit**

```bash
git add commands/lanes-highway.md agents/lanes-stream-planner.md commands/lanes-run.md skills/lanes/SKILL.md whiteboard.md tests/conformance.test.mjs
git commit -m "feat: /lanes-highway command + lanes-stream-planner agent (Highways v3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
