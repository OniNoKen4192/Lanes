# Deterministic Scope Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the validator (`bin/lanes-validate.mjs`), the PreToolUse dispatch hook, the normative path-matching doc, and the prompt updates that move Lanes' scope/security boundaries from prose into deterministic machinery (issues #1, #2, #7).

**Architecture:** One self-contained zero-dependency Node ESM script holds the glob matcher, config/spec parsers, `gate` (pre-dispatch check + baseline capture to `.lanes/state/`), `audit` (four-surface post-task scope report), and `selftest`. A small hook script wraps `gate` behind Claude Code's PreToolUse hook on the dispatch tool, keyed on a `LANES-SPEC:` header line in the dispatch prompt. Three prompt files are updated to consume the validator's JSON instead of eyeballing `git status`.

**Tech Stack:** Node ≥ 18 (ESM, `node:fs`, `node:child_process`, `node:crypto`), git plumbing (`--porcelain`, `--name-status`), Claude Code plugin hooks (`hooks/hooks.json`, `${CLAUDE_PLUGIN_ROOT}`).

**Design spec:** `docs/superpowers/specs/2026-07-24-scope-gate-design.md` — the authority on behavior. Section references below (§3, §6, …) point there.

## Global Constraints

- Zero npm dependencies; no `package.json` is added to the repo. Plain JavaScript only — no TypeScript syntax anywhere.
- All machine-readable output is JSON on **stdout**. Exit codes: `0` = pass/clean, `2` = block/violations/any error (fail closed). `1` only for CLI usage errors (unknown subcommand).
- Path matching is case-insensitive, `\` normalized to `/`, per §6. The matcher code, the `selftest` vectors, and the `docs/PATH-MATCHING.md` examples table must agree exactly — when you change one, change all three.
- Fail closed everywhere: git failure, missing state, unparseable config → block, never warn-and-continue (§3.4).
- Prompt-file edits preserve each file's existing voice and formatting (indented code blocks, bold-lead list items).
- Commit after every task. Messages follow repo convention (`feat:`/`fix:`/`docs:`), ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Run all verification commands from the repo root (`s:\Lanes`) with the Bash tool unless a step says otherwise.

---

### Task 1: Glob matcher + selftest harness

**Files:**
- Create: `bin/lanes-validate.mjs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces (used by Tasks 3–5):
  - `normalizePath(p: string): string` — trims, `\`→`/`, strips leading `./`, strips trailing `/`.
  - `matchesPattern(pattern: string, path: string): boolean` — §6 semantics.
  - `matchAny(patterns: string[], path: string): string | null` — first matching pattern, else null.
  - `MATCH_VECTORS: [pattern, path, expected][]` — the selftest table.
  - CLI skeleton: `node bin/lanes-validate.mjs selftest` runs vectors, exit 0/2.

- [ ] **Step 1: Create the file with vectors and a stub matcher (red)**

Create `bin/lanes-validate.mjs`:

```js
#!/usr/bin/env node
// lanes-validate — deterministic scope gate for the Lanes pipeline.
// Subcommands: gate --spec <path> | audit --task <id> | selftest
// Behavior spec: docs/superpowers/specs/2026-07-24-scope-gate-design.md
// Matching semantics: docs/PATH-MATCHING.md (normative; keep in sync
// with MATCH_VECTORS below — the conformance suite will assert it).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------- matching

