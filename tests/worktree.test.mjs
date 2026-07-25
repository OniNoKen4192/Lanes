// Conformance suite for the worktree lifecycle: bin/lanes-validate.mjs's
// `worktree create` / `worktree remove` subcommands, plus gate/audit run
// with cwd = a linked worktree. Spawns the validator (never imports it —
// see tests/helpers.mjs). Implements the assertion table in the Task 2
// brief (docs/superpowers/sdd/2026-07-25-worktree-isolation — spec §7)
// verbatim: test names, statuses, JSON fields and values below are
// normative, not illustrative.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { makeFixtureRepo, validate, FIXTURE_SPEC } from "./helpers.mjs";

const HEX40 = /^[0-9a-f]{40}$/i;

const T2_SPEC = FIXTURE_SPEC.replace("**Task ID**: T1", "**Task ID**: T2");

// Path assertions normalize \ to / (binding note) — JSON path/branch
// fields from the validator are already forward-slash literals, but this
// keeps comparisons portable wherever we build a path ourselves.
const np = (p) => String(p).split(path.sep).join("/");

function gitC(dir, ...args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trimEnd();
}

// Fixture with an uncommitted docs/tasks/T2.md spec, optionally followed by
// a successful `worktree create`. Each describe below gets its own fixture
// (and its own worktree, when needed) rather than sharing state.
function setup(opts = {}) {
  const fx = makeFixtureRepo();
  fs.writeFileSync(path.join(fx.dir, "docs", "tasks", "T2.md"), T2_SPEC);
  let wt = null;
  if (!opts.skipCreate) {
    const r = validate(fx.dir, "worktree", "create", "--spec", "docs/tasks/T2.md");
    assert.equal(r.status, 0, `setup: worktree create failed: ${r.stdout} ${r.stderr}`);
    wt = path.join(fx.dir, ".lanes", "worktrees", "T2");
  }
  return { fx, wt };
}

describe("worktree create: golden + uncommitted spec copy", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("worktree create: golden + uncommitted spec copy", () => {
    fs.writeFileSync(path.join(fx.dir, "docs", "tasks", "T2.md"), T2_SPEC);

    const r = validate(fx.dir, "worktree", "create", "--spec", "docs/tasks/T2.md");
    assert.equal(r.status, 0);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.task, "T2");
    assert.equal(np(r.json.path), ".lanes/worktrees/T2");
    assert.equal(r.json.branch, "lanes/T2");
    assert.match(r.json.base_sha, HEX40);

    const wtDir = path.join(fx.dir, ".lanes", "worktrees", "T2");
    assert.ok(fs.existsSync(wtDir), `expected worktree dir to exist: ${wtDir}`);

    const branches = gitC(fx.dir, "branch", "--list", "lanes/T2");
    assert.ok(branches.trim().length > 0, "expected lanes/T2 branch to exist");

    const excludePath = path.join(fx.dir, ".git", "info", "exclude");
    const exclude = fs.readFileSync(excludePath, "utf8");
    assert.ok(exclude.includes(".lanes/worktrees/"), `expected exclude file to list .lanes/worktrees/, got: ${exclude}`);

    const copiedSpec = path.join(wtDir, "docs", "tasks", "T2.md");
    assert.ok(fs.existsSync(copiedSpec), `expected copied spec at ${copiedSpec}`);
  });
});

describe("worktree create: no clobber", () => {
  const { fx } = setup();
  after(() => fx.cleanup());

  test("worktree create: no clobber", () => {
    const r = validate(fx.dir, "worktree", "create", "--spec", "docs/tasks/T2.md");
    assert.equal(r.status, 2);
    assert.equal(r.json.check, "worktree");
    assert.ok(r.json.reason.includes("already exists"), `expected reason to mention 'already exists', got: ${r.json.reason}`);
  });
});

describe("gate in worktree: state lands in main repo", () => {
  const { fx, wt } = setup();
  after(() => fx.cleanup());

  test("gate in worktree: state lands in main repo", () => {
    const r = validate(wt, "gate", "--spec", "docs/tasks/T2.md");
    assert.equal(r.status, 0);
    assert.equal(r.json.ok, true);

    const statePath = path.join(fx.dir, ".lanes", "state", "T2.json");
    assert.ok(fs.existsSync(statePath), `expected main-repo state file at ${statePath}`);

    const wtStateDir = path.join(wt, ".lanes", "state");
    assert.ok(!fs.existsSync(wtStateDir), `expected no state dir inside the worktree: ${wtStateDir}`);
  });
});

describe("gate in worktree: dirty main tree does not block", () => {
  const { fx, wt } = setup();
  after(() => fx.cleanup());

  test("gate in worktree: dirty main tree does not block", () => {
    fs.writeFileSync(path.join(fx.dir, "src", "stray.js"), "export const stray = 1;\n");

    const r = validate(wt, "gate", "--spec", "docs/tasks/T2.md");
    assert.equal(r.status, 0);
  });
});

