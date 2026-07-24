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
