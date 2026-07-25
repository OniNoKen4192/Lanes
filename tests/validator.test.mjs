// Behavioral conformance suite for bin/lanes-validate.mjs.
// Spawns the validator against fixture git repos (never imports it — see
// tests/helpers.mjs). Implements the assertion table in the Task 1 brief
// (docs/superpowers/specs — spec §4) verbatim: test names, statuses, JSON
// fields and values below are normative, not illustrative.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repoRoot, makeFixtureRepo, validate, FIXTURE_SPEC } from "./helpers.mjs";

const HEX40 = /^[0-9a-f]{40}$/i;
const HEX64 = /^[0-9a-f]{64}$/i;

function readState(dir, taskId) {
  const p = path.join(dir, ".lanes", "state", `${taskId}.json`);
  assert.ok(fs.existsSync(p), `expected state file to exist: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

test("selftest passes", () => {
  const r = validate(repoRoot, "selftest");
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes("selftest OK"), `expected stdout to include "selftest OK", got: ${r.stdout}`);
});

describe("gate: golden spec passes and records state", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("gate: golden spec passes and records state", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(r.status, 0);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.task, "T1");

    const state = readState(fx.dir, "T1");
    assert.match(state.base_sha, HEX40);
    assert.ok(Array.isArray(state.touch));
    assert.ok(state.touch.includes("src/lib/thing.js"));
    assert.match(state.spec_sha256, HEX64);
  });
});

describe("audit: in-scope edit is clean", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("audit: in-scope edit is clean", () => {
    const g = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(g.status, 0);

    fs.appendFileSync(path.join(fx.dir, "src", "lib", "thing.js"), "// edited\n");

    const r = validate(fx.dir, "audit", "--task", "T1");
    assert.equal(r.status, 0);
    assert.equal(r.json.verdict, "clean");
    assert.ok(r.json.in_scope.includes("src/lib/thing.js"));
  });
});

describe("gate: keep-hinted spec refused", () => {
  const spec = FIXTURE_SPEC.replace("**Model hint**: beta", "**Model hint**: keep");
  const fx = makeFixtureRepo({ spec });
  after(() => fx.cleanup());

  test("gate: keep-hinted spec refused", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(r.status, 2);
    assert.equal(r.json.check, "routing");
  });
});

describe("gate: traversal Touch path refused", () => {
  const spec = FIXTURE_SPEC.replace(
    "| `src/lib/thing.test.js` | create | acceptance |",
    "| `src/lib/thing.test.js` | create | acceptance |\n| `../escape.js` | create | traversal |",
  );
  const fx = makeFixtureRepo({ spec });
  after(() => fx.cleanup());

  test("gate: traversal Touch path refused", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(r.status, 2);
    assert.equal(r.json.check, "security_gate");
  });
});

describe("gate: security_routed Touch refused", () => {
  const spec = FIXTURE_SPEC.replace(
    "| `src/lib/thing.test.js` | create | acceptance |",
    "| `src/lib/thing.test.js` | create | acceptance |\n| `src/auth.ts` | modify | routed |",
  );
  const fx = makeFixtureRepo({ spec });
  after(() => fx.cleanup());

  test("gate: security_routed Touch refused", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(r.status, 2);
    assert.equal(r.json.check, "security_gate");
    assert.equal(r.json.list, "security_routed");
    assert.equal(r.json.pattern, "src/auth.ts");
  });
});

describe("gate: dirty tree blocks", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("gate: dirty tree blocks", () => {
    fs.writeFileSync(path.join(fx.dir, "src", "stray.js"), "export const stray = 1;\n");
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(r.status, 2);
    assert.equal(r.json.check, "clean_baseline");
    assert.ok(r.json.dirty.includes("src/stray.js"));
  });
});

describe("audit: out-of-scope edit flagged", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("audit: out-of-scope edit flagged", () => {
    const g = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(g.status, 0);

    fs.writeFileSync(path.join(fx.dir, "src", "other.js"), "export const other = 1;\n");

    const r = validate(fx.dir, "audit", "--task", "T1");
    assert.equal(r.status, 2);
    assert.equal(r.json.verdict, "violations");
    assert.ok(r.json.out_of_scope.includes("src/other.js"));
  });
});

describe("audit: delegate commit flagged", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("audit: delegate commit flagged", () => {
    const g = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(g.status, 0);

    fs.appendFileSync(path.join(fx.dir, "src", "lib", "thing.js"), "// crime\n");
    fx.commit("delegate crime");

    const r = validate(fx.dir, "audit", "--task", "T1");
    assert.equal(r.status, 2);
    assert.equal(r.json.verdict, "violations");
    assert.equal(r.json.commits_past_base.length, 1);
  });
});

describe("audit: spec edited after dispatch flagged", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("audit: spec edited after dispatch flagged", () => {
    const g = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(g.status, 0);

    fs.appendFileSync(path.join(fx.dir, "docs", "tasks", "T1.md"), "\nEdited after dispatch.\n");

    const r = validate(fx.dir, "audit", "--task", "T1");
    assert.equal(r.status, 2);
    assert.equal(r.json.spec_modified, true);
    assert.equal(r.json.verdict, "violations");
  });
});

describe("audit: forbidden edit flagged", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("audit: forbidden edit flagged", () => {
    fs.writeFileSync(path.join(fx.dir, ".env"), "SECRET=1\n");
    fx.commit("add env");

    const g = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(g.status, 0);

    fs.appendFileSync(path.join(fx.dir, ".env"), "MORE=2\n");

    const r = validate(fx.dir, "audit", "--task", "T1");
    assert.equal(r.status, 2);
    assert.equal(r.json.verdict, "violations");
    const entry = r.json.forbidden.find((f) => f.path === ".env");
    assert.ok(entry, `expected a forbidden entry for .env, got: ${JSON.stringify(r.json.forbidden)}`);
    assert.equal(entry.list, "do_not_touch");
  });
});

describe("gate: schema-invalid config fails closed", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => { c.bogus = 1; } });
  after(() => fx.cleanup());

  test("gate: schema-invalid config fails closed", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(r.status, 2);
    assert.equal(r.json.check, "config");
    assert.ok(r.json.reason.includes("unknown key 'bogus'"), `expected reason to mention unknown key, got: ${r.json.reason}`);
  });
});

describe("doctor: schema-invalid config → not_safe, checks skipped", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => { c.bogus = 1; } });
  after(() => fx.cleanup());

  test("doctor: schema-invalid config → not_safe, checks skipped", () => {
    const r = validate(fx.dir, "doctor");
    assert.equal(r.status, 2);
    assert.equal(r.json.verdict, "not_safe");
    assert.equal(r.json.checks.schema.status, "fail");
    assert.equal(r.json.checks.globs.status, "fail");
  });
});

describe("doctor: malformed glob fails", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => { c.routing.security_routed.push("../x"); } });
  after(() => fx.cleanup());

  test("doctor: malformed glob fails", () => {
    const r = validate(fx.dir, "doctor");
    assert.equal(r.status, 2);
    assert.equal(r.json.checks.globs.status, "fail");
    const entry = r.json.checks.globs.patterns.find((p) => p.pattern === "../x");
    assert.ok(entry, `expected a patterns entry for '../x', got: ${JSON.stringify(r.json.checks.globs.patterns)}`);
    assert.ok(entry.error, "expected the '../x' entry to carry an error");
  });
});

describe("doctor: clean fixture is ok", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("doctor: clean fixture is ok", () => {
    const r = validate(fx.dir, "doctor");
    assert.equal(r.status, 0);
    assert.equal(r.json.verdict, "ok");
    const authEntry = r.json.checks.globs.patterns.find((p) => p.pattern === "src/auth.ts");
    assert.ok(authEntry, `expected a patterns entry for 'src/auth.ts', got: ${JSON.stringify(r.json.checks.globs.patterns)}`);
    assert.equal(authEntry.matches, 1);
    assert.equal(r.json.checks.commands.commands.length, 4);
  });
});
