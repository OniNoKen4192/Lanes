#!/usr/bin/env node
// lanes-validate — deterministic scope gate for the Lanes pipeline.
// Subcommands: gate --spec <path> | audit --task <id> | selftest
// Behavior spec: docs/superpowers/specs/2026-07-24-scope-gate-design.md
// Config schema: docs/superpowers/specs/2026-07-24-config-schema-design.md §2.
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

function loadConfig(rootDir = ".") {
  const p = path.join(rootDir, ".lanes", "config.json");
  if (!fs.existsSync(p)) {
    throw new Error(fs.existsSync(path.join(rootDir, ".lanes", "config.md"))
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

// The immutable contract is everything ABOVE the "## Amendments" marker
// (design spec 2026-07-25-immutable-specs §2). Amendments are an
// append-only audit trail: hashing only the body lets the appendix grow
// without tripping spec_modified, while any edit to the original
// sections still trips it.
// The tail is trimmed so a natural blank separator before the marker
// (appending "\n## Amendments" to a newline-terminated file) is not a false tamper.
function specBody(text) {
  return text.split(/^## Amendments[ \t]*$/m)[0].replace(/\s+$/, "");
}

// The appendix (marker line down) is hashed separately: the audit
// reports spec_appendix_modified as an informational field the reviewer
// rules on — a legitimate controller-applied amendment between rounds
// changes it too, so it is never a violation by itself.
function specAppendix(text) {
  const m = text.match(/^## Amendments[ \t]*$/m);
  return m ? text.slice(m.index) : "";
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
  const spec = parseSpec(SAMPLE_SPEC);
  expect("spec.taskId", spec.taskId, "DEMO.03");
  expect("spec.modelHint", spec.modelHint, "luna");
  expect("spec.touch", spec.touch, ["src/lib/example.ts", "src/lib/__tests__/example.test.ts"]);
  return failures;
}

// ---------------------------------------------------------------- selftest

function runSelftest() {
  let failures = runParseChecks() + runSchemaChecks() + runTokenizerChecks();
  for (const [pattern, p, expected] of MATCH_VECTORS) {
    const got = matchesPattern(pattern, p);
    if (got !== expected) {
      failures++;
      console.error(`FAIL match(${JSON.stringify(pattern)}, ${JSON.stringify(p)}) -> ${got}, expected ${expected}`);
    }
  }
  console.log(failures === 0
    ? `selftest OK (${MATCH_VECTORS.length} match vectors + ${SCHEMA_VECTORS.length} schema vectors + ${TOKENIZER_VECTORS.length} tokenizer vectors + parse checks)`
    : `selftest: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 2);
}

// ---------------------------------------------------------------- git

function git(...args) {
  // core.quotepath=false makes git print non-ASCII paths verbatim instead of
  // octal-escaped + quoted, so path classification sees the real names.
  return execFileSync("git", ["-c", "core.quotepath=false", ...args], { encoding: "utf8" }).trimEnd();
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// The repo root that owns .lanes/state: in a linked worktree, the MAIN
// working tree's root; in a normal repo, the toplevel itself. Baseline
// records must live outside the delegate's writable sandbox (design
// spec 2026-07-25-worktree-isolation §2).
function mainRepoRoot() {
  return path.resolve(git("rev-parse", "--git-common-dir"), "..");
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
  const rootReal = normalizePath(fs.realpathSync(root)).toLowerCase();

  let config;
  try { config = loadConfig(mainRepoRoot()); } catch (err) { gateFail("config", String(err.message || err)); }

  const specPath = normalizePath(specPathArg);
  if (!fs.existsSync(specPath)) gateFail("spec", `spec file not found: ${specPath}`);
  if (path.isAbsolute(specPath) || specPath.includes(":") || /(^|\/)\.\.(\/|$)/.test(specPath)
      || !resolvedInsideRepo(specPath, rootReal)) {
    gateFail("spec", `spec path is outside the repo: ${specPathArg}`);
  }
  const specText = fs.readFileSync(specPath, "utf8");
  const spec = parseSpec(specBody(specText));
  if (!spec.taskId) gateFail("spec", "spec has no '**Task ID**:' entry in Meta");
  if (!spec.touch.length) gateFail("spec", "spec's Touch table is empty or unparseable");

  // Routing law (§3.1 check 4): a keep-hinted spec never dispatches.
  if ((spec.modelHint || "").toLowerCase() === "keep") {
    gateFail("routing",
      `spec ${spec.taskId} is 'Model hint: keep' — security-routed work must go to a KEEP implementer, never DELEGATE`);
  }

  // Clean baseline except pipeline allowlist (§3.1 check 2, §2 decision 3).
  const allowlist = [".lanes", config.pipeline.tasks_dir, config.pipeline.plans_dir, config.pipeline.ledger];
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
    for (const [list, patterns] of [["security_routed", config.routing.security_routed], ["do_not_touch", config.routing.do_not_touch]]) {
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
    spec_sha256: sha256(specBody(specText)),
    spec_appendix_sha256: sha256(specAppendix(specText)),
    touch: spec.touch.map(normalizePath),
    base_sha: git("rev-parse", "HEAD"),
    dispatched_at: new Date().toISOString(),
  };
  const stateDir = path.join(mainRepoRoot(), ".lanes", "state");
  fs.mkdirSync(stateDir, { recursive: true });
  const statePath = path.join(stateDir, `${taskFile}.json`);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, task: spec.taskId, base_sha: state.base_sha, state_path: statePath }));
}

// ---------------------------------------------------------------- audit

function runAudit(taskIdArg) {
  if (!taskIdArg) { console.error("audit: --task <id> required"); process.exit(1); }
  const root = git("rev-parse", "--show-toplevel");
  process.chdir(root);
  const config = loadConfig(mainRepoRoot());

  const statePath = path.join(mainRepoRoot(), ".lanes", "state", `${taskIdArg.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
  if (!fs.existsSync(statePath)) {
    console.log(JSON.stringify({ task: taskIdArg, verdict: "violations",
      error: `no baseline state at ${statePath} — was this task dispatched through the gate?` }));
    process.exit(2);
  }
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (!Array.isArray(state.touch)) {
    console.log(JSON.stringify({ task: state.task, verdict: "violations",
      error: "state file has no touch snapshot — re-run gate (state predates it or was tampered)" }));
    process.exit(2);
  }
  const specText = fs.readFileSync(state.spec_path, "utf8");

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

  const allowlist = [".lanes", config.pipeline.tasks_dir, config.pipeline.plans_dir, config.pipeline.ledger];
  const report = {
    task: state.task,
    base_sha: state.base_sha,
    spec_modified: sha256(specBody(specText)) !== state.spec_sha256,
    spec_appendix_modified: sha256(specAppendix(specText)) !== (state.spec_appendix_sha256 ?? sha256("")),
    commits_past_base: git("rev-list", `${state.base_sha}..HEAD`).split("\n").filter(Boolean),
    in_scope: [], out_of_scope: [], forbidden: [], allowlisted: [],
  };
  for (const p of [...changed].sort()) {
    // Deny beats allow (§6.7): forbidden wins even over the pipeline allowlist.
    const secHit = matchAny(config.routing.security_routed, p);
    const dntHit = secHit ? null : matchAny(config.routing.do_not_touch, p);
    if (secHit || dntHit) {
      report.forbidden.push({ path: p, list: secHit ? "security_routed" : "do_not_touch", pattern: secHit || dntHit });
    } else if (matchAny(allowlist, p)) {
      report.allowlisted.push(p);
    } else if (matchAny(state.touch, p)) {
      report.in_scope.push(p);
    } else {
      report.out_of_scope.push(p);
    }
  }
  report.verdict =
    (report.forbidden.length || report.out_of_scope.length || report.commits_past_base.length || report.spec_modified)
      ? "violations" : "clean";
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verdict === "clean" ? 0 : 2);
}

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
      try { if (fs.statSync(path.join(dir, bin + ext)).isFile()) return true; } catch {}
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

// ---------------------------------------------------------------- worktree

// Controller-owned per-task isolation (design spec
// 2026-07-25-worktree-isolation §3-§4). Fixed conventions: worktree at
// .lanes/worktrees/<task>, branch lanes/<task>, ignored via
// .git/info/exclude (repo-local — never a tracked-file edit).

function wtFail(reason, details = {}) {
  console.log(JSON.stringify({ ok: false, check: "worktree", reason, ...details }));
  process.exit(2);
}

function ensureExcluded(root) {
  const excl = path.join(root, ".git", "info", "exclude");
  let text = "";
  try { text = fs.readFileSync(excl, "utf8"); } catch {}
  if (!text.split(/\r?\n/).includes(".lanes/worktrees/")) {
    fs.mkdirSync(path.dirname(excl), { recursive: true });
    fs.writeFileSync(excl, text + (text === "" || text.endsWith("\n") ? "" : "\n") + ".lanes/worktrees/\n");
  }
}

function runWorktreeCreate(specPathArg) {
  if (!specPathArg) { console.error("worktree create: --spec <path> required"); process.exit(1); }
  const root = git("rev-parse", "--show-toplevel");
  process.chdir(root);
  if (path.resolve(mainRepoRoot()) !== path.resolve(root)) {
    wtFail("worktree create must run from the main working tree, not a linked worktree");
  }
  try { loadConfig(); } catch (err) { wtFail(String(err.message || err)); }
  const specPath = normalizePath(specPathArg);
  if (!fs.existsSync(specPath)) wtFail(`spec file not found: ${specPath}`);
  const spec = parseSpec(specBody(fs.readFileSync(specPath, "utf8")));
  if (!spec.taskId) wtFail("spec has no '**Task ID**:' entry in Meta");
  const taskFile = spec.taskId.replace(/[^A-Za-z0-9._-]/g, "_");
  const branch = `lanes/${taskFile}`;
  const wtPath = `.lanes/worktrees/${taskFile}`;
  if (fs.existsSync(wtPath)) {
    wtFail(`worktree already exists: ${wtPath} — run 'worktree remove --task ${spec.taskId}' first`);
  }
  if (git("branch", "--list", branch).trim()) {
    wtFail(`branch already exists: ${branch} — integrate or delete it first`);
  }
  ensureExcluded(root);
  const base_sha = git("rev-parse", "HEAD");
  git("worktree", "add", wtPath, "-b", branch, "HEAD");
  // Snapshot dispatch inputs from the MAIN working tree into the
  // worktree, overwriting the checkout's committed versions when they
  // differ — the operator's current spec/config always win over stale
  // committed copies. Both paths are baseline-allowlisted. (The gate and
  // audit read config from the main tree regardless; the worktree copy
  // is a convenience snapshot for prose readers.)
  const syncIn = (srcRel, destAbs) => {
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    if (!fs.existsSync(destAbs)
        || !fs.readFileSync(srcRel).equals(fs.readFileSync(destAbs))) {
      fs.copyFileSync(srcRel, destAbs);
    }
  };
  syncIn(specPath, path.join(wtPath, specPath));
  syncIn(path.join(".lanes", "config.json"), path.join(wtPath, ".lanes", "config.json"));
  console.log(JSON.stringify({ ok: true, task: spec.taskId, path: wtPath, branch, base_sha }));
}

function runWorktreeRemove(taskIdArg, force) {
  if (!taskIdArg) { console.error("worktree remove: --task <id> required"); process.exit(1); }
  const root = git("rev-parse", "--show-toplevel");
  process.chdir(root);
  const taskFile = taskIdArg.replace(/[^A-Za-z0-9._-]/g, "_");
  const wtPath = `.lanes/worktrees/${taskFile}`;
  const branch = `lanes/${taskFile}`;
  if (!fs.existsSync(wtPath)) {
    // Directory manually deleted? If git still registers it, prune the
    // stale registration and fall through to branch cleanup; a task that
    // never had a worktree (no registration, no branch) is a refusal.
    const registered = git("worktree", "list", "--porcelain")
      .split(/\r?\n/)
      .filter((l) => l.startsWith("worktree "))
      .map((l) => normalizePath(l.slice("worktree ".length)).toLowerCase())
      .includes(normalizePath(path.resolve(wtPath)).toLowerCase());
    const branchExists = git("branch", "--list", branch).trim() !== "";
    if (!registered && !branchExists) wtFail(`no worktree at ${wtPath}`);
    if (registered) git("worktree", "prune");
    let branchRemoved = !branchExists;
    if (branchExists) {
      try { git("branch", "-d", branch); branchRemoved = true; } catch { branchRemoved = false; }
    }
    console.log(JSON.stringify({ ok: true, task: taskIdArg, removed: wtPath, pruned: registered, branch, branch_removed: branchRemoved }));
    return;
  }
  try {
    git("worktree", "remove", ...(force ? ["--force"] : []), wtPath);
  } catch (err) {
    wtFail(
      `git worktree remove refused (uncommitted changes? use --force to discard): ${String(err.stderr || err.message || err).trim()}`,
      { path: wtPath },
    );
  }
  let branchRemoved = true;
  try { git("branch", "-d", branch); } catch { branchRemoved = false; } // unmerged — kept deliberately
  console.log(JSON.stringify({ ok: true, task: taskIdArg, removed: wtPath, branch, branch_removed: branchRemoved }));
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
  else if (cmd === "audit") runAudit(argOf("--task"));
  else if (cmd === "doctor") runDoctor();
  else if (cmd === "worktree" && rest[0] === "create") runWorktreeCreate(argOf("--spec"));
  else if (cmd === "worktree" && rest[0] === "remove") runWorktreeRemove(argOf("--task"), rest.includes("--force"));
  else {
    console.error("usage: lanes-validate.mjs <gate --spec <path> | audit --task <id> | doctor | worktree create --spec <path> | worktree remove --task <id> [--force] | selftest>");
    process.exit(1);
  }
} catch (err) {
  // fail closed: any unexpected error is a block, reported as JSON
  console.log(JSON.stringify({ ok: false, check: "error", reason: String((err && err.message) || err) }));
  process.exit(2);
}