function normalizePath(p) {
  let out = String(p).trim().replace(/\\/g, "/");
  if (out.startsWith("./")) out = out.slice(2);
  while (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

function matchesPattern(pattern, p) {
  return false; // stub — implemented in Step 3
}

function matchAny(patterns, p) {
  for (const pat of patterns) if (matchesPattern(pat, p)) return pat;
  return null;
}

// Mirrors the examples table in docs/PATH-MATCHING.md — keep in sync.
const MATCH_VECTORS = [
  // [pattern, path, expected]
  ["src/auth.ts", "src/auth.ts", true],
  ["src/auth.ts", "SRC/Auth.ts", true],                       // case-insensitive (§6.2)
  ["src/auth.ts", "src/auth.ts.bak", false],
  ["prisma/migrations", "prisma/migrations", true],           // bare dir = itself…
  ["prisma/migrations", "prisma/migrations/0001/m.sql", true],// …plus everything beneath (§6.3)
  ["prisma/migrations", "prisma/migrations2/x.sql", false],
  ["prisma/migrations/**", "prisma/migrations/0001/m.sql", true],
  ["prisma/migrations/**", "prisma/migrations", false],       // `/**` is strictly beneath
  ["src/components/ui/**", "src\\components\\ui\\button.tsx", true], // `\` normalization (§6.1)
  ["*.md", "README.md", true],
  ["*.md", "docs/README.md", false],                          // `*` never crosses `/`
  ["**/*.test.ts", "src/lib/x.test.ts", true],
  ["**/*.test.ts", "x.test.ts", true],                        // leading `**/` matches zero segments
  ["src/?pi.ts", "src/api.ts", true],
  ["src/?pi.ts", "src/a/pi.ts", false],                       // `?` is one non-`/` char
  [".env", ".env", true],
  [".env", ".env.example", false],                            // bare file ≠ prefix match
];

// ---------------------------------------------------------------- selftest

function runSelftest() {
  let failures = 0;
  for (const [pattern, p, expected] of MATCH_VECTORS) {
    const got = matchesPattern(pattern, p);
    if (got !== expected) {
      failures++;
      console.error(`FAIL match(${JSON.stringify(pattern)}, ${JSON.stringify(p)}) -> ${got}, expected ${expected}`);
    }
  }
  console.log(failures === 0
    ? `selftest OK (${MATCH_VECTORS.length} match vectors)`
    : `selftest: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 2);
}

// ---------------------------------------------------------------- CLI

const [cmd, ...rest] = process.argv.slice(2);
function argOf(flag) {
  const i = rest.indexOf(flag);
  return i >= 0 ? rest[i + 1] : undefined;
}

try {
  if (cmd === "selftest") runSelftest();
  else {
    console.error("usage: lanes-validate.mjs <gate --spec <path> | audit --task <id> | selftest>");
    process.exit(1);
  }
} catch (err) {
  // fail closed: any unexpected error is a block, reported as JSON
  console.log(JSON.stringify({ ok: false, check: "error", reason: String((err && err.message) || err) }));
  process.exit(2);
}
```

- [ ] **Step 2: Run selftest to verify it fails**

Run: `node bin/lanes-validate.mjs selftest`
Expected: FAIL lines for every `expected: true` vector, exit code 2.

- [ ] **Step 3: Implement the matcher**

Replace the stub `matchesPattern` with:

```js
function globToRegExp(pattern) {
  let rx = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") { rx += "(?:[^/]+/)*"; i += 3; } // `**/` — zero or more whole segments
        else { rx += ".*"; i += 2; }                                 // trailing `**` — anything, crossing `/`
      } else { rx += "[^/]*"; i += 1; }                              // `*` — within one segment
    } else if (c === "?") { rx += "[^/]"; i += 1; }                  // `?` — one non-`/` char
    else { rx += c.replace(/[.+^${}()|[\]\\]/g, "\\$&"); i += 1; }
  }
  return new RegExp("^" + rx + "$", "i");
}

function matchesPattern(pattern, p) {
  const pat = normalizePath(pattern);
  const target = normalizePath(p);
  if (!/[*?]/.test(pat)) {
    // Literal pattern: matches the path itself and anything beneath it (§6.3).
    const esc = pat.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    return new RegExp("^" + esc + "(/|$)", "i").test(target);
  }
  return globToRegExp(pat).test(target);
}
```

- [ ] **Step 4: Run selftest to verify it passes**

Run: `node bin/lanes-validate.mjs selftest`
Expected: `selftest OK (17 match vectors)`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add bin/lanes-validate.mjs
git commit -m "feat: lanes-validate matcher + selftest (scope gate, task 1)"
```

---

### Task 2: Normative path-matching doc

**Files:**
- Create: `docs/PATH-MATCHING.md`

**Interfaces:**
- Consumes: `MATCH_VECTORS` from Task 1 — the examples table must mirror it row for row.
- Produces: the doc that `bin/lanes-validate.mjs`'s header comment and the reviewer prompt (Task 7) reference.

- [ ] **Step 1: Write the doc**

Create `docs/PATH-MATCHING.md`:

```markdown
# Path-matching semantics (normative)

How a changed or Touch-listed path is matched against the glob patterns
in `.lanes/config.md` (`security_routed`, `do_not_touch`) and in task
specs. `bin/lanes-validate.mjs` implements exactly these rules; its
`selftest` subcommand runs the examples table below as test vectors.
Agents never re-derive glob matches by judgment — the validator's output
is the matching authority.

## Rules

1. **Normalization.** Paths are repo-relative (relative to the git
   toplevel, not `app_subdir`). `\` is normalized to `/`. A leading `./`
   is stripped; trailing `/` is stripped. A path containing `..` or an
   absolute path is refused outright (it escapes the repo).
2. **Case-insensitive.** Matching ignores case. A security deny-list
   must not be dodgeable via `SRC/Auth.ts` on the case-insensitive
   filesystems most users run (Windows, macOS).
3. **Dialect.**
   - `*` matches within one segment (never crosses `/`).
   - `?` matches exactly one non-`/` character.
   - `**` crosses segments; a leading `**/` also matches zero segments.
   - `dir/**` matches everything strictly beneath `dir`, not `dir` itself.
   - A **literal pattern** (no `*`/`?`) matches the named path itself
     **and everything beneath it** — `prisma/migrations` behaves like
     gitignore's directory rule. A literal file pattern therefore matches
     only itself (`.env` does not match `.env.example`).
4. **Renames/copies.** Git `R*`/`C*` statuses contribute **both** sides
   as changed paths. A rename into a forbidden directory trips the gate,
   and so does a rename out of one.
5. **Symlinks.** A symlink is matched by its link path, not its target.
   A Touch path that is a symlink resolving outside the repo is a gate
   refusal.
6. **Submodules.** Submodule paths are opaque. A Touch path inside a
   submodule is a gate refusal — Lanes does not operate across submodule
   boundaries.
7. **Precedence.** Deny beats allow: a path matching `security_routed`
   or `do_not_touch` is forbidden even if it also matches a spec's Touch
   list or a pipeline allowlist entry.

## Examples (= `selftest` vectors)

| Pattern | Path | Match? | Rule |
|---|---|---|---|
| `src/auth.ts` | `src/auth.ts` | yes | literal |
| `src/auth.ts` | `SRC/Auth.ts` | yes | 2 (case) |
| `src/auth.ts` | `src/auth.ts.bak` | no | literal ≠ prefix |
| `prisma/migrations` | `prisma/migrations` | yes | 3 (literal dir: itself) |
| `prisma/migrations` | `prisma/migrations/0001/m.sql` | yes | 3 (literal dir: beneath) |
| `prisma/migrations` | `prisma/migrations2/x.sql` | no | segment boundary |
| `prisma/migrations/**` | `prisma/migrations/0001/m.sql` | yes | 3 (`**`) |
| `prisma/migrations/**` | `prisma/migrations` | no | 3 (`/**` strictly beneath) |
| `src/components/ui/**` | `src\components\ui\button.tsx` | yes | 1 (`\` → `/`) |
| `*.md` | `README.md` | yes | 3 (`*`) |
| `*.md` | `docs/README.md` | no | 3 (`*` ≠ `/`) |
| `**/*.test.ts` | `src/lib/x.test.ts` | yes | 3 (`**`) |
| `**/*.test.ts` | `x.test.ts` | yes | 3 (leading `**/` = zero segs) |
| `src/?pi.ts` | `src/api.ts` | yes | 3 (`?`) |
| `src/?pi.ts` | `src/a/pi.ts` | no | 3 (`?` ≠ `/`) |
| `.env` | `.env` | yes | literal |
| `.env` | `.env.example` | no | literal ≠ prefix |
```

- [ ] **Step 2: Verify doc/vector agreement**

Manually compare the table rows against `MATCH_VECTORS` in `bin/lanes-validate.mjs` — same 17 cases, same expected results. Then run `node bin/lanes-validate.mjs selftest` (still exit 0).

- [ ] **Step 3: Commit**

```bash
git add docs/PATH-MATCHING.md
git commit -m "docs: normative path-matching spec (scope gate, task 2)"
```

---

### Task 3: Config and spec parsers

**Files:**
- Modify: `bin/lanes-validate.mjs`

**Interfaces:**
- Consumes: Task 1's `normalizePath`.
- Produces (used by Tasks 4–5):
  - `parseConfig(text: string): { scalars: Record<string,string>, lists: Record<string,string[]> }`
  - `loadConfig(): { security_routed: string[], do_not_touch: string[], tasks_dir: string, plans_dir: string, ledger: string }` — throws if `.lanes/config.md` is missing or either required list is absent (fail closed).
  - `parseSpec(text: string): { taskId?: string, modelHint?: string, touch: string[] }`

- [ ] **Step 1: Add parser selftest vectors (red)**

In `bin/lanes-validate.mjs`, insert above `runSelftest`:

```js
// ---------------------------------------------------------------- parse checks

const SAMPLE_CONFIG = `# Lanes config
<!-- comment spanning
lines -->
## App root
app_subdir: myapp
command_prefix: cd myapp &&

test: pnpm vitest run
approval_mode: pilot    # trailing comment

security_routed:
  - src/auth.ts
  - prisma/migrations/**

do_not_touch:
  - pnpm-lock.yaml
  - .env

tasks_dir: docs/superpowers/tasks
`;

const SAMPLE_SPEC = `# TASK: sample
## Meta
- **Task ID**: DEMO.03
- **Parent plan**: docs/superpowers/plans/x.md
- **Model hint**: luna

## Files

### Touch
| Path | Action | Notes |
|------|--------|-------|
| \`src/lib/example.ts\` | modify | add X |
| \`src/lib/__tests__/example.test.ts\` | create | see Acceptance |

### Do NOT touch
- everything else
`;

function runParseChecks() {
  let failures = 0;
  const expect = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures++;
      console.error(`FAIL ${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
  };
  const cfg = parseConfig(SAMPLE_CONFIG);
  expect("config.security_routed", cfg.lists.security_routed, ["src/auth.ts", "prisma/migrations/**"]);
  expect("config.do_not_touch", cfg.lists.do_not_touch, ["pnpm-lock.yaml", ".env"]);
  expect("config.tasks_dir", cfg.scalars.tasks_dir, "docs/superpowers/tasks");
  expect("config.approval_mode", cfg.scalars.approval_mode, "pilot"); // trailing comment stripped
  const spec = parseSpec(SAMPLE_SPEC);
  expect("spec.taskId", spec.taskId, "DEMO.03");
  expect("spec.modelHint", spec.modelHint, "luna");
  expect("spec.touch", spec.touch, ["src/lib/example.ts", "src/lib/__tests__/example.test.ts"]);
  return failures;
}
```

And wire it into `runSelftest` — change:

```js
  let failures = 0;
```

to:

```js
  let failures = runParseChecks();
```

and change the OK message to:

```js
    ? `selftest OK (${MATCH_VECTORS.length} match vectors + parse checks)`
```

- [ ] **Step 2: Run selftest to verify it fails**

Run: `node bin/lanes-validate.mjs selftest`
Expected: exit 2 — `parseConfig is not defined` (surfaces via the fail-closed JSON error since the throw happens inside `runSelftest`; either the JSON error or FAIL lines count as red here).

- [ ] **Step 3: Implement the parsers**

Insert above the parse-checks section:

```js
// ---------------------------------------------------------------- parsing

// Minimal, targeted parse of .lanes/config.md (full schema migration is
// issue #5). Recognizes top-level `key: value` scalars and `key:` +
// indented `- item` lists. Markdown headings, HTML comments, and
// trailing `# …` comments are stripped.
function parseConfig(text) {
  const stripped = text.replace(/<!--[\s\S]*?-->/g, "");
  const scalars = {};
  const lists = {};
  let currentList = null;
  for (const raw of stripped.split(/\r?\n/)) {
    const line = raw.replace(/\s#.*$/, "").trimEnd();
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && currentList) { lists[currentList].push(item[1].trim()); continue; }
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) {
      const [, key, value] = kv;
      if (value === "") { lists[key] = []; currentList = key; }
      else { scalars[key] = value.trim(); currentList = null; }
    } else {
      currentList = null;
    }
  }
  return { scalars, lists };
}

function loadConfig() {
  const p = ".lanes/config.md";
  if (!fs.existsSync(p)) throw new Error(".lanes/config.md not found — run /lanes-init first");
  const { scalars, lists } = parseConfig(fs.readFileSync(p, "utf8"));
  for (const key of ["security_routed", "do_not_touch"]) {
    if (!Array.isArray(lists[key])) {
      throw new Error(`.lanes/config.md: required list '${key}' is missing or unparseable`);
    }
  }
  return {
    security_routed: lists.security_routed,
    do_not_touch: lists.do_not_touch,
    tasks_dir: scalars.tasks_dir || "docs/superpowers/tasks",
    plans_dir: scalars.plans_dir || "docs/superpowers/plans",
    ledger: scalars.ledger || ".superpowers/sdd/progress.md",
  };
}

// Extracts what the gate/audit need from a TEMPLATE.md-conformant spec:
// Task ID and Model hint from Meta, Touch paths from the `### Touch` table.
function parseSpec(text) {
  const taskId = (text.match(/^\s*-\s+\*\*Task ID\*\*:\s*(\S+)/m) || [])[1];
  const modelHint = (text.match(/^\s*-\s+\*\*Model hint\*\*:\s*(\S+)/m) || [])[1];
  const touchSection = (text.split(/^### Touch\s*$/m)[1] || "").split(/^### /m)[0];
  const touch = [];
  for (const m of touchSection.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)) touch.push(m[1]);
  return { taskId, modelHint, touch };
}
```

- [ ] **Step 4: Run selftest to verify it passes**

Run: `node bin/lanes-validate.mjs selftest`
Expected: `selftest OK (17 match vectors + parse checks)`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add bin/lanes-validate.mjs
git commit -m "feat: config + spec parsers in lanes-validate (scope gate, task 3)"
```

---

### Task 4: `gate` subcommand

**Files:**
- Modify: `bin/lanes-validate.mjs`

**Interfaces:**
- Consumes: `matchAny`, `normalizePath` (Task 1); `loadConfig`, `parseSpec` (Task 3).
- Produces (used by Task 5's audit, Task 6's hook, Task 7's prompts):
  - CLI: `node bin/lanes-validate.mjs gate --spec <path>` — exit 0 pass / 2 block; JSON on stdout.
  - Pass output: `{ ok: true, task, base_sha, state_path }`.
  - Fail output: `{ ok: false, check: "config"|"spec"|"routing"|"clean_baseline"|"security_gate"|"error", reason, ...details }`.
  - State file `.lanes/state/<task-id>.json`: `{ task, spec_path, spec_sha256, base_sha, dispatched_at }` (§5).
  - Helpers: `git(...args)`, `statusPaths(porcelainLine)`, `submodulePaths()`, `sha256(buf)`.

- [ ] **Step 1: Implement `gate`**

Insert above the CLI section:

```js
// ---------------------------------------------------------------- git

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trimEnd();
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// One `git status --porcelain` line → the path(s) it names.
// Renames arrive as "R  old -> new"; quoted paths lose their quotes.
function statusPaths(line) {
  const unquote = (s) => s.replace(/^"(.*)"$/, "$1");
  const body = line.slice(3);
  return (body.includes(" -> ") ? body.split(" -> ") : [body])
    .map((s) => normalizePath(unquote(s)));
}

function submodulePaths() {
  if (!fs.existsSync(".gitmodules")) return [];
  const out = [];
  for (const m of fs.readFileSync(".gitmodules", "utf8").matchAll(/^\s*path\s*=\s*(.+)$/gm)) {
    out.push(normalizePath(m[1]));
  }
  return out;
}

// ---------------------------------------------------------------- gate

function gateFail(check, reason, details = {}) {
  console.log(JSON.stringify({ ok: false, check, reason, ...details }));
  process.exit(2);
}

function runGate(specPathArg) {
  if (!specPathArg) { console.error("gate: --spec <path> required"); process.exit(1); }
  const root = git("rev-parse", "--show-toplevel");
  process.chdir(root);

  let config;
  try { config = loadConfig(); } catch (err) { gateFail("config", String(err.message || err)); }

  const specPath = normalizePath(specPathArg);
  if (!fs.existsSync(specPath)) gateFail("spec", `spec file not found: ${specPath}`);
  const specText = fs.readFileSync(specPath, "utf8");
  const spec = parseSpec(specText);
  if (!spec.taskId) gateFail("spec", "spec has no '**Task ID**:' entry in Meta");
  if (!spec.touch.length) gateFail("spec", "spec's Touch table is empty or unparseable");

  // Routing law (§3.1 check 4): a keep-hinted spec never dispatches.
  if ((spec.modelHint || "").toLowerCase() === "keep") {
    gateFail("routing",
      `spec ${spec.taskId} is 'Model hint: keep' — security-routed work must go to a KEEP implementer, never DELEGATE`);
  }

  // Clean baseline except pipeline allowlist (§3.1 check 2, §2 decision 3).
  const allowlist = [".lanes", config.tasks_dir, config.plans_dir, config.ledger];
  const dirty = [];
  for (const line of git("status", "--porcelain").split("\n")) {
    if (!line.trim()) continue;
    for (const p of statusPaths(line)) {
      if (!matchAny(allowlist, p)) dirty.push(p);
    }
  }
  if (dirty.length) {
    gateFail("clean_baseline",
      "working tree is not clean — commit or stash these before dispatching so every post-task diff is attributable to the delegate",
      { dirty });
  }

  // Security gate + path hygiene on every Touch path (§3.1 check 5, §6).
  const submodules = submodulePaths();
  for (const t of spec.touch) {
    const p = normalizePath(t);
    if (path.isAbsolute(p) || /(^|\/)\.\.(\/|$)/.test(p)) {
      gateFail("security_gate", `Touch path escapes the repo: ${t}`);
    }
    const sub = matchAny(submodules, p);
    if (sub) gateFail("security_gate", `Touch path is inside submodule '${sub}': ${t}`);
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) {
      const real = normalizePath(fs.realpathSync(p)).toLowerCase();
      if (!real.startsWith(normalizePath(root).toLowerCase() + "/")) {
        gateFail("security_gate", `Touch path is a symlink resolving outside the repo: ${t}`);
      }
    }
    for (const [list, patterns] of [["security_routed", config.security_routed], ["do_not_touch", config.do_not_touch]]) {
      const hit = matchAny(patterns, p);
      if (hit) {
        gateFail("security_gate",
          `Touch path '${t}' matches ${list} pattern '${hit}' — this task must be routed KEEP, not dispatched`,
          { path: p, list, pattern: hit });
      }
    }
  }

  // Record the baseline (§5).
  const taskFile = spec.taskId.replace(/[^A-Za-z0-9._-]/g, "_");
  const state = {
    task: spec.taskId,
    spec_path: specPath,
    spec_sha256: sha256(specText),
    base_sha: git("rev-parse", "HEAD"),
    dispatched_at: new Date().toISOString(),
  };
  fs.mkdirSync(".lanes/state", { recursive: true });
  const statePath = `.lanes/state/${taskFile}.json`;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, task: spec.taskId, base_sha: state.base_sha, state_path: statePath }));
}
```

And extend the CLI dispatch — change:

```js
  if (cmd === "selftest") runSelftest();
  else {
```

to:

```js
  if (cmd === "selftest") runSelftest();
  else if (cmd === "gate") runGate(argOf("--spec"));
  else {
```

- [ ] **Step 2: Build the gate fixture repo and run the four scenarios**

Run with the Bash tool (`LANES` = this repo's path in POSIX form, e.g. `/s/Lanes`):

```bash
set -e
LANES="$(pwd)"
FIX="${TMPDIR:-/tmp}/lanes-gate-fixture"
rm -rf "$FIX" && mkdir -p "$FIX" && cd "$FIX"
git init -q && git config user.email t@t && git config user.name t
mkdir -p .lanes src docs/superpowers/tasks
cat > .lanes/config.md <<'EOF'
security_routed:
  - src/auth.ts
  - prisma/migrations/**

do_not_touch:
  - pnpm-lock.yaml

tasks_dir: docs/superpowers/tasks
plans_dir: docs/superpowers/plans
ledger: .superpowers/sdd/progress.md
EOF
printf 'export {}\n' > src/util.ts
git add -A && git commit -qm init
cat > docs/superpowers/tasks/T01.md <<'EOF'
## Meta
- **Task ID**: T01
- **Model hint**: luna

## Files

### Touch
| Path | Action | Notes |
|------|--------|-------|
| `src/util.ts` | modify | x |
EOF

echo "--- scenario A: clean dispatch (spec file itself is allowlisted-dirty) -> ok:true, exit 0"
node "$LANES/bin/lanes-validate.mjs" gate --spec docs/superpowers/tasks/T01.md; echo "exit=$?"
cat .lanes/state/T01.json

echo "--- scenario B: security-routed Touch -> security_gate, exit 2"
sed 's|src/util.ts|src/auth.ts|' docs/superpowers/tasks/T01.md > docs/superpowers/tasks/T02.md
sed -i 's|Task ID\*\*: T01|Task ID**: T02|' docs/superpowers/tasks/T02.md
node "$LANES/bin/lanes-validate.mjs" gate --spec docs/superpowers/tasks/T02.md || echo "exit=$?"

echo "--- scenario C: keep hint -> routing, exit 2"
sed 's|Model hint\*\*: luna|Model hint**: keep|' docs/superpowers/tasks/T01.md > docs/superpowers/tasks/T03.md
node "$LANES/bin/lanes-validate.mjs" gate --spec docs/superpowers/tasks/T03.md || echo "exit=$?"

echo "--- scenario D: dirty tree outside allowlist -> clean_baseline, exit 2"
printf '// wip\n' >> src/util.ts
node "$LANES/bin/lanes-validate.mjs" gate --spec docs/superpowers/tasks/T01.md || echo "exit=$?"
git -C "$FIX" checkout -q -- src/util.ts
```

Expected: A prints `{"ok":true,"task":"T01",...}` + a state file with `base_sha`; B prints `check:"security_gate"` naming pattern `src/auth.ts`; C prints `check:"routing"`; D prints `check:"clean_baseline"` with `dirty:["src/util.ts"]`. B/C/D exit 2.

- [ ] **Step 3: Run selftest for regressions**

Run: `node bin/lanes-validate.mjs selftest` — still exit 0.

- [ ] **Step 4: Commit**

```bash
git add bin/lanes-validate.mjs
git commit -m "feat: gate subcommand — pre-dispatch check + baseline capture (scope gate, task 4)"
```

---

### Task 5: `audit` subcommand

**Files:**
- Modify: `bin/lanes-validate.mjs`

**Interfaces:**
- Consumes: Task 4's `git`, `sha256`, state file; Task 3's `loadConfig`, `parseSpec`; Task 1's `matchAny`.
- Produces (used by Task 7's prompts):
  - CLI: `node bin/lanes-validate.mjs audit --task <id>` — exit 0 clean / 2 violations; JSON report on stdout (§3.2):
    `{ task, base_sha, spec_modified, commits_past_base[], in_scope[], out_of_scope[], forbidden[{path,list,pattern}], allowlisted[], verdict }`.
    (`allowlisted` — pipeline-owned paths excluded from the verdict — is a refinement over the design spec's §3.2 shape; §7's prompts describe it.)

- [ ] **Step 1: Implement `audit`**

Insert below the gate section:

```js
// ---------------------------------------------------------------- audit

function runAudit(taskIdArg) {
  if (!taskIdArg) { console.error("audit: --task <id> required"); process.exit(1); }
  const root = git("rev-parse", "--show-toplevel");
  process.chdir(root);
  const config = loadConfig();

  const statePath = `.lanes/state/${taskIdArg.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
  if (!fs.existsSync(statePath)) {
    console.log(JSON.stringify({ task: taskIdArg, verdict: "violations",
      error: `no baseline state at ${statePath} — was this task dispatched through the gate?` }));
    process.exit(2);
  }
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const specText = fs.readFileSync(state.spec_path, "utf8");
  const spec = parseSpec(specText);

  // All four surfaces (§3.2): committed, staged, unstaged, untracked.
  const changed = new Set();
  const collect = (out) => {
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      const paths = /^[RC]/.test(parts[0]) ? parts.slice(1) : [parts[1]]; // renames/copies: both sides (§6.4)
      for (const p of paths) if (p) changed.add(normalizePath(p));
    }
  };
  collect(git("diff", "--name-status", `${state.base_sha}..HEAD`));
  collect(git("diff", "--name-status", "--cached"));
  collect(git("diff", "--name-status"));
  for (const p of git("ls-files", "--others", "--exclude-standard").split("\n")) {
    if (p.trim()) changed.add(normalizePath(p));
  }

  const allowlist = [".lanes", config.tasks_dir, config.plans_dir, config.ledger];
  const report = {
    task: state.task,
    base_sha: state.base_sha,
    spec_modified: sha256(specText) !== state.spec_sha256,
    commits_past_base: git("rev-list", `${state.base_sha}..HEAD`).split("\n").filter(Boolean),
    in_scope: [], out_of_scope: [], forbidden: [], allowlisted: [],
  };
  for (const p of [...changed].sort()) {
    // Deny beats allow (§6.7): forbidden wins even over the pipeline allowlist.
    const secHit = matchAny(config.security_routed, p);
    const dntHit = secHit ? null : matchAny(config.do_not_touch, p);
    if (secHit || dntHit) {
      report.forbidden.push({ path: p, list: secHit ? "security_routed" : "do_not_touch", pattern: secHit || dntHit });
    } else if (matchAny(allowlist, p)) {
      report.allowlisted.push(p);
    } else if (matchAny(spec.touch, p)) {
      report.in_scope.push(p);
    } else {
      report.out_of_scope.push(p);
    }
  }
  report.verdict =
    (report.forbidden.length || report.out_of_scope.length || report.commits_past_base.length)
      ? "violations" : "clean";
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verdict === "clean" ? 0 : 2);
}
```

And extend the CLI dispatch — change:

```js
  else if (cmd === "gate") runGate(argOf("--spec"));
  else {
```

to:

```js
  else if (cmd === "gate") runGate(argOf("--spec"));
  else if (cmd === "audit") runAudit(argOf("--task"));
  else {
```

- [ ] **Step 2: Run the audit scenarios in the fixture repo**

Continues from Task 4's fixture (re-run its Step 2 setup block first if the fixture is gone). Run with Bash:

```bash
set -e
LANES="$(pwd)"
FIX="${TMPDIR:-/tmp}/lanes-gate-fixture"
cd "$FIX"

echo "--- scenario A: no changes -> clean, exit 0"
node "$LANES/bin/lanes-validate.mjs" audit --task T01; echo "exit=$?"

echo "--- scenario B: in-scope + out-of-scope + forbidden -> violations, exit 2"
printf '// changed\n' >> src/util.ts        # in Touch -> in_scope
printf 'x\n' > src/extra.ts                 # untracked, not in Touch -> out_of_scope
printf 'lock\n' > pnpm-lock.yaml            # untracked + do_not_touch -> forbidden
node "$LANES/bin/lanes-validate.mjs" audit --task T01 || echo "exit=$?"

echo "--- scenario C: delegate commit hides changes from HEAD-diff, audit still sees them -> violations"
rm pnpm-lock.yaml src/extra.ts
git add src/util.ts && git commit -qm "delegate snuck a commit"
git status --porcelain            # empty! the old working-tree audit would report a clean tree
node "$LANES/bin/lanes-validate.mjs" audit --task T01 || echo "exit=$?"
```

Expected: A → `verdict:"clean"`. B → `in_scope:["src/util.ts"]`, `out_of_scope:["src/extra.ts"]`, `forbidden:[{path:"pnpm-lock.yaml",list:"do_not_touch",...}]`, exit 2. C → `git status` shows nothing, but the report has `commits_past_base` with one sha and `in_scope:["src/util.ts"]`, `verdict:"violations"` — this is issue #1's exact bypass, now caught.

- [ ] **Step 3: Run selftest for regressions**

Run: `node bin/lanes-validate.mjs selftest` — still exit 0.

- [ ] **Step 4: Commit**

```bash
git add bin/lanes-validate.mjs
git commit -m "feat: audit subcommand — four-surface scope report (scope gate, task 5)"
```

---

### Task 6: PreToolUse dispatch hook

**Files:**
- Create: `hooks/lanes-dispatch-gate.mjs`
- Create: `hooks/hooks.json`

**Interfaces:**
- Consumes: Task 4's `gate` CLI (spawned via `node`, cwd from the hook input).
- Produces: hook contract of §4 — allow silently, or emit `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":...}}` and exit 0.

- [ ] **Step 1: Write the hook script**

Create `hooks/lanes-dispatch-gate.mjs`:

```js
#!/usr/bin/env node
// PreToolUse hook on the DELEGATE dispatch tool (v1: mcp__codex__codex).
// Contract (design spec §4): a Lanes dispatch prompt starts with a
// "LANES-SPEC: <path>" line. With that header, run the gate and deny on
// failure (fail closed). Without it, allow untouched — this hook must
// never break unrelated codex use.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

function deny(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

const chunks = [];
for await (const c of process.stdin) chunks.push(c);

let input;
try {
  input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  process.exit(0); // unidentifiable input — cannot be tied to a Lanes dispatch
}

const prompt = String(input?.tool_input?.prompt ?? "");
const header = prompt.match(/^LANES-SPEC:[ \t]*(.+)$/m);
if (!header) process.exit(0); // not a Lanes dispatch — allow untouched

const specPath = header[1].trim();
const validator = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "lanes-validate.mjs");
try {
  execFileSync(process.execPath, [validator, "gate", "--spec", specPath], {
    encoding: "utf8",
    cwd: input.cwd || process.cwd(),
  });
  process.exit(0); // gate passed — allow
} catch (err) {
  const out = String(err.stdout || "").trim();
  let reason = "Lanes gate: validator failed to run — dispatch denied (fail closed)";
  if (out) {
    try { reason = `Lanes gate: ${JSON.parse(out).reason || out}`; }
    catch { reason = `Lanes gate: ${out}`; }
  }
  deny(reason);
}
```

- [ ] **Step 2: Register the hook**

Create `hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__codex__codex",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/lanes-dispatch-gate.mjs\""
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Test the hook script over stdin**

Fixture repo from Task 4 must exist (re-run its setup block if needed). Run with Bash:

```bash
set -e
LANES="$(pwd)"
FIX="${TMPDIR:-/tmp}/lanes-gate-fixture"
git -C "$FIX" reset -q --hard HEAD  # discard Task 5's leftovers; the hook re-runs the gate itself
cd "$FIX"  # no "cwd" field in the test inputs — the hook falls back to process.cwd()
# Note: the \n inside each prompt is written as \\n so printf emits a
# backslash-n (a JSON escape), not a raw newline (which is invalid JSON).

echo "--- A: non-Lanes codex call -> allow (no output, exit 0)"
printf '{"tool_name":"mcp__codex__codex","tool_input":{"prompt":"hello world"}}' \
  | node "$LANES/hooks/lanes-dispatch-gate.mjs"; echo "exit=$?"

echo "--- B: Lanes dispatch, clean spec -> allow (no output, exit 0)"
printf '{"tool_name":"mcp__codex__codex","tool_input":{"prompt":"LANES-SPEC: docs/superpowers/tasks/T01.md\\nspec body here"}}' \
  | node "$LANES/hooks/lanes-dispatch-gate.mjs"; echo "exit=$?"

echo "--- C: Lanes dispatch, security-routed spec -> deny JSON"
printf '{"tool_name":"mcp__codex__codex","tool_input":{"prompt":"LANES-SPEC: docs/superpowers/tasks/T02.md\\nspec body here"}}' \
  | node "$LANES/hooks/lanes-dispatch-gate.mjs"; echo "exit=$?"

echo "--- D: Lanes dispatch, nonexistent spec -> deny JSON (fail closed)"
printf '{"tool_name":"mcp__codex__codex","tool_input":{"prompt":"LANES-SPEC: docs/superpowers/tasks/NOPE.md"}}' \
  | node "$LANES/hooks/lanes-dispatch-gate.mjs"; echo "exit=$?"
```

Expected: A and B print only `exit=0`. C prints `"permissionDecision":"deny"` with the security_gate reason naming `src/auth.ts`, exit 0. D prints a deny with the spec-not-found reason, exit 0. (This is issue #2's fix demonstrated end-to-end: the security-routed dispatch is refused before any backend call.)

- [ ] **Step 4: Commit**

```bash
git add hooks/lanes-dispatch-gate.mjs hooks/hooks.json
git commit -m "feat: PreToolUse hook hard-gates DELEGATE dispatch (scope gate, task 6)"
```

---

### Task 7: Prompt updates — implementer, reviewer, emit

**Files:**
- Modify: `agents/lanes-implementer.md`
- Modify: `agents/lanes-reviewer.md`
- Modify: `commands/lanes-emit.md`

**Interfaces:**
- Consumes: the `gate`/`audit` CLIs and report fields exactly as produced in Tasks 4–5 (`verdict`, `in_scope`, `out_of_scope`, `forbidden`, `commits_past_base`, `allowlisted`), the `LANES-SPEC` header contract from Task 6, and `docs/PATH-MATCHING.md` from Task 2.
- Produces: nothing downstream — this task closes the slice.

- [ ] **Step 1: `agents/lanes-implementer.md` — Phase 1 item 1 becomes the gate run**

Replace item 1 of Phase 1 (the `**Model hint is not `keep`.**` item, lines 42–47) with:

```markdown
1. **Run the deterministic gate.** Execute (Bash):

       node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" gate --spec <spec-file-path>

   Exit 0 → the gate has verified routing (`Model hint` is not `keep`),
   the security boundary (no Touch path matches the project's
   `security_routed` / `do_not_touch` lists — matching semantics:
   `${CLAUDE_PLUGIN_ROOT}/docs/PATH-MATCHING.md`), and a clean baseline,
   and has recorded the git baseline to `.lanes/state/`. Proceed.
   Any other exit → report BLOCKED immediately with the gate's JSON
   `reason` as BLOCKED_REASON. Never second-guess a gate failure, never
   re-derive its checks by hand, and do not proceed to any other item.
   (The same gate also runs as a PreToolUse hook on the dispatch tool —
   a denied dispatch is the gate firing; report BLOCKED, do not retry.)
```

- [ ] **Step 2: `agents/lanes-implementer.md` — dispatch prompt gains the header + git prohibition**

In the Phase 2 SEAM block, replace the indented prompt prefix (the block starting `You are implementing a single scoped task.` through `<spec content>`) with:

```markdown
      LANES-SPEC: <repo-relative path to the spec file>

      You are implementing a single scoped task. The spec below is your
      complete contract. Follow it literally. Do not modify any file not
      listed under "Touch". Do not add features, options, refactors, or
      documentation beyond the spec. Never run any git command that
      writes — no commit, branch, checkout, merge, rebase, reset, stash,
      or tag. Leave every change uncommitted in the working tree; the
      controller owns git state. When done, run the Acceptance test
      command and include its output. If the spec is impossible to
      satisfy as written, stop and explain instead of improvising.

      <spec content>
```

Immediately after the existing "Do not summarize, reorder…" paragraph, add:

```markdown
  The `LANES-SPEC:` first line is the machine-readable header the
  plugin's PreToolUse hook parses to hard-gate the dispatch. Omitting it
  makes the call look like non-Lanes traffic and bypasses the gate —
  never omit or reword it.
```

- [ ] **Step 3: `agents/lanes-implementer.md` — Phase 3 items 1–2 become the audit**

Replace Phase 3 items 1 and 2 (`git status` / scope check) with:

```markdown
1. Run the deterministic audit (Bash):

       node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" audit --task <task-id>

   Its JSON report is the changed-file evidence, covering all four
   surfaces — commits past the recorded baseline, staged, unstaged, and
   untracked. Do not build the list from `git status` yourself; raw
   working-tree inspection misses delegate commits.
2. **Scope check** — read the report: every `out_of_scope` path, every
   `forbidden` path, and every entry in `commits_past_base` is a
   violation (the delegate must leave all changes uncommitted; a commit
   is a violation in itself). `allowlisted` paths are pipeline-owned
   artifacts and are not violations. Do not revert anything yourself;
   list every violation under DEVIATIONS.
```

In Phase 4's report format, change the `FILES_CHANGED:` line's comment to source from the audit:

```markdown
    FILES_CHANGED: <from the audit report (in_scope + out_of_scope + forbidden), one line each — NOT from the backend's claims>
```

- [ ] **Step 4: `agents/lanes-reviewer.md` — Input item 3 uses the recorded baseline**

Replace Input item 3 with:

```markdown
3. Optionally, an explicit commit range for the task's changes
   (e.g. `abc1234..def5678`). If absent, the review range is
   `<base_sha>..working tree`, where `base_sha` comes from the task's
   baseline record `.lanes/state/<task-id>.json` (written by the
   dispatch gate). Only if that state file is also missing may you fall
   back to HEAD vs working tree — and say so in your verdict, because
   any commit the delegate made would be invisible to that fallback.
```

- [ ] **Step 5: `agents/lanes-reviewer.md` — Phase 2 consumes the audit**

Replace Phase 2's opening paragraph and the two indented git commands with:

```markdown
Build the changed-file list yourself by running the deterministic audit
(never from the report's FILES_CHANGED — that's a claim; this is the
evidence):

    node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" audit --task <task-id>

The report covers all four surfaces: commits past the recorded baseline,
staged, unstaged, and untracked. Path-vs-pattern matching is computed by
the audit per `${CLAUDE_PLUGIN_ROOT}/docs/PATH-MATCHING.md` — do not
re-derive glob matches by judgment. For the diff content itself, use
`git diff <base_sha>` (and `git diff <base_sha>..HEAD` when
`commits_past_base` is non-empty).
```

Then add a new item before the current item 1 (renumbering the existing items 1–3 to 2–4):

```markdown
1. **Any commit past `base_sha` is a violation in itself.** The
   controller owns git state; the delegate must leave every change
   uncommitted. A delegate commit is an automatic FIX at minimum, and
   REJECT if any committed path is `forbidden`. (`allowlisted` paths in
   the report are pipeline-owned artifacts — spec files, state, ledger —
   and are not scope violations.)
```

- [ ] **Step 6: `commands/lanes-emit.md` — retire the uncommitted-specs warning**

Replace Step 6 item 5 (the "Reminder to the user" about committing specs before dispatch) with:

```markdown
5. **Reminder to the user**: dispatch order must respect Depends on.
   (Uncommitted spec files under `tasks_dir` are fine — the dispatch
   gate's baseline allowlist covers pipeline-owned paths, and the audit
   reports them as `allowlisted`, never as scope violations.)
```

- [ ] **Step 7: Consistency pass**

Grep the three edited files plus `templates/TEMPLATE.md` for `git status` / `git diff --stat` references that contradict the new audit flow (`templates/TEMPLATE.md` needs no edit in this slice — its Reviewer Checklist items are restated, not contradicted). Verify every `lanes-validate.mjs` invocation in prompts uses `${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs` and the subcommand/flag names exactly as implemented (`gate --spec`, `audit --task`).

- [ ] **Step 8: Commit**

```bash
git add agents/lanes-implementer.md agents/lanes-reviewer.md commands/lanes-emit.md
git commit -m "feat: prompts consume the deterministic gate/audit (scope gate, task 7)"
```

---

## Post-plan verification (manual, by Ken)

Not a task — a checklist for first real use, since hook registration can only be proven inside a live Claude Code session with the plugin loaded:

1. Reload the plugin, then run any non-Lanes codex call — must behave exactly as before (hook passes through).
2. Dispatch a real spec whose Touch list includes a `security_routed` path — the tool call must be denied with the `Lanes gate:` reason.
3. If the hook doesn't fire at all, check `claude --debug` hook logs and the `hooks/hooks.json` registration against current plugin-hooks docs.
