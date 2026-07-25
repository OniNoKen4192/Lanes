# Conformance Suite + CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Executable conformance suite (`node --test tests/`) pinning the validator's behavior and the prompt framework's lockstep invariants, plus a GitHub Actions workflow running it on every push/PR.

**Architecture:** Zero-dependency `node:test` suite. Behavioral tests spawn `bin/lanes-validate.mjs` against throwaway fixture git repos; structural tests assert exact strings/shapes over the prose surfaces. CI matrix ubuntu+windows × Node 20/22.

**Tech Stack:** Node built-ins only (`node:test`, `node:assert`, `node:fs`, `node:path`, `node:os`, `node:child_process`).

**Design spec:** `docs/superpowers/specs/2026-07-25-conformance-suite-design.md` — the behavior contract; its §4/§5 numbering is referenced below.

## Global Constraints

- Zero dependencies; no `package.json` is added. The suite runs with `node --test tests/` from the repo root.
- **Never import `bin/lanes-validate.mjs`** (it executes its CLI at module bottom) — spawn it with `process.execPath`, or read its source as text.
- Tests must pass on Windows and Linux: no shell-isms in spawns (use `execFileSync(process.execPath, [...])`), always set `cwd` explicitly, normalize `\` when comparing paths.
- Fixture repos are created under `fs.mkdtempSync(path.join(os.tmpdir(), "lanes-test-"))` and removed in `after()` hooks (`fs.rmSync(dir, { recursive: true, force: true })` in try/catch — Windows file locks must not fail the suite).
- Fixture git repos need `git init -q` + local `user.email`/`user.name` config before committing; never touch global git config.
- The suite never modifies the real repo checkout — structural tests are read-only; behavioral tests operate only inside fixture dirs.
- Existing files (`bin/`, `hooks/`, agents, commands, templates) are NOT modified by this slice. Only `tests/**` and `.github/workflows/ci.yml` are created.
- `node bin/lanes-validate.mjs selftest` and `node --test tests/` must both be green at every task's commit.

---

### Task 1: `tests/helpers.mjs` + behavioral suite `tests/validator.test.mjs`

**Files:**
- Create: `tests/helpers.mjs`
- Create: `tests/validator.test.mjs`

**Interfaces:**
- Produces (helpers, consumed by both test files):
  - `repoRoot` — absolute path to the Lanes checkout, resolved as `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")`.
  - `read(relPath) → string` — read a file from the real checkout (utf8).
  - `makeFixtureRepo(opts?) → { dir, git(...args), commit(msg), cleanup() }` — per spec §3.
  - `validate(dir, ...args) → { status, stdout, json }` — spawn the validator; `json` is `JSON.parse` of stdout when parseable, else `null`; never throws on non-zero exit (catch, use `err.status`/`err.stdout`).

- [ ] **Step 1: Write `tests/helpers.mjs`** with exactly this content:

```js
// Shared helpers for the Lanes conformance suite. Zero dependencies.
// Behavioral tests spawn bin/lanes-validate.mjs (never import it — the
// file executes its CLI at module bottom).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALIDATOR = path.join(repoRoot, "bin", "lanes-validate.mjs");

export function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

export const FIXTURE_CONFIG = {
  schema_version: 1,
  project: { app_subdir: "", command_prefix: "" },
  commands: {
    test: "node run-tests.mjs",
    lint: "",
    typecheck: "",
    acceptance_runner: "node run-tests.mjs",
  },
  backend: {
    name: "codex-mcp",
    dispatch_tool: "mcp__codex__codex",
    reply_tool: "mcp__codex__codex-reply",
    approval_mode: "pilot",
    tiers: ["alpha", "beta"],
    ratelimit_signal: ["429"],
  },
  routing: { security_routed: ["src/auth.ts"], do_not_touch: [".env"] },
  pipeline: { plans_dir: "docs/plans", tasks_dir: "docs/tasks", ledger: "docs/progress.md" },
};

export const FIXTURE_SPEC = `# TASK: fixture
## Meta
- **Task ID**: T1
- **Parent plan**: docs/plans/p.md
- **Depends on**: none
- **Estimated scope**: S
- **Model hint**: beta

## Files

### Touch
| Path | Action | Notes |
|------|--------|-------|
| \`src/lib/thing.js\` | modify | change X |
| \`src/lib/thing.test.js\` | create | acceptance |

### Do NOT touch
- everything else
`;

export function makeFixtureRepo(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-test-"));
  const git = (...args) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trimEnd();
  git("init", "-q");
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "fixture");
  const config = structuredClone(FIXTURE_CONFIG);
  if (opts.patchConfig) opts.patchConfig(config);
  fs.mkdirSync(path.join(dir, ".lanes"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src", "lib"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs", "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".lanes", "config.json"), JSON.stringify(config, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "node run-tests.mjs" } }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "src", "lib", "thing.js"), "export const thing = 1;\n");
  fs.writeFileSync(path.join(dir, "src", "auth.ts"), "export const guard = true;\n");
  fs.writeFileSync(path.join(dir, "docs", "tasks", "T1.md"), opts.spec ?? FIXTURE_SPEC);
  const commit = (msg) => { git("add", "-A"); git("commit", "-qm", msg); };
  commit("fixture baseline");
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
  return { dir, git, commit, cleanup };
}

export function validate(dir, ...args) {
  try {
    const stdout = execFileSync(process.execPath, [VALIDATOR, ...args], { cwd: dir, encoding: "utf8" });
    return { status: 0, stdout, json: tryParse(stdout) };
  } catch (err) {
    const stdout = String(err.stdout || "");
    return { status: err.status ?? -1, stdout, json: tryParse(stdout) };
  }
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
```

- [ ] **Step 2: Write `tests/validator.test.mjs`** implementing spec §4 exactly. Structure: `import { test, describe, after } from "node:test";` + `node:assert/strict`. Each test creates its own fixture (or a `describe`-scoped one) and registers `after(() => fx.cleanup())`. The complete assertion list — implement every row; the Expected column is normative:

| Test name | Setup | Run | Expected |
|---|---|---|---|
| `selftest passes` | none | `validate(repoRoot, "selftest")` | `status === 0`, stdout includes `selftest OK` |
| `gate: golden spec passes and records state` | default fixture | `gate --spec docs/tasks/T1.md` | `status 0`; `json.ok === true`, `json.task === "T1"`; file `.lanes/state/T1.json` exists in fixture; parsed state has `base_sha` (40 hex), `touch` array containing `src/lib/thing.js`, `spec_sha256` (64 hex) |
| `audit: in-scope edit is clean` | after golden gate, append to `src/lib/thing.js` | `audit --task T1` | `status 0`; `json.verdict === "clean"`, `json.in_scope` includes `src/lib/thing.js` |
| `gate: keep-hinted spec refused` | fixture with `opts.spec` = FIXTURE_SPEC with `Model hint\*\*: beta` → `keep` | gate | `status 2`, `json.check === "routing"` |
| `gate: traversal Touch path refused` | spec with an extra Touch row `\`../escape.js\`` | gate | `status 2`, `json.check === "security_gate"` |
| `gate: security_routed Touch refused` | spec with extra Touch row `\`src/auth.ts\`` | gate | `status 2`, `json.check === "security_gate"`, `json.list === "security_routed"`, `json.pattern === "src/auth.ts"` |
| `gate: dirty tree blocks` | default fixture + write uncommitted `src/stray.js` | gate | `status 2`, `json.check === "clean_baseline"`, `json.dirty` includes `src/stray.js` |
| `audit: out-of-scope edit flagged` | golden gate, then write `src/other.js` | audit | `status 2`, verdict `violations`, `json.out_of_scope` includes `src/other.js` |
| `audit: delegate commit flagged` | golden gate, edit thing.js, `commit("delegate crime")` | audit | `status 2`, verdict `violations`, `json.commits_past_base.length === 1` |
| `audit: spec edited after dispatch flagged` | golden gate, append a line to `docs/tasks/T1.md` | audit | `status 2`, `json.spec_modified === true`, verdict `violations` |
| `audit: forbidden edit flagged` | golden gate, append to `.env` (create it via fixture opts? no — create `.env` file BEFORE baseline commit by adding `fs.writeFileSync(dir/.env)` — simpler: write `.env` then `commit("add env")` then gate then edit `.env`) | audit | `status 2`, `json.forbidden` has entry with `list === "do_not_touch"`, `path === ".env"` |
| `gate: schema-invalid config fails closed` | `patchConfig: (c) => { c.bogus = 1; }` | gate | `status 2`, `json.check === "config"`, reason includes `unknown key 'bogus'` |
| `doctor: schema-invalid config → not_safe, checks skipped` | same patch | doctor | `status 2`, `json.verdict === "not_safe"`, `checks.schema.status === "fail"`, `checks.globs.status === "fail"` |
| `doctor: malformed glob fails` | `patchConfig: (c) => { c.routing.security_routed.push("../x"); }` | doctor | `status 2`, `checks.globs.status === "fail"`, a patterns entry with `pattern === "../x"` and an `error` |
| `doctor: clean fixture is ok` | default fixture | doctor | `status 0`, `json.verdict === "ok"`, globs entry for `src/auth.ts` has `matches === 1`; `checks.commands.commands.length === 4` |

Implementation notes (binding):
- Build variant specs with `FIXTURE_SPEC.replace(...)` — e.g. keep-hint via `.replace("**Model hint**: beta", "**Model hint**: keep")`; extra Touch rows by replacing the `| \`src/lib/thing.test.js\`` row's line with itself plus the new row.
- The `.env` forbidden test: create `.env` and commit it as part of setup (post-`makeFixtureRepo`, pre-gate), then modify it after the gate.
- Path comparisons: audit/gate JSON already uses `/`-normalized repo-relative paths — compare against `/` literals.

- [ ] **Step 3: Run the suite**

Run: `node --test tests/` (repo root)
Expected: all tests pass (15 tests), exit 0. Also run `node bin/lanes-validate.mjs selftest` — still green.

- [ ] **Step 4: Commit**

```bash
git add tests/helpers.mjs tests/validator.test.mjs
git commit -m "test: behavioral conformance suite — gate/audit/doctor fixtures (node --test)"
```

---

### Task 2: Structural suite `tests/conformance.test.mjs`

**Files:**
- Create: `tests/conformance.test.mjs`

**Interfaces:**
- Consumes: `read`, `repoRoot` from `tests/helpers.mjs` (Task 1).

- [ ] **Step 1: Write `tests/conformance.test.mjs`** implementing spec §5. Use `node:test` + `node:assert/strict`; read files via helpers. The parser snippets below are normative code; the rest is a binding assertion list.

**§5.9 MATCH_VECTORS ↔ PATH-MATCHING.md — use exactly this extraction logic:**

```js
function sourceVectors() {
  const src = read("bin/lanes-validate.mjs");
  const block = src.match(/const MATCH_VECTORS = \[([\s\S]*?)\n\];/)[1];
  const rows = block
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => l.startsWith("["))
    .map((l) => l.replace(/,\s*$/, ""));
  return rows.map((r) => JSON.parse(r));
}

function docVectors() {
  const md = read("docs/PATH-MATCHING.md");
  const section = md.split(/^## Examples.*$/m)[1];
  const out = [];
  for (const m of section.matchAll(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*(yes|no)\s*\|/gm)) {
    out.push([m[1], m[2], m[3] === "yes"]);
  }
  return out;
}
```

Assert: both lists non-empty, same length, and set-equal (serialize each triple as `JSON.stringify` and compare sorted arrays). Note the `src\components\ui\button.tsx` row: the source line `["src/components/ui/**", "src\\components\\ui\\button.tsx", true],` JSON-parses to a single-backslash string, which equals the md cell's literal text — no special-casing needed.

**§5.6 taxonomy lockstep — use exactly this:**

```js
const ENUM = "IMPLEMENTED | IMPLEMENTED_WITH_DEVIATIONS | BLOCKED | BACKEND_FAILURE | RATE_LIMITED";
const count = (text, needle) => text.split(needle).length - 1;
```

Assert `count(read("agents/lanes-implementer.md"), ENUM) === 1`, same `=== 1` for `templates/TEMPLATE.md`, `=== 0` for `agents/lanes-reviewer.md`. Standalone-DONE check: for every file in agents/, commands/, skills/ (recursive), templates/, plus README.md, assert `!/\bDONE\b/.test(content)` (JS `\b` treats `_` as a word char, so `DONE` inside `SOMETHING_DONE`/`DONE_X` would not match — but there are none; the assertion bans the bare token). Pairing rule presence: implementer contains `DEVIATIONS is "none"` and `DEVIATIONS must be non-empty`; reviewer contains `IMPLEMENTED requires DEVIATIONS "none"` and `requires a non-empty DEVIATIONS list`.

**Remaining assertions (binding list; one `test()` per spec item):**

- §5.1 manifest: `.claude-plugin/plugin.json` parses; `name === "lanes"`; `/^\d+\.\d+\.\d+$/.test(version)`; description non-empty.
- §5.2 hooks lockstep: `hooks/hooks.json` parses; `hooks.PreToolUse.length === 1`; its `matcher` === `JSON.parse(read("templates/config.example.json")).backend.dispatch_tool`; the inner command includes `hooks/lanes-dispatch-gate.mjs` and that file exists.
- §5.3 frontmatter: for each file matching `agents/*.md`, `commands/*.md`, and `skills/lanes/SKILL.md` (enumerate with `fs.readdirSync`): content starts with `---\n`; the frontmatter block (up to the next `\n---`) contains `description:`; agents' and the skill's frontmatter also contains `name:`.
- §5.4 cross-references: scan the same file set plus `templates/*.md` for `/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_\-./]+)/g`; for each captured path, `fs.existsSync(path.join(repoRoot, captured))`. Strip trailing punctuation not in the char class (the regex already excludes backticks/quotes/parens).
- §5.5 vocabulary sync: declare `const VOCAB = { project: ["app_subdir","command_prefix"], commands: ["test","lint","typecheck","acceptance_runner"], backend: ["name","dispatch_tool","reply_tool","approval_mode","tiers","ratelimit_signal"], routing: ["security_routed","do_not_touch"], review_suite: ["suite_command","id_pattern","id_index","route_map"], pipeline: ["plans_dir","tasks_dir","ledger"] }`. Assert: (a) config.example.json's top-level keys are exactly `["schema_version", ...Object.keys(VOCAB)]` and each block's keys exactly match its VOCAB list; (b) the validator source's `SCHEMA_V1 = {...}` block (regex-extract between `const SCHEMA_V1 = {` and `\n};`) contains every block name and every field name as a substring, and no field name in the block text is absent from VOCAB (extract candidate keys with `/^\s{2,}([a-z_]+):/gm` from the block and check membership); (c) `templates/config.example.md` contains a `## \`<block>\`` heading for every VOCAB block plus `## \`schema_version\``; (d) `commands/lanes-doctor.md` contains every legacy field name: app_subdir, command_prefix, test, lint, typecheck, acceptance_runner, dispatch_tool, reply_tool, approval_mode, tiers, ratelimit_signal, security_routed, do_not_touch, review_suite, plans_dir, tasks_dir, ledger, and the string `schema_version: 1`; (e) `commands/lanes-init.md` contains each of: `` `project` ``, `` `commands` ``, `` `backend` ``, `` `routing` ``, `` `pipeline` ``, `` `review_suite` ``, `schema_version: 1`.
- §5.7 config-path sweep: for every file under agents/, commands/, skills/, templates/, bin/, hooks/, plus README.md and docs/PATH-MATCHING.md: content containing `.lanes/config.md` is allowed only for `commands/lanes-doctor.md`, `bin/lanes-validate.mjs`, `templates/config.example.md`.
- §5.8 template shape: extract the fenced template (between the first ` ````markdown ` line and the next ` ```` ` line in `templates/TEMPLATE.md`); assert each of `## Meta`, `## Objective`, `## Context`, `## Files`, `### Touch`, `### Do NOT touch`, `## Interfaces`, `## Constraints`, `## Acceptance`, `## Out of Scope`, `## Report Format` occurs exactly once in it (count with the `count` helper on `"\n" + section` prefix matching `\n## ...` to avoid substring collisions — e.g. `## Files` vs `### Files`: count occurrences of the exact heading line via regex `new RegExp("^" + escaped + "\\s*$", "m")` … simpler and binding: count matches of `` new RegExp("^" + heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "gm") `` and assert exactly 1).
- §5.10 routing representation: ROUTING.md contains `**(a)`, `**(b)`, `**(c)`; reviewer contains `automatic REJECT` and `security_routed`; TEMPLATE.md contains `Model hint: keep` and Emission Rule 7's `security_routed`; lanes-emit.md contains `ROUTING.md` and `the single routing authority` OR `routing authority` (assert `includes("ROUTING.md")` and `includes("routing authority")` — both present today in its description/step 3).
- §5.11 fixture leakage: for agents/, commands/, skills/ (recursive), `templates/TEMPLATE.md`, `templates/ROUTING.md`, README.md: assert content includes neither `wisconsin-ice-exchange` (case-insensitive) nor `/\bWIX\b/`.

- [ ] **Step 2: Run the suite**

Run: `node --test tests/`
Expected: all Task 1 + Task 2 tests pass, exit 0.

- [ ] **Step 3: Mutation spot-checks (testing the tests — spec §8)**

For each category below: apply the temporary mutation with a scripted edit, run `node --test tests/`, assert it FAILS, then `git checkout -- <file>` and confirm the suite is green again. Record each in the report.

1. `agents/lanes-reviewer.md`: append a line containing the five-status ENUM → §5.6 test fails.
2. `templates/config.example.json`: rename `"tiers"` to `"tierz"` → §5.5 fails.
3. `hooks/hooks.json`: change matcher to `mcp__other__tool` → §5.2 fails.
4. `docs/PATH-MATCHING.md`: flip one `yes` to `no` in the examples table → §5.9 fails.
5. `templates/TEMPLATE.md`: duplicate the `## Acceptance` heading inside the fence → §5.8 fails.

- [ ] **Step 4: Commit**

```bash
git add tests/conformance.test.mjs
git commit -m "test: structural conformance — vocabulary, taxonomy, lockstep, template shape"
```

---

### Task 3: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`** with exactly:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  conformance:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
        node: [20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - name: Validator selftest
        run: node bin/lanes-validate.mjs selftest
      - name: Conformance suite
        run: node --test tests/
```

- [ ] **Step 2: Local verification**

Run: `node bin/lanes-validate.mjs selftest && node --test tests/`
Expected: both green (CI runs the same two commands).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: conformance suite + selftest on push/PR (ubuntu+windows, node 20/22)"
```
