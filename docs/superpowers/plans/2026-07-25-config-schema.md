# Schema-Versioned Config + /lanes-doctor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the machine-read Lanes config from free-form Markdown to schema-versioned `.lanes/config.json` with strict fail-closed validation, and add `/lanes-doctor` — a health check (schema, glob preview, command resolution, clean baseline, backend reachability) that is also the one-time migration path from legacy `config.md`.

**Architecture:** `bin/lanes-validate.mjs` becomes the single parser authority: its `loadConfig()` is replaced by a JSON loader + strict schema-v1 validator, and it grows a `doctor` subcommand reusing the existing matcher and git helpers. A new thin `commands/lanes-doctor.md` renders the subcommand's JSON and adds the two session-side checks (MCP tool reachability, legacy migration). Every prose surface that names `config.md` is repointed at `config.json`.

**Tech Stack:** Plain Node ESM (zero dependencies), Markdown prompt files.

**Design spec:** `docs/superpowers/specs/2026-07-24-config-schema-design.md` — the behavior contract for every task below.

## Global Constraints

- **Zero dependencies.** `bin/lanes-validate.mjs` stays a single-file, plain-Node ESM script using only `node:` built-ins. No npm install, no new packages, anywhere.
- **`.lanes/config.json` is the only config any Lanes surface reads.** No dual-read fallback. After Task 6's sweep, the string `.lanes/config.md` appears in plugin sources ONLY in: `commands/lanes-doctor.md` (the migration path), `bin/lanes-validate.mjs` (one legacy-hint error string), and `templates/config.example.md` (the migration note). `docs/superpowers/**` and `whiteboard.md` are exempt from the sweep and are never edited by any task (`whiteboard.md` is the user's file; the plans/specs are historical records — except that this plan file itself tracks checkboxes).
- **Schema v1 vocabulary is frozen** (spec §2): top-level `schema_version` (the number `1`), blocks `project` (`app_subdir`, `command_prefix`), `commands` (`test`, `lint`, `typecheck`, `acceptance_runner`), `backend` (`name`, `dispatch_tool`, `reply_tool`, `approval_mode`, `tiers`, `ratelimit_signal`), `routing` (`security_routed`, `do_not_touch`), optional `review_suite` (`suite_command`, `id_pattern`, `id_index`, `route_map`), `pipeline` (`plans_dir`, `tasks_dir`, `ledger`). Exactly these names, exactly this nesting, in every file this plan touches.
- **Validation is strict and fail-closed:** unknown keys at any level are errors; `schema_version` must be exactly the number `1`; `approval_mode` ∈ {`pilot`, `automated`}; `tiers` non-empty; `commands.lint`/`commands.typecheck` may be `""` but `commands.test`/`commands.acceptance_runner` may not; `routing.*` lists may be `[]` but must be present.
- **No behavior change to `gate`/`audit` beyond the loader swap.** The matcher (`normalizePath`, `globToRegExp`, `matchesPattern`, `matchAny`), `MATCH_VECTORS`, `parseSpec`, `SAMPLE_SPEC`, and the hook scripts are untouched.
- `node bin/lanes-validate.mjs selftest` must be green at the commit of every task that touches the validator (Tasks 1–2).
- Doctor severity vocabulary: per-check `status` ∈ {`pass`, `warn`, `fail`}; top-level `verdict` ∈ {`ok`, `not_safe`}; exit 0 iff no check failed. Warns never affect the exit code.

---

### Task 1: Schema-v1 loader in the validator

**Files:**
- Modify: `bin/lanes-validate.mjs` (the parsing section around lines 54–99, the sample-config block around lines 136–158, `runParseChecks`, `runSelftest`, and the `config.*` references in `runGate`/`runAudit`)

**Interfaces:**
- Consumes: existing `fs`, `matchAny`, `parseSpec` — unchanged.
- Produces: `validateConfig(cfg) → string[]` (empty array = valid; each entry a human-readable error). `loadConfig() → cfg` — reads `.lanes/config.json`, throws on missing file / bad JSON / validation errors; the returned object is the full nested schema-v1 config (callers use `cfg.routing.security_routed`, `cfg.pipeline.tasks_dir`, etc.). `VALID_CONFIG` and `SCHEMA_VECTORS` constants used by selftest (Task 2 appends its own vectors after them).

- [ ] **Step 1: Write the failing selftest vectors (test first)**

