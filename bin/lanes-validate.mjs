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

function matchAny(patterns, p) {
  for (const pat of patterns) if (matchesPattern(pat, p)) return pat;
  return null;
}

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
    if (!line.trim()) continue;                 // a blank line keeps the open list open
    if (line.trimStart().startsWith("#")) { currentList = null; continue; } // a heading closes it
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

## Notes
  - stray item that must NOT join any list

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

// ---------------------------------------------------------------- selftest

function runSelftest() {
  let failures = runParseChecks();
  for (const [pattern, p, expected] of MATCH_VECTORS) {
    const got = matchesPattern(pattern, p);
    if (got !== expected) {
      failures++;
      console.error(`FAIL match(${JSON.stringify(pattern)}, ${JSON.stringify(p)}) -> ${got}, expected ${expected}`);
    }
  }
  console.log(failures === 0
    ? `selftest OK (${MATCH_VECTORS.length} match vectors + parse checks)`
    : `selftest: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 2);
}

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
  const isRenameOrCopy = /[RC]/.test(line.slice(0, 2));
  return (isRenameOrCopy && body.includes(" -> ") ? body.split(" -> ") : [body])
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

// Fail-closed containment per PATH-MATCHING.md rule 5: resolve the deepest
// lstat-existing ancestor of p (following every intermediate symlink) and
// require it to stay inside the repo root. Unresolvable (e.g. dangling
// symlink) is a refusal, not a pass.
function resolvedInsideRepo(p, rootReal) {
  const lexists = (q) => { try { fs.lstatSync(q); return true; } catch { return false; } };
  let deepest = p;
  while (deepest && !lexists(deepest)) {
    const parent = path.dirname(deepest);
    if (parent === deepest) break;
    deepest = parent;
  }
  let real;
  try { real = normalizePath(fs.realpathSync(deepest)).toLowerCase(); }
  catch { return false; }
  return real === rootReal || real.startsWith(rootReal + "/");
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
  for (const line of git("status", "--porcelain", "--untracked-files=all").split("\n")) {
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
  const rootReal = normalizePath(fs.realpathSync(root)).toLowerCase();
  for (const t of spec.touch) {
    const p = normalizePath(t);
    if (path.isAbsolute(p) || p.includes(":") || /(^|\/)\.\.(\/|$)/.test(p)) {
      gateFail("security_gate", `Touch path escapes the repo: ${t}`);
    }
    const sub = matchAny(submodules, p);
    if (sub) gateFail("security_gate", `Touch path is inside submodule '${sub}': ${t}`);
    if (!resolvedInsideRepo(p, rootReal)) {
      gateFail("security_gate", `Touch path resolves outside the repo (symlink escape or unresolvable): ${t}`);
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

// ---------------------------------------------------------------- CLI

const [cmd, ...rest] = process.argv.slice(2);
function argOf(flag) {
  const i = rest.indexOf(flag);
  return i >= 0 ? rest[i + 1] : undefined;
}

try {
  if (cmd === "selftest") runSelftest();
  else if (cmd === "gate") runGate(argOf("--spec"));
  else {
    console.error("usage: lanes-validate.mjs <gate --spec <path> | audit --task <id> | selftest>");
    process.exit(1);
  }
} catch (err) {
  // fail closed: any unexpected error is a block, reported as JSON
  console.log(JSON.stringify({ ok: false, check: "error", reason: String((err && err.message) || err) }));
  process.exit(2);
}
