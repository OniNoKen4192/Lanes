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
