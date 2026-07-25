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
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8").replaceAll("\r\n", "\n");
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
    return { status: 0, stdout, stderr: "", json: tryParse(stdout) };
  } catch (err) {
    const stdout = String(err.stdout || "");
    const stderr = String(err.stderr || "");
    return { status: err.status ?? -1, stdout, stderr, json: tryParse(stdout) };
  }
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