describe("audit in worktree: in-scope clean", () => {
  const { fx, wt } = setup();
  after(() => fx.cleanup());

  test("audit in worktree: in-scope clean", () => {
    const g = validate(wt, "gate", "--spec", "docs/tasks/T2.md");
    assert.equal(g.status, 0);

    fs.appendFileSync(path.join(wt, "src", "lib", "thing.js"), "// edited\n");

    const r = validate(wt, "audit", "--task", "T2");
    assert.equal(r.status, 0);
    assert.equal(r.json.verdict, "clean");
    assert.ok(r.json.in_scope.includes("src/lib/thing.js"));
  });
});

describe("audit in worktree: delegate commit flagged", () => {
  const { fx, wt } = setup();
  after(() => fx.cleanup());

  test("audit in worktree: delegate commit flagged", () => {
    const g = validate(wt, "gate", "--spec", "docs/tasks/T2.md");
    assert.equal(g.status, 0);

    fs.appendFileSync(path.join(wt, "src", "lib", "thing.js"), "// crime\n");
    gitC(wt, "add", "-A");
    gitC(wt, "commit", "-qm", "delegate crime");

    const r = validate(wt, "audit", "--task", "T2");
    assert.equal(r.status, 2);
    assert.equal(r.json.verdict, "violations");
    assert.equal(r.json.commits_past_base.length, 1);
  });
});

describe("audit ignores tampered worktree config", () => {
  const { fx, wt } = setup();
  after(() => fx.cleanup());

  test("audit ignores tampered worktree config", () => {
    const g = validate(wt, "gate", "--spec", "docs/tasks/T2.md");
    assert.equal(g.status, 0);

    // Delegate edits a security-routed file...
    fs.appendFileSync(path.join(wt, "src", "auth.ts"), "// tampered\n");

    // ...and rewrites the worktree's config copy to launder it clean.
    const permissiveConfig = {
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
      routing: { security_routed: [], do_not_touch: [] },
      pipeline: { plans_dir: "docs/plans", tasks_dir: "docs/tasks", ledger: "docs/progress.md" },
    };
    fs.writeFileSync(
      path.join(wt, ".lanes", "config.json"),
      JSON.stringify(permissiveConfig, null, 2) + "\n",
    );

    const r = validate(wt, "audit", "--task", "T2");
    assert.equal(r.status, 2);
    assert.equal(r.json.verdict, "violations");
    const hit = r.json.forbidden.find((f) => f.path === "src/auth.ts");
    assert.ok(hit, `expected src/auth.ts in forbidden, got: ${JSON.stringify(r.json.forbidden)}`);
    assert.equal(hit.list, "security_routed");
  });
});

describe("worktree create refreshes stale dispatch inputs", () => {
  const fx = makeFixtureRepo();
  after(() => fx.cleanup());

  test("worktree create refreshes stale dispatch inputs", () => {
    const mainSpecPath = path.join(fx.dir, "docs", "tasks", "T1.md");
    fs.appendFileSync(mainSpecPath, "<!-- operator edit, uncommitted -->\n");

    const r = validate(fx.dir, "worktree", "create", "--spec", "docs/tasks/T1.md");
    assert.equal(r.status, 0, `worktree create failed: ${r.stdout} ${r.stderr}`);

    const wtSpecPath = path.join(fx.dir, ".lanes", "worktrees", "T1", "docs", "tasks", "T1.md");
    assert.ok(fs.existsSync(wtSpecPath), `expected worktree spec copy at ${wtSpecPath}`);
    assert.ok(
      fs.readFileSync(mainSpecPath).equals(fs.readFileSync(wtSpecPath)),
      "expected worktree spec copy to byte-match the MAIN working copy",
    );
  });
});

describe("worktree remove prunes a manually deleted worktree", () => {
  const { fx, wt } = setup();
  after(() => fx.cleanup());

  test("worktree remove prunes a manually deleted worktree", () => {
    fs.rmSync(wt, { recursive: true, force: true });

    const r = validate(fx.dir, "worktree", "remove", "--task", "T2");
    assert.equal(r.status, 0, `expected clean prune, got: ${r.stdout} ${r.stderr}`);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.pruned, true);

    const listed = gitC(fx.dir, "worktree", "list", "--porcelain");
    assert.ok(!listed.includes(np(wt)), `expected pruned worktree to be gone from 'worktree list', got: ${listed}`);

    const r2 = validate(fx.dir, "worktree", "create", "--spec", "docs/tasks/T2.md");
    assert.equal(r2.status, 0, `expected re-create to succeed after prune: ${r2.stdout} ${r2.stderr}`);
  });
});

describe("worktree remove: refuses dirty, --force succeeds", () => {
  const { fx, wt } = setup();
  after(() => fx.cleanup());

  test("worktree remove: refuses dirty, --force succeeds", () => {
    fs.appendFileSync(path.join(wt, "src", "lib", "thing.js"), "// dirty\n");

    const r1 = validate(fx.dir, "worktree", "remove", "--task", "T2");
    assert.equal(r1.status, 2);
    assert.ok(r1.json.reason.includes("--force"), `expected reason to mention --force, got: ${r1.json.reason}`);

    const r2 = validate(fx.dir, "worktree", "remove", "--task", "T2", "--force");
    assert.equal(r2.status, 0);
    assert.ok(r2.json.removed);

    assert.ok(!fs.existsSync(wt), `expected worktree dir to be gone: ${wt}`);
  });
});

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