In `bin/lanes-validate.mjs`, replace the entire `SAMPLE_CONFIG` template-literal declaration (from `const SAMPLE_CONFIG = \`# Lanes config` through the closing `` `; `` — do NOT touch `SAMPLE_SPEC` below it) with:

```js
// A schema-v1 config that must validate clean. SCHEMA_VECTORS mutate
// clones of it to probe each validation rule (spec §2).
const VALID_CONFIG = {
  schema_version: 1,
  project: { app_subdir: "myapp", command_prefix: "cd myapp &&" },
  commands: {
    test: "pnpm vitest run",
    lint: "pnpm eslint",
    typecheck: "pnpm tsc --noEmit",
    acceptance_runner: "pnpm vitest run",
  },
  backend: {
    name: "codex-mcp",
    dispatch_tool: "mcp__codex__codex",
    reply_tool: "mcp__codex__codex-reply",
    approval_mode: "pilot",
    tiers: ["sol", "terra", "luna"],
    ratelimit_signal: ["usage-cap", "429", "rate limit"],
  },
  routing: {
    security_routed: ["src/auth.ts", "prisma/migrations/**"],
    do_not_touch: ["pnpm-lock.yaml", ".env"],
  },
  pipeline: {
    plans_dir: "docs/superpowers/plans",
    tasks_dir: "docs/superpowers/tasks",
    ledger: ".superpowers/sdd/progress.md",
  },
};

// [label, mutate(clone), expected error substring | null (= must be valid)]
const SCHEMA_VECTORS = [
  ["valid config", () => {}, null],
  ["review_suite present", (c) => {
    c.review_suite = {
      suite_command: "pnpm test:ux",
      id_pattern: "<id>-",
      id_index: "docs/workflows.md",
      route_map: { "src/app/admin/**": ["a1", "a2"] },
    };
  }, null],
  ["empty lint allowed", (c) => { c.commands.lint = ""; }, null],
  ["empty routing lists allowed", (c) => {
    c.routing.security_routed = [];
    c.routing.do_not_touch = [];
  }, null],
  ["misspelled key", (c) => {
    c.routing.securty_routed = c.routing.security_routed;
    delete c.routing.security_routed;
  }, "unknown key"],
  ["unknown top-level key", (c) => { c.extra = 1; }, "unknown key 'extra'"],
  ["schema_version as string", (c) => { c.schema_version = "1"; }, "schema_version"],
  ["schema_version wrong number", (c) => { c.schema_version = 2; }, "schema_version"],
  ["missing required block", (c) => { delete c.backend; }, "required block 'backend'"],
  ["wrong type for tiers", (c) => { c.backend.tiers = "sol"; }, "array of strings"],
  ["bad approval_mode", (c) => { c.backend.approval_mode = "yolo"; }, "approval_mode"],
  ["empty tiers", (c) => { c.backend.tiers = []; }, "non-empty"],
  ["empty test command", (c) => { c.commands.test = ""; }, "commands.test"],
  ["route_map value not an array", (c) => {
    c.review_suite = {
      suite_command: "x", id_pattern: "<id>-", id_index: "y",
      route_map: { "a/**": "a1" },
    };
  }, "route_map"],
];

function runSchemaChecks() {
  let failures = 0;
  for (const [label, mutate, want] of SCHEMA_VECTORS) {
    const cfg = structuredClone(VALID_CONFIG);
    mutate(cfg);
    const errors = validateConfig(cfg);
    const ok = want === null ? errors.length === 0 : errors.some((e) => e.includes(want));
    if (!ok) {
      failures++;
      console.error(`FAIL schema[${label}]: got ${JSON.stringify(errors)}, expected ${
        want === null ? "no errors" : `an error containing ${JSON.stringify(want)}`}`);
    }
  }
  return failures;
}
```

Then, in `runParseChecks`, delete the four config assertions and the `parseConfig` call — replace:

```js
  const cfg = parseConfig(SAMPLE_CONFIG);
  expect("config.security_routed", cfg.lists.security_routed, ["src/auth.ts", "prisma/migrations/**"]);
  expect("config.do_not_touch", cfg.lists.do_not_touch, ["pnpm-lock.yaml", ".env"]);
  expect("config.tasks_dir", cfg.scalars.tasks_dir, "docs/superpowers/tasks");
  expect("config.approval_mode", cfg.scalars.approval_mode, "pilot"); // trailing comment stripped
  const spec = parseSpec(SAMPLE_SPEC);
```

with:

```js
  const spec = parseSpec(SAMPLE_SPEC);
```

Then wire schema checks into `runSelftest` — replace:

```js
  let failures = runParseChecks();
```

with:

```js
  let failures = runParseChecks() + runSchemaChecks();
```

and replace the success message line:

```js
    ? `selftest OK (${MATCH_VECTORS.length} match vectors + parse checks)`
```

with:

```js
    ? `selftest OK (${MATCH_VECTORS.length} match vectors + ${SCHEMA_VECTORS.length} schema vectors + parse checks)`
```

- [ ] **Step 2: Run selftest to verify it fails**

Run: `node bin/lanes-validate.mjs selftest`
Expected: FAIL — output is the fail-closed JSON `{"ok":false,"check":"error","reason":"validateConfig is not defined"}` with exit code 2 (`validateConfig` doesn't exist yet).

- [ ] **Step 3: Implement the schema loader**

In `bin/lanes-validate.mjs`, replace the entire legacy parsing block — starting at the line `// ---------------------------------------------------------------- parsing` and ending with `loadConfig`'s closing `}` (i.e. the section comment, the `parseConfig` doc comment, `function parseConfig(text) {…}`, and `function loadConfig() {…}`; do NOT touch the `// Extracts what the gate/audit need…` comment or `parseSpec` below) with:

```js
// ---------------------------------------------------------------- config

// Strict, fail-closed validation of .lanes/config.json (schema v1).
// Behavior spec: docs/superpowers/specs/2026-07-24-config-schema-design.md §2.
// Unknown keys, wrong types, or a wrong schema_version are refusals —
// a misspelled security list must die loudly, never be silently ignored.

const SCHEMA_V1 = {
  project: { app_subdir: "string", command_prefix: "string" },
  commands: {
    test: "string",
    lint: "string",
    typecheck: "string",
    acceptance_runner: "string",
  },
  backend: {
    name: "string",
    dispatch_tool: "string",
    reply_tool: "string",
    approval_mode: "string",
    tiers: "string[]",
    ratelimit_signal: "string[]",
  },
  routing: { security_routed: "string[]", do_not_touch: "string[]" },
  review_suite: {
    suite_command: "string",
    id_pattern: "string",
    id_index: "string",
    route_map: "route_map",
  },
  pipeline: { plans_dir: "string", tasks_dir: "string", ledger: "string" },
};
const OPTIONAL_BLOCKS = new Set(["review_suite"]);

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validateConfig(cfg) {
  if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) {
    return ["config root is not a JSON object"];
  }
  if (cfg.schema_version !== 1) {
    return [`schema_version must be the number 1, got ${JSON.stringify(cfg.schema_version)}`];
  }
  const errors = [];
  for (const key of Object.keys(cfg)) {
    if (key !== "schema_version" && !(key in SCHEMA_V1)) errors.push(`unknown key '${key}'`);
  }
  for (const [block, fields] of Object.entries(SCHEMA_V1)) {
    const val = cfg[block];
    if (val === undefined) {
      if (!OPTIONAL_BLOCKS.has(block)) errors.push(`required block '${block}' is missing`);
      continue;
    }
    if (typeof val !== "object" || val === null || Array.isArray(val)) {
      errors.push(`'${block}' must be a JSON object`);
      continue;
    }
    for (const key of Object.keys(val)) {
      if (!(key in fields)) errors.push(`unknown key '${block}.${key}'`);
    }
    for (const [key, type] of Object.entries(fields)) {
      const v = val[key];
      if (v === undefined) {
        errors.push(`required field '${block}.${key}' is missing`);
      } else if (type === "string" && typeof v !== "string") {
        errors.push(`'${block}.${key}' must be a string`);
      } else if (type === "string[]" && !isStringArray(v)) {
        errors.push(`'${block}.${key}' must be an array of strings`);
      } else if (type === "route_map"
          && (typeof v !== "object" || v === null || Array.isArray(v)
              || !Object.values(v).every(isStringArray))) {
        errors.push(`'${block}.${key}' must be an object mapping glob strings to arrays of ID strings`);
      }
    }
  }
  if (errors.length) return errors; // field rules below assume the structure above held
  if (cfg.backend.approval_mode !== "pilot" && cfg.backend.approval_mode !== "automated") {
    errors.push(`'backend.approval_mode' must be "pilot" or "automated", got ${JSON.stringify(cfg.backend.approval_mode)}`);
  }
  if (cfg.backend.tiers.length === 0) errors.push("'backend.tiers' must be a non-empty array");
  for (const key of ["test", "acceptance_runner"]) {
    if (cfg.commands[key].trim() === "") {
      errors.push(`'commands.${key}' must be non-empty — "" is only allowed for lint and typecheck ("no such step")`);
    }
  }
  return errors;
}

function loadConfig() {
  const p = ".lanes/config.json";
  if (!fs.existsSync(p)) {
    throw new Error(fs.existsSync(".lanes/config.md")
      ? ".lanes/config.json not found, but a legacy .lanes/config.md exists — run /lanes-doctor to migrate it"
      : ".lanes/config.json not found — run /lanes-init first");
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    throw new Error(`.lanes/config.json is not valid JSON: ${String(err.message || err)}`);
  }
  const errors = validateConfig(cfg);
  if (errors.length) {
    throw new Error(`.lanes/config.json failed schema v1 validation: ${errors.join("; ")}`);
  }
  return cfg;
}

// ---------------------------------------------------------------- parsing
```

(The final `// ---- parsing` banner re-heads the untouched `parseSpec` section that follows.)

- [ ] **Step 4: Repoint gate/audit at the nested config**

Four edits, still in `bin/lanes-validate.mjs`:

1. Replace BOTH occurrences (one in `runGate`, one in `runAudit`) of:

```js
  const allowlist = [".lanes", config.tasks_dir, config.plans_dir, config.ledger];
```

with:

```js
  const allowlist = [".lanes", config.pipeline.tasks_dir, config.pipeline.plans_dir, config.pipeline.ledger];
```

2. In `runGate`, replace:

```js
    for (const [list, patterns] of [["security_routed", config.security_routed], ["do_not_touch", config.do_not_touch]]) {
```

with:

```js
    for (const [list, patterns] of [["security_routed", config.routing.security_routed], ["do_not_touch", config.routing.do_not_touch]]) {
```

3. In `runAudit`, replace:

```js
    const secHit = matchAny(config.security_routed, p);
    const dntHit = secHit ? null : matchAny(config.do_not_touch, p);
```

with:

```js
    const secHit = matchAny(config.routing.security_routed, p);
    const dntHit = secHit ? null : matchAny(config.routing.do_not_touch, p);
```

4. In the header comment at the top of the file (line ~5), replace:

```js
// Matching semantics: docs/PATH-MATCHING.md (normative; keep in sync
```

with:

```js
// Config schema: docs/superpowers/specs/2026-07-24-config-schema-design.md §2.
// Matching semantics: docs/PATH-MATCHING.md (normative; keep in sync
```

- [ ] **Step 5: Run selftest to verify it passes**

Run: `node bin/lanes-validate.mjs selftest`
Expected: PASS — `selftest OK (17 match vectors + 14 schema vectors + parse checks)`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add bin/lanes-validate.mjs
git commit -m "feat: schema-versioned .lanes/config.json loader (strict, fail-closed)"
```

---

### Task 2: `doctor` subcommand

**Files:**
- Modify: `bin/lanes-validate.mjs` (new doctor section between the audit section and the CLI section; new tokenizer vectors next to `SCHEMA_VECTORS`; CLI wiring; selftest message)

**Interfaces:**
- Consumes: `loadConfig()`, `validateConfig` errors-as-strings, `VALID_CONFIG`/`SCHEMA_VECTORS` placement (Task 1); existing `git()`, `statusPaths()`, `matchAny`, `matchesPattern`, `normalizePath`.
- Produces: `runDoctor()` printing `{ verdict: "ok"|"not_safe", checks: { schema, globs, commands, baseline } }` (shape below — Task 4's command renders exactly this); `resolveTarget(cmd)` → `{kind:"pm",runner,target}` | `{kind:"bare",binary}` | `{kind:"empty"}`.

Doctor report shape (frozen — Task 4 renders it):

```json
{
  "verdict": "ok | not_safe",
  "checks": {
    "schema":   { "status": "pass" } ,
    "globs":    { "status": "pass|warn|fail", "patterns": [
                  { "list": "routing.security_routed", "pattern": "src/auth.ts", "matches": 1, "sample": ["src/auth.ts"] },
                  { "list": "routing.do_not_touch", "pattern": "../x", "error": "malformed pattern — absolute path, drive letter, or '..' segment" } ] },
    "commands": { "status": "pass|warn|fail", "commands": [
                  { "command": "test", "status": "pass", "resolved": "vitest" },
                  { "command": "typecheck", "status": "warn", "note": "'tsc' not in package.json scripts or dependencies" } ] },
    "baseline": { "status": "pass" }
  }
}
```

(Failed variants carry `reason` — e.g. `"schema": { "status": "fail", "reason": "<loadConfig message>" }`, `"baseline": { "status": "fail", "reason": "…", "dirty": [...] }`. When schema fails, the other three checks are `{ "status": "fail", "reason": "skipped — config did not load" }`.)

- [ ] **Step 1: Write the failing tokenizer vectors (test first)**

In `bin/lanes-validate.mjs`, immediately after the `runSchemaChecks` function (Task 1), insert:

```js
// [command string, expected resolveTarget() result]
const TOKENIZER_VECTORS = [
  ["pnpm vitest run", { kind: "pm", runner: "pnpm", target: "vitest" }],
  ["npm run test", { kind: "pm", runner: "npm", target: "test" }],
  ["yarn test", { kind: "pm", runner: "yarn", target: "test" }],
  ["npx tsc --noEmit", { kind: "pm", runner: "npx", target: "tsc" }],
  ["bun run lint", { kind: "pm", runner: "bun", target: "lint" }],
  ["pnpm exec playwright test", { kind: "pm", runner: "pnpm", target: "playwright" }],
  ["cargo test", { kind: "bare", binary: "cargo" }],
  ["", { kind: "empty" }],
  ["pnpm", { kind: "pm", runner: "pnpm", target: null }],
];

function runTokenizerChecks() {
  let failures = 0;
  for (const [cmd, want] of TOKENIZER_VECTORS) {
    const got = resolveTarget(cmd);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures++;
      console.error(`FAIL tokenizer(${JSON.stringify(cmd)}): got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
  }
  return failures;
}
```

Wire it into `runSelftest` — replace:

```js
  let failures = runParseChecks() + runSchemaChecks();
```

with:

```js
  let failures = runParseChecks() + runSchemaChecks() + runTokenizerChecks();
```

and replace the success message line:

```js
    ? `selftest OK (${MATCH_VECTORS.length} match vectors + ${SCHEMA_VECTORS.length} schema vectors + parse checks)`
```

with:

```js
    ? `selftest OK (${MATCH_VECTORS.length} match vectors + ${SCHEMA_VECTORS.length} schema vectors + ${TOKENIZER_VECTORS.length} tokenizer vectors + parse checks)`
```

- [ ] **Step 2: Run selftest to verify it fails**

Run: `node bin/lanes-validate.mjs selftest`
Expected: FAIL — `{"ok":false,"check":"error","reason":"resolveTarget is not defined"}`, exit 2.

- [ ] **Step 3: Implement the doctor section**

In `bin/lanes-validate.mjs`, immediately after `runAudit`'s closing `}` (before the `// ---------------------------------------------------------------- CLI` banner), insert:

```js
// ---------------------------------------------------------------- doctor

const PM_RUNNERS = new Set(["pnpm", "npm", "yarn", "bun", "npx"]);

// "pnpm vitest run" → {kind:"pm", runner:"pnpm", target:"vitest"};
// "npm run test" → target "test"; "cargo test" → {kind:"bare", binary:"cargo"}.
function resolveTarget(cmd) {
  const tokens = String(cmd).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { kind: "empty" };
  if (PM_RUNNERS.has(tokens[0])) {
    const target = (tokens[1] === "run" || tokens[1] === "exec") ? tokens[2] : tokens[1];
    return { kind: "pm", runner: tokens[0], target: target ?? null };
  }
  return { kind: "bare", binary: tokens[0] };
}

function onPath(bin) {
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";")
    : [];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of ["", ...exts]) {
      try { fs.accessSync(path.join(dir, bin + ext)); return true; } catch {}
    }
  }
  return false;
}

const RANK = { pass: 0, warn: 1, fail: 2 };
function worst(a, b) { return RANK[a] >= RANK[b] ? a : b; }

// Health report (design spec §4). Exit 0 iff no check failed; warns never
// block. Checks 2 and 4 are the same code paths the gate itself runs —
// the doctor previews exactly what the gate will enforce.
function runDoctor() {
  const root = git("rev-parse", "--show-toplevel");
  process.chdir(root);
  const checks = {};

  // Check 1 — schema (§4.1): loadConfig succeeding IS the check.
  let config = null;
  try {
    config = loadConfig();
    checks.schema = { status: "pass" };
  } catch (err) {
    checks.schema = { status: "fail", reason: String(err.message || err) };
    for (const c of ["globs", "commands", "baseline"]) {
      checks[c] = { status: "fail", reason: "skipped — config did not load" };
    }
  }

  if (config) {
    // Check 2 — glob preview (§4.2): every routing pattern against the
    // tracked tree, using the one true matcher. Zero matches = warn (a
    // not-yet-created path is legitimate); malformed pattern = fail.
    const tracked = git("ls-files").split("\n").filter(Boolean).map(normalizePath);
    const patterns = [
      ...config.routing.security_routed.map((p) => ["routing.security_routed", p]),
      ...config.routing.do_not_touch.map((p) => ["routing.do_not_touch", p]),
      ...Object.keys(config.review_suite?.route_map ?? {}).map((p) => ["review_suite.route_map", p]),
    ];
    let globStatus = "pass";
    const preview = [];
    for (const [list, pattern] of patterns) {
      const norm = normalizePath(pattern);
      if (path.isAbsolute(norm) || norm.includes(":") || /(^|\/)\.\.(\/|$)/.test(norm)) {
        preview.push({ list, pattern, error: "malformed pattern — absolute path, drive letter, or '..' segment" });
        globStatus = worst(globStatus, "fail");
        continue;
      }
      const matches = tracked.filter((f) => matchesPattern(pattern, f));
      preview.push({ list, pattern, matches: matches.length, sample: matches.slice(0, 5) });
      if (!matches.length) globStatus = worst(globStatus, "warn");
    }
    checks.globs = { status: globStatus, patterns: preview };

    // Check 3 — command resolution (§4.3) against the manifest at
    // app_subdir (commands are stored without command_prefix). Resolution
    // order: manifest scripts → dependency names → node_modules/.bin →
    // warn. Unresolvable is a warn, never a fail — the manifest cannot
    // prove every valid command wrong.
    const appDir = config.project.app_subdir || ".";
    const manifestPath = normalizePath(path.join(appDir, "package.json"));
    let manifest = null;
    if (fs.existsSync(manifestPath)) {
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { manifest = null; }
    }
    const known = new Set([
      ...Object.keys(manifest?.scripts ?? {}),
      ...Object.keys(manifest?.dependencies ?? {}),
      ...Object.keys(manifest?.devDependencies ?? {}),
    ]);
    let cmdStatus = "pass";
    const resolved = [];
    for (const [name, cmd] of Object.entries(config.commands)) {
      const t = resolveTarget(cmd);
      let entry;
      if (t.kind === "empty") {
        entry = { command: name, status: "pass", note: "no such step (empty string)" };
      } else if (t.kind === "pm") {
        if (!manifest) {
          entry = { command: name, status: "warn", note: `no readable manifest at ${manifestPath}` };
        } else if (!t.target) {
          entry = { command: name, status: "warn", note: `'${cmd}' names no script or binary after '${t.runner}'` };
        } else if (known.has(t.target)) {
          entry = { command: name, status: "pass", resolved: t.target };
        } else if (["", ".cmd", ".ps1"].some((ext) =>
            fs.existsSync(path.join(appDir, "node_modules", ".bin", t.target + ext)))) {
          entry = { command: name, status: "pass", resolved: `node_modules/.bin/${t.target}` };
        } else {
          entry = { command: name, status: "warn", note: `'${t.target}' not in ${manifestPath} scripts or dependencies` };
        }
      } else {
        entry = onPath(t.binary)
          ? { command: name, status: "pass", resolved: t.binary }
          : { command: name, status: "warn", note: `'${t.binary}' not found on PATH` };
      }
      cmdStatus = worst(cmdStatus, entry.status);
      resolved.push(entry);
    }
    checks.commands = { status: cmdStatus, commands: resolved };

    // Check 4 — clean baseline (§4.4): the gate's clean-tree check,
    // standalone. Any dirty path outside the pipeline allowlist = fail.
    const allowlist = [".lanes", config.pipeline.tasks_dir, config.pipeline.plans_dir, config.pipeline.ledger];
    const dirty = [];
    for (const line of git("status", "--porcelain", "--untracked-files=all").split("\n")) {
      if (!line.trim()) continue;
      for (const p of statusPaths(line)) {
        if (!matchAny(allowlist, p)) dirty.push(p);
      }
    }
    checks.baseline = dirty.length
      ? { status: "fail", reason: "working tree is not clean — commit or stash before dispatching", dirty }
      : { status: "pass" };
  }

  const failed = Object.values(checks).some((c) => c.status === "fail");
  console.log(JSON.stringify({ verdict: failed ? "not_safe" : "ok", checks }, null, 2));
  process.exit(failed ? 2 : 0);
}
```

- [ ] **Step 4: Wire the CLI**

In the CLI section at the bottom, replace:

```js
  if (cmd === "selftest") runSelftest();
  else if (cmd === "gate") runGate(argOf("--spec"));
  else if (cmd === "audit") runAudit(argOf("--task"));
  else {
    console.error("usage: lanes-validate.mjs <gate --spec <path> | audit --task <id> | selftest>");
```

with:

```js
  if (cmd === "selftest") runSelftest();
  else if (cmd === "gate") runGate(argOf("--spec"));
  else if (cmd === "audit") runAudit(argOf("--task"));
  else if (cmd === "doctor") runDoctor();
  else {
    console.error("usage: lanes-validate.mjs <gate --spec <path> | audit --task <id> | doctor | selftest>");
```

- [ ] **Step 5: Run selftest to verify it passes**

Run: `node bin/lanes-validate.mjs selftest`
Expected: PASS — `selftest OK (17 match vectors + 14 schema vectors + 9 tokenizer vectors + parse checks)`, exit 0.

- [ ] **Step 6: End-to-end doctor run in a fixture repo (Bash)**

Run this whole script with Bash from the Lanes repo root; every assertion must print its OK line:

```bash
set -e
REPO="$(pwd)"
FIX="$(mktemp -d)"
cd "$FIX"
git init -q
git config user.email fixture@example.com
git config user.name fixture
mkdir -p src .lanes
printf '%s\n' '{"scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^1.0.0","eslint":"^9.0.0","typescript":"^5.0.0"}}' > package.json
echo "export {};" > src/auth.ts
cat > .lanes/config.json <<'EOF'
{
  "schema_version": 1,
  "project": { "app_subdir": "", "command_prefix": "" },
  "commands": {
    "test": "pnpm vitest run",
    "lint": "pnpm eslint",
    "typecheck": "pnpm tsc --noEmit",
    "acceptance_runner": "pnpm vitest run"
  },
  "backend": {
    "name": "codex-mcp",
    "dispatch_tool": "mcp__codex__codex",
    "reply_tool": "mcp__codex__codex-reply",
    "approval_mode": "pilot",
    "tiers": ["sol", "terra", "luna"],
    "ratelimit_signal": ["usage-cap", "429", "rate limit"]
  },
  "routing": {
    "security_routed": ["src/auth.ts"],
    "do_not_touch": [".env"]
  },
  "pipeline": {
    "plans_dir": "docs/plans",
    "tasks_dir": "docs/tasks",
    "ledger": "docs/progress.md"
  }
}
EOF
git add -A
git commit -qm fixture

# 1. Clean tree: verdict ok (exit 0), auth glob matches, .env warns, tsc warns
node "$REPO/bin/lanes-validate.mjs" doctor > doctor-clean.json || { echo "FAIL: expected exit 0 on clean tree"; exit 1; }
node -e '
const assert = require("node:assert");
const r = require("./doctor-clean.json");
assert.equal(r.verdict, "ok");
assert.equal(r.checks.schema.status, "pass");
assert.equal(r.checks.globs.status, "warn");
assert.equal(r.checks.globs.patterns.find(p => p.pattern === "src/auth.ts").matches, 1);
assert.equal(r.checks.globs.patterns.find(p => p.pattern === ".env").matches, 0);
assert.equal(r.checks.commands.status, "warn");
assert.equal(r.checks.commands.commands.find(c => c.command === "test").status, "pass");
assert.equal(r.checks.commands.commands.find(c => c.command === "typecheck").status, "warn");
assert.equal(r.checks.baseline.status, "pass");
console.log("OK: clean-tree doctor report");
'

# 2. Dirty tree: baseline fails, verdict not_safe (exit 2)
echo "y" > src/new.ts
if node "$REPO/bin/lanes-validate.mjs" doctor > doctor-dirty.json; then
  echo "FAIL: expected exit 2 on dirty tree"; exit 1
fi
node -e '
const assert = require("node:assert");
const r = require("./doctor-dirty.json");
assert.equal(r.verdict, "not_safe");
assert.equal(r.checks.baseline.status, "fail");
assert.ok(r.checks.baseline.dirty.includes("src/new.ts"));
console.log("OK: dirty-tree doctor report");
'
rm src/new.ts

# 3. Legacy config.md only: schema fail carries the migration hint (exit 2)
rm .lanes/config.json
printf 'legacy\n' > .lanes/config.md
if node "$REPO/bin/lanes-validate.mjs" doctor > doctor-legacy.json; then
  echo "FAIL: expected exit 2 with legacy config"; exit 1
fi
node -e '
const assert = require("node:assert");
const r = require("./doctor-legacy.json");
assert.equal(r.verdict, "not_safe");
assert.ok(r.checks.schema.reason.includes("run /lanes-doctor to migrate"));
console.log("OK: legacy-config doctor report");
'

cd "$REPO"
rm -rf "$FIX"
echo "DOCTOR E2E OK"
```

Expected: the three `OK:` lines and `DOCTOR E2E OK`.

- [ ] **Step 7: Commit**

```bash
git add bin/lanes-validate.mjs
git commit -m "feat: doctor subcommand — schema, glob preview, command resolution, baseline"
```

---

### Task 3: Templates — `config.example.json` + `config.example.md` rewrite

**Files:**
- Create: `templates/config.example.json`
- Rewrite: `templates/config.example.md`

**Interfaces:**
- Consumes: schema v1 (Global Constraints); the WIX worked-example values from the current `templates/config.example.md`.
- Produces: `templates/config.example.json` — `/lanes-init`'s output shape (Task 5) and `/lanes-doctor`'s migration shape reference (Task 4); `templates/config.example.md` — the field-by-field reference both commands point at.

- [ ] **Step 1: Create `templates/config.example.json`** with exactly:

```json
{
  "schema_version": 1,
  "project": {
    "app_subdir": "wisconsin-ice-exchange",
    "command_prefix": "cd wisconsin-ice-exchange &&"
  },
  "commands": {
    "test": "pnpm vitest run",
    "lint": "pnpm eslint",
    "typecheck": "pnpm tsc --noEmit",
    "acceptance_runner": "pnpm vitest run"
  },
  "backend": {
    "name": "codex-mcp",
    "dispatch_tool": "mcp__codex__codex",
    "reply_tool": "mcp__codex__codex-reply",
    "approval_mode": "pilot",
    "tiers": ["sol", "terra", "luna"],
    "ratelimit_signal": ["usage-cap", "429", "rate limit"]
  },
  "routing": {
    "security_routed": [
      "src/auth.ts",
      "src/lib/authz.ts",
      "src/lib/availability.ts",
      "prisma/schema.prisma",
      "prisma/migrations/**"
    ],
    "do_not_touch": [
      "src/components/ui/**",
      "pnpm-lock.yaml",
      ".env",
      ".env.example"
    ]
  },
  "review_suite": {
    "suite_command": "pnpm test:ux",
    "id_pattern": "<id>-",
    "id_index": "docs/workflows.md",
    "route_map": {
      "src/app/admin/**": ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"],
      "src/app/org/**": ["o1", "o2", "o3", "o4"],
      "src/app/teams/**": ["s5", "s6", "s7", "s10", "v2"],
      "src/app/account/**": ["s11"]
    }
  },
  "pipeline": {
    "plans_dir": "docs/superpowers/plans",
    "tasks_dir": "docs/superpowers/tasks",
    "ledger": ".superpowers/sdd/progress.md"
  }
}
```

- [ ] **Step 2: Validate the example against the real validator (Bash)**

```bash
set -e
REPO="$(pwd)"
FIX="$(mktemp -d)"
cd "$FIX"
git init -q
mkdir .lanes
cp "$REPO/templates/config.example.json" .lanes/config.json
node -e '
const { execFileSync } = require("node:child_process");
let out;
try {
  out = execFileSync(process.execPath, [process.argv[1], "doctor"], { encoding: "utf8" });
} catch (err) {
  out = err.stdout;
}
const r = JSON.parse(out);
if (r.checks.schema.status !== "pass") {
  console.log("FAIL: schema", JSON.stringify(r.checks.schema));
  process.exit(1);
}
console.log("OK: config.example.json passes schema validation");
' "$REPO/bin/lanes-validate.mjs"
cd "$REPO"
rm -rf "$FIX"
```

Expected: `OK: config.example.json passes schema validation`. (Only the `schema` check is asserted — in the bare fixture the glob and command checks legitimately warn, so the doctor's exit code is tolerated either way.)

- [ ] **Step 3: Rewrite `templates/config.example.md`** with exactly this content (full file replacement):

````markdown
# Lanes config — schema v1  (`.lanes/config.json`)

The machine-read Lanes config is `.lanes/config.json` — a schema-versioned
JSON file, the ONLY per-project surface Lanes reads. `/lanes-init` drafts
it by inspecting your repo; `/lanes-doctor` validates it and previews what
it actually matches. JSON carries no comments, so this document is the
field-by-field reference. The worked example values here are pinned
against a real project (Wisconsin Ice Exchange, "WIX");
[`config.example.json`](config.example.json) is the same example as a
complete, schema-valid file — and `/lanes-init`'s output shape.

Validation (`bin/lanes-validate.mjs`) is strict and fail-closed: unknown
keys at any level, wrong types, or a wrong `schema_version` are refusals.
A misspelled key dies loudly instead of silently orphaning the list it
was supposed to be.

## `schema_version`  (number, required)

Exactly the number `1`. Anything else — absent, the string `"1"`, `2` —
is refused, naming the expected version.

## `project`

- `app_subdir` (string): path from repo root to the actual app (`""` if
  the repo root IS the app). `/lanes-init` infers it by finding the
  nearest package.json that isn't the repo-root workspace manifest.
  WIX: `"wisconsin-ice-exchange"`.
- `command_prefix` (string): prepended to every command in every emitted
  spec so the delegate runs from the app dir. Derived from `app_subdir` —
  WIX: `"cd wisconsin-ice-exchange &&"`; `""` when the repo root is the
  app.

## `commands`

Resolved from your package manifest (package.json scripts) at init;
`/lanes-doctor` re-resolves them any time. Stored WITHOUT the
`command_prefix` — the prefix is applied when specs are emitted.

- `test` (string, non-empty): the unit runner — WIX: `"pnpm vitest run"`.
- `lint` (string): base command only — callers/specs append the paths to
  lint (WIX uses `pnpm eslint <paths>`). `""` means "this project has no
  lint step".
- `typecheck` (string): WIX: `"pnpm tsc --noEmit"`. `""` means "no
  typecheck step".
- `acceptance_runner` (string, non-empty): what a task spec's acceptance
  command builds on (the unit runner) — usually identical to `test`
  unless your project splits "run everything" from "run one file".

## `backend`  ← THE SEAM (v1 ships codex-mcp only)

- `name` (string): the backend identifier — v1: `"codex-mcp"`.
- `dispatch_tool` / `reply_tool` (strings): the MCP tool names the
  implementer calls — v1: `"mcp__codex__codex"` /
  `"mcp__codex__codex-reply"`.
- `approval_mode`: `"pilot"` (backend asks on-request) or `"automated"`
  (never asks). The implementer's dispatch SEAM reads this to set the
  backend's approval policy.
- `tiers` (array of strings, non-empty): DELEGATE-lane tier names,
  best→cheapest. `/lanes-init` defaults to the backend's stock tiers;
  rename here if your project uses different labels.
- `ratelimit_signal` (array of strings): substrings that mark a
  rate-limit/usage-cap response. A backend response containing ANY of
  them (case-insensitive) is RATE_LIMITED, so the dispatcher falls back
  a tier instead of getting a false BACKEND_FAILURE. The example values
  are illustrative — the exact substrings depend on your backend's
  actual error text.

## `routing`

Patterns in both lists follow `docs/PATH-MATCHING.md` (normative): `*`
within a segment, `**` across segments, a literal path matches itself
and everything beneath it, matching is case-insensitive.

- `security_routed` (array of strings): any task whose Touch list
  matches one of these routes KEEP (the in-session lane), no
  exceptions — even a test-only touch of one of these must still be
  declared as Do-NOT-touch. `/lanes-init` proposes this list by grepping
  for auth/authz/availability-style guard files and schema/migration
  paths; you confirm it. May be `[]`, but the key must be present — an
  empty list is a statement, not an accident.
- `do_not_touch` (array of strings): files the DELEGATE lane must never
  modify regardless of task, even when not security-critical (pinned UI
  primitives, lockfiles, secrets). Pipeline-owned paths named by
  `pipeline.*` are already protected structurally and do NOT need to be
  repeated here.

## `review_suite`  (optional — omit the whole block if no e2e/UX suite)

- `suite_command` + `id_pattern`: how the reviewer runs one suite by ID
  (`id_pattern` substitutes the ID into the runner's filename filter —
  mind trailing separators if short IDs are prefixes of longer ones,
  e.g. `s1` matching `s10`).
- `id_index`: the doc whose coverage table maps IDs to spec files.
- `route_map` (object: glob → array of workflow IDs): touched-path glob
  → workflow IDs to run.

Leave the whole block out of your `config.json` entirely if your project
has no separate e2e/UX suite — the reviewer step degrades gracefully to
just the `acceptance_runner`.

## `pipeline`  (defaults shown in the example; override only if your repo differs)

- `plans_dir` / `tasks_dir`: where the planner writes plans and emitted
  task specs.
- `ledger`: the running build-progress log every task appends to.

`/lanes-init` writes the defaults from `config.example.json` unless it
finds an existing `docs/superpowers/` or `.superpowers/sdd/` layout with
different paths.

## Migrating from the legacy `.lanes/config.md`

Projects configured before schema v1 have a free-form Markdown config.
Run `/lanes-doctor`: it detects the legacy file, drafts the JSON
conversion, writes it on your confirmation, and offers to delete the
stale `.md` (recommended — a leftover copy invites drift).
````

- [ ] **Step 4: Commit**

```bash
git add templates/config.example.json templates/config.example.md
git commit -m "docs: config.example.json + schema field reference (config.example.md)"
```

---

### Task 4: `commands/lanes-doctor.md`

**Files:**
- Create: `commands/lanes-doctor.md`

**Interfaces:**
- Consumes: the doctor report shape (Task 2, frozen above); `templates/config.example.json` + `templates/config.example.md` (Task 3).
- Produces: the `/lanes-doctor` command file — the only surface allowed to write `.lanes/config.json` outside `/lanes-init`, and only via the confirmed migration.

- [ ] **Step 1: Create `commands/lanes-doctor.md`** with exactly this content:

````markdown
---
description: >
  Health check for a Lanes project. Validates `.lanes/config.json`
  (schema v1), previews every routing glob against the repo, resolves
  the verification commands against the package manifest, checks the
  clean baseline, and verifies the DELEGATE backend's MCP tools are
  reachable in this session. Also the one-time migration path from a
  legacy `.lanes/config.md`. Writes nothing except the confirmed
  migration.
---

# /lanes-doctor — is this project safe to operate on?

No argument. Run from the root of the Lanes project. Read-only, with
one exception: the confirmed legacy-config migration in Step 0.

## Step 0 — migration gate (before anything else)

Check which config files exist in `.lanes/`:

- **`config.json` exists** (with or without a leftover `config.md`) →
  proceed to Step 1. If a `config.md` is also present, note in the
  final report that it is stale documentation no Lanes surface reads
  anymore — recommend deleting it (a leftover copy invites drift) —
  but do not block on it.
- **Only `config.md` exists** → offer the one-time migration:
  1. Read the legacy file in full. Read
     `${CLAUDE_PLUGIN_ROOT}/templates/config.example.json` (the output
     shape) and `${CLAUDE_PLUGIN_ROOT}/templates/config.example.md`
     (the field reference). Resolve them via Bash, e.g.
     `cat "${CLAUDE_PLUGIN_ROOT}/templates/config.example.json"`.
  2. Draft `.lanes/config.json` (schema v1) from the legacy fields:
     `app_subdir`/`command_prefix` → `project.*`; `test`/`lint`/
     `typecheck`/`acceptance_runner` → `commands.*`; the `backend`
     scalar → `backend.name`; `dispatch_tool`/`reply_tool`/
     `approval_mode`/`tiers` → `backend.*`; `ratelimit_signal` (a
     pipe-separated string) → `backend.ratelimit_signal`, split on the
     pipe character with each substring trimmed; `security_routed`/
     `do_not_touch` → `routing.*`; the `review_suite` block →
     `review_suite.*` (omit the whole block if the legacy file has
     none); `plans_dir`/`tasks_dir`/`ledger` → `pipeline.*`. Carry
     values verbatim — this is a format conversion, not a
     re-inspection. A legacy field you cannot map, or a required field
     the legacy file lacks, is a question for the user — never a
     silent guess.
  3. Show the full draft. Write `.lanes/config.json` ONLY on explicit
     confirmation.
  4. Offer to delete the now-stale `config.md` (recommended). The user
     may decline; note the leftover in the final report.

  Then continue to Step 1 against the new file.
- **Neither exists** → report "not a Lanes project — run `/lanes-init`
  first" and stop.

## Step 1 — deterministic checks

Run (Bash):

    node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" doctor

Its JSON report is the evidence for four checks — `schema`, `globs`,
`commands`, `baseline` — each `pass | warn | fail`, plus a top-level
`verdict` (`ok` | `not_safe`; the process exits 0 only when nothing
failed). Render it readably: one line per check with its status, then
the details of every check that isn't `pass` — each glob's match count
and sample (or its malformed-pattern error), each unresolved command's
note, each dirty path. Do not re-derive any of these by judgment — the
subcommand's output is the authority (matching semantics:
`${CLAUDE_PLUGIN_ROOT}/docs/PATH-MATCHING.md`).

## Step 2 — backend reachability (session-side)

The one check Node cannot do: look at the MCP tools actually callable
in THIS session. Both `backend.dispatch_tool` and `backend.reply_tool`
(`.lanes/config.json`) must be present among them. Missing = WARN, not
fail — the backend may be legitimately offline or the session started
without its MCP server. Say what it means concretely: a DELEGATE
dispatch would fail at the implementer (BACKEND_FAILURE) until the
backend's MCP server is connected; KEEP-lane work is unaffected.

## Step 3 — verdict

Close with exactly one of these lines, then the single next action for
the worst finding:

- **healthy** — every deterministic check passed, backend reachable.
- **healthy, with warnings** — no failures; list each warning on one
  line (zero-match glob, unresolved command, unreachable backend,
  leftover `config.md`).
- **not safe to operate** — any deterministic check failed; name the
  failed check and the one action that unblocks it (fix the named
  config key, commit/stash the dirty paths, run the migration).

## Hard rules

- Never edit `.lanes/config.json` outside the confirmed Step 0
  migration. Never edit `config.md` at all (deleting it, on the user's
  confirmation, is the one allowed operation).
- Never touch project source, specs, plans, or `.lanes/state/`. This
  command diagnoses; it does not repair.
- Never "quickly fix" a failing check — report it and name the action;
  the fix belongs to the user.
````

- [ ] **Step 2: Verify the command file parses as a plugin command**

Run (Bash): `node -e 'const s = require("node:fs").readFileSync("commands/lanes-doctor.md", "utf8"); if (!/^---\ndescription: >/.test(s)) { console.error("FAIL: frontmatter"); process.exit(1); } console.log("OK: frontmatter present");'`
Expected: `OK: frontmatter present`.

- [ ] **Step 3: Commit**

```bash
git add commands/lanes-doctor.md
git commit -m "feat: /lanes-doctor command — render checks, backend reachability, legacy migration"
```

---

### Task 5: `/lanes-init` emits schema-v1 `config.json`

**Files:**
- Modify: `commands/lanes-init.md`

**Interfaces:**
- Consumes: `templates/config.example.json` (Task 3) as the output shape; `templates/config.example.md` as the field reference.
- Produces: init writes `.lanes/config.json`; its no-clobber rule guards that file.

All edits are exact old → new replacements in `commands/lanes-init.md`:

- [ ] **Step 1: Frontmatter and intro**

Replace:

```
  current project (package manifest, verification commands, source tree,
  existing conventions) and drafts `.lanes/config.md` — the one per-project
  file every other Lanes command and agent reads. Refuses below a named
```

with:

```
  current project (package manifest, verification commands, source tree,
  existing conventions) and drafts `.lanes/config.json` — the one per-project
  file every other Lanes command and agent reads. Refuses below a named
```

Replace:

```
operate on. It reads; it does not modify your source. Its only writes are
`.lanes/config.md` (and, optionally, a starter `AGENTS.md`) — both gated by
the no-clobber rule in Phase 3.
```

with:

```
operate on. It reads; it does not modify your source. Its only writes are
`.lanes/config.json` (and, optionally, a starter `AGENTS.md`) — both gated by
the no-clobber rule in Phase 3.
```

- [ ] **Step 2: Phase 1 AGENTS.md bullet**

Replace:

```
  overwrite it in Phase 3 either way; the no-write-to-AGENTS.md-if-present
  rule is separate from and in addition to the `.lanes/config.md`
  no-clobber rule.
```

with:

```
  overwrite it in Phase 3 either way; the no-write-to-AGENTS.md-if-present
  rule is separate from and in addition to the `.lanes/config.json`
  no-clobber rule.
```

- [ ] **Step 3: Phase 3 — no-clobber + emission**

Replace:

```
**No-clobber, checked first.** If `.lanes/config.md` already exists in
this repo, **do not overwrite it.** Report that it already exists and
stop — the same rule the emitter observes for individual spec files. This
check happens before any writing, not after drafting.
```

with:

```
**No-clobber, checked first.** If `.lanes/config.json` already exists in
this repo, **do not overwrite it.** Report that it already exists and
stop — the same rule the emitter observes for individual spec files. This
check happens before any writing, not after drafting. (A repo with only a
legacy `config.md` is not a clobber case — it has no `config.json`; note
that `/lanes-doctor` also offers a direct migration, and proceed only if
the user prefers a fresh init.)
```

Replace:

```
1. Read `${CLAUDE_PLUGIN_ROOT}/templates/config.example.md` in full — it
   is the output shape and the frozen field-name contract. Resolve it via
   Bash, e.g. `cat "${CLAUDE_PLUGIN_ROOT}/templates/config.example.md"`.
2. Write `.lanes/config.md` in the same shape: same section headers, same
   guiding comments (keep them — they are what a future reader uses to
   understand why each field exists), but with the illustrative example
   values replaced by this project's inferred-and-confirmed values from
   Phases 1–2. Every frozen field name in `config.example.md` that applies
   to this project must appear; `review_suite` is the one block that may
   be omitted entirely when Phase 2 confirmed there is no suite.
```

with:

```
1. Read `${CLAUDE_PLUGIN_ROOT}/templates/config.example.json` in full — it
   is the output shape and the frozen field-name contract — and
   `${CLAUDE_PLUGIN_ROOT}/templates/config.example.md`, the field-by-field
   reference explaining what each key means. Resolve them via Bash, e.g.
   `cat "${CLAUDE_PLUGIN_ROOT}/templates/config.example.json"`.
2. Write `.lanes/config.json` as a schema-v1 JSON file in exactly the
   `config.example.json` shape (`schema_version: 1` and the `project`,
   `commands`, `backend`, `routing`, `pipeline` blocks; `review_suite` is
   the one block that may be omitted entirely when Phase 2 confirmed
   there is no suite), with the illustrative example values replaced by
   this project's inferred-and-confirmed values from Phases 1–2. JSON
   carries no comments — the guidance lives in `config.example.md`; do
   not try to embed commentary. `backend.ratelimit_signal` is an array of
   substrings. `""` is allowed for `commands.lint` / `commands.typecheck`
   when the project has no such step.
```

- [ ] **Step 4: Phase 3 — AGENTS.md stub, draft display, next steps**

Replace:

```
   states the stack, the verification commands, and the standing
   do-not-touch list, and points at `.lanes/config.md` as the source of
```

with:

```
   states the stack, the verification commands, and the standing
   do-not-touch list, and points at `.lanes/config.json` as the source of
```

Replace:

```
   `AGENTS.md` already exists, leave it untouched — offer only to note
   where it should reference `.lanes/config.md`, and let the user apply
   that edit themselves.
4. Show the full draft of `.lanes/config.md` (and the `AGENTS.md` stub, if
   offered and accepted) before finishing.
5. Print next steps, in this order: review the draft; commit `.lanes/` and
   `AGENTS.md`; then plan your first effort — lane assignment happens
   during `writing-plans`, per the lanes skill.
```

with:

```
   `AGENTS.md` already exists, leave it untouched — offer only to note
   where it should reference `.lanes/config.json`, and let the user apply
   that edit themselves.
4. Show the full draft of `.lanes/config.json` (and the `AGENTS.md` stub,
   if offered and accepted) before finishing.
5. Print next steps, in this order: review the draft; commit `.lanes/` and
   `AGENTS.md`; run `/lanes-doctor` to verify the config against the
   repo; then plan your first effort — lane assignment happens during
   `writing-plans`, per the lanes skill.
```

- [ ] **Step 5: Report format**

Replace:

```
4. **Files written** — `.lanes/config.md` path, and `AGENTS.md` path if a
   stub was written; or, on the no-clobber path, the single line reporting
   that `.lanes/config.md` already existed and nothing was written.
```

with:

```
4. **Files written** — `.lanes/config.json` path, and `AGENTS.md` path if
   a stub was written; or, on the no-clobber path, the single line
   reporting that `.lanes/config.json` already existed and nothing was
   written.
```

- [ ] **Step 6: Verify no `config.md` reference remains in the file**

Run (Bash): `if grep -n "config\.md" commands/lanes-init.md; then echo "FAIL: legacy reference remains"; exit 1; else echo "OK: lanes-init clean"; fi`
Expected: `OK: lanes-init clean`.

- [ ] **Step 7: Commit**

```bash
git add commands/lanes-init.md
git commit -m "feat: /lanes-init emits schema-v1 config.json"
```

---

### Task 6: Reference sweep — every remaining surface points at `config.json`

**Files:**
- Modify: `agents/lanes-implementer.md`, `agents/lanes-reviewer.md`, `commands/lanes-emit.md`, `skills/lanes/SKILL.md`, `templates/TEMPLATE.md`, `templates/ROUTING.md`, `docs/PATH-MATCHING.md`, `README.md`

**Interfaces:**
- Consumes: nothing new — pure reference repointing.
- Produces: the sweep-clean guarantee in Global Constraints.

- [ ] **Step 1: Mechanical filename swap (replace ALL occurrences per file)**

In each of these seven files, replace every occurrence of the exact string `` `.lanes/config.md` `` with `` `.lanes/config.json` `` (backticks included; use replace-all):

- `agents/lanes-implementer.md` (10 occurrences)
- `agents/lanes-reviewer.md` (10 occurrences)
- `commands/lanes-emit.md` (11 occurrences)
- `skills/lanes/SKILL.md` (4 occurrences)
- `templates/TEMPLATE.md` (9 occurrences)
- `templates/ROUTING.md` (2 occurrences)
- `README.md` (2 occurrences)

(Occurrence counts are as of plan time — verify with the Step 5 sweep, not by trusting the numbers.)

- [ ] **Step 2: Targeted precision edits — implementer's ratelimit wording**

`backend.ratelimit_signal` is now an array of substrings (spec §2); the implementer's STATUS rules should say so. In `agents/lanes-implementer.md`, replace:

```
- **BACKEND_FAILURE**: the `dispatch_tool` or `reply_tool` errored or
  crashed and the response does NOT match the project's
  `ratelimit_signal` (`.lanes/config.json`). Report immediately with the
```

with:

```
- **BACKEND_FAILURE**: the `dispatch_tool` or `reply_tool` errored or
  crashed and the response contains NONE of the substrings in the
  project's `ratelimit_signal` (`.lanes/config.json`). Report immediately with the
```

and replace:

```
- **RATE_LIMITED**: the `dispatch_tool`'s response matches the project's
  `ratelimit_signal` (`.lanes/config.json`) — a rate-limit / usage-cap /
  429-class error. Report immediately with the error text. Do NOT retry,
```

with:

```
- **RATE_LIMITED**: the `dispatch_tool`'s response contains any of the
  substrings in the project's `ratelimit_signal` (`.lanes/config.json`,
  case-insensitive) — a rate-limit / usage-cap / 429-class error.
  Report immediately with the error text. Do NOT retry,
```

- [ ] **Step 3: Targeted precision edit — PATH-MATCHING field paths**

In `docs/PATH-MATCHING.md`, replace:

```
in `.lanes/config.json` (`security_routed`, `do_not_touch`) and in task
```

with:

```
in `.lanes/config.json` (`routing.security_routed`, `routing.do_not_touch`) and in task
```

(The filename itself was already swapped by Step 1.)

- [ ] **Step 4: README — mention the doctor**

In `README.md`, replace:

```
runnable verification command, and a non-trivial source tree (manifest +
README alone isn't enough) — if you're still at that stage, build the
walking skeleton with superpowers first, then come back.
```

with:

```
runnable verification command, and a non-trivial source tree (manifest +
README alone isn't enough) — if you're still at that stage, build the
walking skeleton with superpowers first, then come back.

After init — or any time — run `/lanes-doctor`: it validates the config
against its schema, previews what your security globs actually match,
resolves your verification commands against the manifest, and reports
whether the repo and backend are safe to operate on. It is also the
migration path if your project still has a legacy Markdown config.
```

- [ ] **Step 5: Sweep verification (Bash)**

```bash
hits=$(grep -rln ".lanes/config.md" agents commands skills templates bin hooks README.md docs/PATH-MATCHING.md \
  | grep -v -e "commands/lanes-doctor.md" -e "bin/lanes-validate.mjs" -e "templates/config.example.md" || true)
if [ -n "$hits" ]; then echo "SWEEP FAIL:"; echo "$hits"; exit 1; else echo "SWEEP OK"; fi
```

Expected: `SWEEP OK`. (The three excluded files are the sanctioned mentions: the migration command, the loader's legacy-hint error, the doc's migration note.)

- [ ] **Step 6: Selftest still green**

Run: `node bin/lanes-validate.mjs selftest`
Expected: `selftest OK (17 match vectors + 14 schema vectors + 9 tokenizer vectors + parse checks)`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add agents/lanes-implementer.md agents/lanes-reviewer.md commands/lanes-emit.md skills/lanes/SKILL.md templates/TEMPLATE.md templates/ROUTING.md docs/PATH-MATCHING.md README.md
git commit -m "refactor: point every surface at .lanes/config.json"
```
