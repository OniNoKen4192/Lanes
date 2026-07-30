// Behavioral conformance suite for bin/lanes-validate.mjs.
// Spawns the validator against fixture git repos (never imports it — see
// tests/helpers.mjs). Implements the assertion table in the Task 1 brief
// (docs/superpowers/specs — spec §4) verbatim: test names, statuses, JSON
// fields and values below are normative, not illustrative.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
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

describe("gate: refuses contract sections hidden below the amendments marker", () => {
  const spec = "# TASK: x\n## Meta\n- **Parent plan**: docs/plans/p.md\n"
    + "## Amendments\n"
    + FIXTURE_SPEC;
  const fx = makeFixtureRepo({ spec });
  after(() => fx.cleanup());

  test("gate: refuses contract sections hidden below the amendments marker", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(r.status, 2);
    assert.equal(r.json.check, "spec");
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

describe("audit: mid-body amendments marker trips spec_modified", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("audit: mid-body amendments marker trips spec_modified", () => {
    const g = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(g.status, 0);

    const specPath = path.join(fx.dir, "docs", "tasks", "T1.md");
    const tampered = fs.readFileSync(specPath, "utf8").replace("### Touch", "## Amendments\n\n### Touch");
    fs.writeFileSync(specPath, tampered);

    const r = validate(fx.dir, "audit", "--task", "T1");
    assert.equal(r.status, 2);
    assert.equal(r.json.spec_modified, true);
  });
});

describe("audit: appended amendments do not trip spec_modified", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("audit: appended amendments do not trip spec_modified", () => {
    const g = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(g.status, 0);

    fs.appendFileSync(
      path.join(fx.dir, "docs", "tasks", "T1.md"),
      "\n## Amendments\n\n### A1 — 2026-07-25 — accepted deviation\n- **Deviation**: example\n",
    );
    fs.appendFileSync(path.join(fx.dir, "src", "lib", "thing.js"), "// edited\n");

    const r = validate(fx.dir, "audit", "--task", "T1");
    assert.equal(r.status, 0);
    assert.equal(r.json.verdict, "clean");
    assert.equal(r.json.spec_modified, false);
    assert.equal(r.json.spec_appendix_modified, true);
  });
});

describe("audit: body edit plus amendments still trips spec_modified", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("audit: body edit plus amendments still trips spec_modified", () => {
    const g = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(g.status, 0);

    const specPath = path.join(fx.dir, "docs", "tasks", "T1.md");
    const tampered = fs.readFileSync(specPath, "utf8").replace("## Meta", "## Meta\n<!-- tampered -->")
      + "\n## Amendments\n\n### A1 — 2026-07-25 — accepted deviation\n- **Deviation**: example\n";
    fs.writeFileSync(specPath, tampered);

    const r = validate(fx.dir, "audit", "--task", "T1");
    assert.equal(r.status, 2);
    assert.equal(r.json.verdict, "violations");
    assert.equal(r.json.spec_modified, true);
  });
});

describe("audit: pre-amended spec round-trips clean", () => {
  const spec = FIXTURE_SPEC
    + "\n## Amendments\n\n### A1 — 2026-07-25 — accepted deviation\n- **Deviation**: prior\n";
  const fx = makeFixtureRepo({ spec });
  after(() => fx.cleanup());

  test("audit: pre-amended spec round-trips clean", () => {
    const g = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(g.status, 0);

    const r1 = validate(fx.dir, "audit", "--task", "T1");
    assert.equal(r1.status, 0);
    assert.equal(r1.json.verdict, "clean");
    assert.equal(r1.json.spec_modified, false);
    assert.equal(r1.json.spec_appendix_modified, false);

    fs.appendFileSync(
      path.join(fx.dir, "docs", "tasks", "T1.md"),
      "\n### A2 — 2026-07-25 — accepted deviation\n- **Deviation**: another\n",
    );

    const r2 = validate(fx.dir, "audit", "--task", "T1");
    assert.equal(r2.status, 0);
    assert.equal(r2.json.verdict, "clean");
    assert.equal(r2.json.spec_modified, false);
    assert.equal(r2.json.spec_appendix_modified, true);
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
    assert.ok(r.json.checks.commands.commands.every((c) => ["pass", "warn"].includes(c.status)));
  });
});

describe("gate: valid automation block accepted", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.automation = { level: "roundabout", max_fix_rounds: 3 };
  } });
  after(() => fx.cleanup());

  test("gate: valid automation block accepted", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.equal(r.status, 0);
    assert.equal(r.json.ok, true);
  });
});

describe("gate: bad automation level refused", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.automation = { level: "yolo" };
  } });
  after(() => fx.cleanup());

  test("gate: bad automation level refused", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.notEqual(r.status, 0);
    assert.ok((r.stdout + r.stderr).includes("automation.level"),
      `expected an automation.level error, got: ${r.stdout} ${r.stderr}`);
  });
});

describe("gate: legacy conveyor level names the rename", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.automation = { level: "conveyor" };
  } });
  after(() => fx.cleanup());

  test("gate: legacy conveyor level names the rename", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.notEqual(r.status, 0);
    assert.ok(r.json.reason.includes('renamed to "roundabout"'),
      `expected the conveyor→roundabout rename hint, got: ${r.json.reason}`);
  });
});

describe("gate: unknown automation key refused", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.automation = { level: "manual", turbo: true };
  } });
  after(() => fx.cleanup());

  test("gate: unknown automation key refused", () => {
    const r = validate(fx.dir, "gate", "--spec", "docs/tasks/T1.md");
    assert.notEqual(r.status, 0);
    assert.ok((r.stdout + r.stderr).includes("automation.turbo"),
      `expected an unknown-key error naming automation.turbo, got: ${r.stdout} ${r.stderr}`);
  });
});

describe("doctor: reports declared automation level", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => {
    c.automation = { level: "roundabout" };
  } });
  after(() => fx.cleanup());

  test("doctor: reports declared automation level", () => {
    const r = validate(fx.dir, "doctor");
    assert.equal(r.json.automation.level, "roundabout");
    assert.equal(r.json.automation.max_fix_rounds, 2);
  });
});

describe("doctor: absent automation block reports manual", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("doctor: absent automation block reports manual", () => {
    const r = validate(fx.dir, "doctor");
    assert.equal(r.json.automation.level, "manual");
    assert.equal(r.json.automation.max_fix_rounds, 2);
    assert.deepEqual(r.json.attention, []);
  });
});

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

describe("doctor: failover_tiers reported when declared", () => {
  const fx = makeFixtureRepo({ patchConfig: (c) => { c.backend.failover_tiers = ["opus", "sonnet", "haiku"]; } });
  after(() => fx.cleanup());

  test("doctor: failover_tiers reported when declared", () => {
    const r = validate(fx.dir, "doctor");
    assert.equal(r.status, 0);
    assert.deepEqual(r.json.failover_tiers, ["opus", "sonnet", "haiku"]);
  });
});

describe("doctor: failover_tiers normalized to [] when absent", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("doctor: failover_tiers normalized to [] when absent", () => {
    const r = validate(fx.dir, "doctor");
    assert.equal(r.status, 0);
    assert.deepEqual(r.json.failover_tiers, []);
  });
});

describe("seed --check: pointer line when a seed exists", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("seed --check: pointer line when a seed exists", () => {
    fs.writeFileSync(path.join(fx.dir, ".lanes", "seed.md"), "# Seed — 2026-07-26\n\n**HEAD at close:** abc1234\n");
    const r = validate(fx.dir, "seed", "--check");
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "A rest-stop seed from 2026-07-26 exists — read .lanes/seed.md to resume.");
  });
});

describe("seed --check: silent and exit 0 when absent", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("seed --check: silent and exit 0 when absent", () => {
    const r = validate(fx.dir, "seed", "--check");
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "");
  });
});

describe("seed --check: exit 0 outside a git repo", () => {
  test("seed --check: exit 0 outside a git repo", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-norepo-"));
    try {
      const r = validate(dir, "seed", "--check");
      assert.equal(r.status, 0);
      assert.equal(r.stdout.trim(), "");
      assert.equal(r.stderr.trim(), "");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("seed --check: mtime fallback when heading unparseable", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("seed --check: mtime fallback when heading unparseable", () => {
    fs.writeFileSync(path.join(fx.dir, ".lanes", "seed.md"), "no heading here\n");
    const r = validate(fx.dir, "seed", "--check");
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /^A rest-stop seed from \d{4}-\d{2}-\d{2} exists — read \.lanes\/seed\.md to resume\.$/);
  });
});
