# Per-Task Worktree Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Controller-owned per-task git worktrees for DELEGATE work — deterministic create/remove subcommands, state relocation to the main tree, hook support for the `LANES-WORKTREE` header, and the prose that threads the worktree through implementer and reviewer.

**Architecture:** Two new `bin/lanes-validate.mjs` subcommands (`worktree create|remove`) plus a `mainRepoRoot()` state relocation; the PreToolUse hook gains optional-second-header parsing with a registered-worktree membership check; agents/skill/README prose thread the path. Dual-mode: without a worktree nothing changes.

**Tech Stack:** Plain Node ESM (zero deps), Markdown prompt files, node:test.

**Design spec:** `docs/superpowers/specs/2026-07-25-worktree-isolation-design.md` (§ numbers below refer to it).

## Global Constraints

- Zero dependencies; validator stays single-file; hook stays single-file.
- Dual-mode invariant: with no worktree in play, `gate`/`audit`/hook behavior is byte-for-byte today's (state path aside, which resolves identically in a normal repo).
- State files ALWAYS live at `<mainRepoRoot>/.lanes/state/` (§2) — never in a linked worktree.
- Worktree conventions are fixed: path `.lanes/worktrees/<sanitized-task-id>`, branch `lanes/<sanitized-task-id>`, ignore entry `.lanes/worktrees/` in `.git/info/exclude` (never a tracked file).
- Fail closed everywhere: unknown/unregistered `LANES-WORKTREE` → deny; worktree/branch collisions → exit 2; `remove` without `--force` surfaces git's uncommitted-changes refusal as exit 2.
- No config schema change; no change to the five-status taxonomy, MATCH_VECTORS, or the matcher.
- `node bin/lanes-validate.mjs selftest` and bare `node --test` green at every task's commit (suite grows from 26 to 33 with Task 2).

---

### Task 1: Validator — state relocation + `worktree create` / `worktree remove`

**Files:**
- Modify: `bin/lanes-validate.mjs`

**Interfaces:**
- Produces: `mainRepoRoot()`; `runWorktreeCreate(specPathArg)`; `runWorktreeRemove(taskIdArg, force)`; CLI `worktree create --spec <p>` / `worktree remove --task <id> [--force]`. JSON outputs per spec §3/§4 (Task 2's tests consume the exact field names `ok, task, path, branch, base_sha` and `ok, task, removed, branch, branch_removed`).

- [ ] **Step 1: Add `mainRepoRoot()` and relocate state paths**

Insert immediately after the `sha256` function in the git section:

```js
// The repo root that owns .lanes/state: in a linked worktree, the MAIN
// working tree's root; in a normal repo, the toplevel itself. Baseline
// records must live outside the delegate's writable sandbox (design
// spec 2026-07-25-worktree-isolation §2).
function mainRepoRoot() {
  return path.resolve(git("rev-parse", "--git-common-dir"), "..");
}
```

In `runGate`, replace:

```js
  fs.mkdirSync(".lanes/state", { recursive: true });
  const statePath = `.lanes/state/${taskFile}.json`;
```

with:

```js
  const stateDir = path.join(mainRepoRoot(), ".lanes", "state");
  fs.mkdirSync(stateDir, { recursive: true });
  const statePath = path.join(stateDir, `${taskFile}.json`);
```

(The trailing `console.log` already prints `state_path: statePath` — unchanged; it now prints an absolute path in worktree mode, which is correct and unambiguous.)

In `runAudit`, replace:

```js
  const statePath = `.lanes/state/${taskIdArg.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
```

with:

```js
  const statePath = path.join(mainRepoRoot(), ".lanes", "state", `${taskIdArg.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
```

- [ ] **Step 2: Add the worktree section** (immediately after the doctor section, before the CLI banner):

```js
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
  const spec = parseSpec(fs.readFileSync(specPath, "utf8"));
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
  // Anything dispatch needs that is uncommitted in the main tree is
  // missing from the fresh checkout — copy it in (spec + config only;
  // both are on the gate's baseline allowlist).
  const wtSpec = path.join(wtPath, specPath);
  if (!fs.existsSync(wtSpec)) {
    fs.mkdirSync(path.dirname(wtSpec), { recursive: true });
    fs.copyFileSync(specPath, wtSpec);
  }
  const wtConfig = path.join(wtPath, ".lanes", "config.json");
  if (!fs.existsSync(wtConfig)) {
    fs.mkdirSync(path.dirname(wtConfig), { recursive: true });
    fs.copyFileSync(path.join(".lanes", "config.json"), wtConfig);
  }
  console.log(JSON.stringify({ ok: true, task: spec.taskId, path: wtPath, branch, base_sha }));
}

function runWorktreeRemove(taskIdArg, force) {
  if (!taskIdArg) { console.error("worktree remove: --task <id> required"); process.exit(1); }
  const root = git("rev-parse", "--show-toplevel");
  process.chdir(root);
  const taskFile = taskIdArg.replace(/[^A-Za-z0-9._-]/g, "_");
  const wtPath = `.lanes/worktrees/${taskFile}`;
  const branch = `lanes/${taskFile}`;
  if (!fs.existsSync(wtPath)) wtFail(`no worktree at ${wtPath}`);
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
```

- [ ] **Step 3: CLI wiring** — replace:

```js
  if (cmd === "selftest") runSelftest();
  else if (cmd === "gate") runGate(argOf("--spec"));
  else if (cmd === "audit") runAudit(argOf("--task"));
  else if (cmd === "doctor") runDoctor();
  else {
    console.error("usage: lanes-validate.mjs <gate --spec <path> | audit --task <id> | doctor | selftest>");
```

with:

```js
  if (cmd === "selftest") runSelftest();
  else if (cmd === "gate") runGate(argOf("--spec"));
  else if (cmd === "audit") runAudit(argOf("--task"));
  else if (cmd === "doctor") runDoctor();
  else if (cmd === "worktree" && rest[0] === "create") runWorktreeCreate(argOf("--spec"));
  else if (cmd === "worktree" && rest[0] === "remove") runWorktreeRemove(argOf("--task"), rest.includes("--force"));
  else {
    console.error("usage: lanes-validate.mjs <gate --spec <path> | audit --task <id> | doctor | worktree create --spec <path> | worktree remove --task <id> [--force] | selftest>");
```

- [ ] **Step 4: Verify** — `node bin/lanes-validate.mjs selftest` (green, counts unchanged) and bare `node --test` (26/26 — existing suite must not regress; state relocation is identity in a normal repo). Quick manual smoke in a throwaway fixture repo (git init + valid config + spec): `worktree create --spec …` exits 0 and prints the JSON; `worktree remove --task …` removes it. Include the smoke output in the report.

- [ ] **Step 5: Commit** — `git add bin/lanes-validate.mjs && git commit -m "feat: worktree create/remove subcommands; state records live in the main tree"`

---

### Task 2: Conformance tests `tests/worktree.test.mjs`

**Files:**
- Create: `tests/worktree.test.mjs`

**Interfaces:**
- Consumes: `makeFixtureRepo`, `validate`, `FIXTURE_SPEC` from `tests/helpers.mjs`. For worktree-cwd runs, call `validate(path.join(fx.dir, ".lanes", "worktrees", "T2"), ...)`.

- [ ] **Step 1: Write the tests** — binding assertion list (spec §7), one fixture per `describe`, cleaned in `after()` (note: remove worktrees via the subcommand or `rmSync` — `makeFixtureRepo.cleanup()` already force-removes the whole temp dir, which suffices):

| Test | Setup | Assert |
|---|---|---|
| `worktree create: golden + uncommitted spec copy` | default fixture; write an UNCOMMITTED second spec `docs/tasks/T2.md` (FIXTURE_SPEC with Task ID `T1`→`T2`) | `worktree create --spec docs/tasks/T2.md` (cwd fixture root): status 0; json `ok, task "T2", path ".lanes/worktrees/T2", branch "lanes/T2"`, `base_sha` 40-hex; dir `<fx>/.lanes/worktrees/T2` exists; `git branch --list lanes/T2` non-empty; `<fx>/.git/info/exclude` contains `.lanes/worktrees/`; copied spec exists at `<fx>/.lanes/worktrees/T2/docs/tasks/T2.md` |
| `worktree create: no clobber` | after a successful create | second `worktree create --spec docs/tasks/T2.md`: status 2, `json.check === "worktree"`, reason mentions `already exists` |
| `gate in worktree: state lands in main repo` | created T2 worktree | `gate --spec docs/tasks/T2.md` with cwd = worktree: status 0; `<fx>/.lanes/state/T2.json` exists (main repo); `<worktree>/.lanes/state` does NOT exist |
| `gate in worktree: dirty main tree does not block` | created worktree; write stray `<fx>/src/stray.js` (uncommitted, main tree) | gate (cwd worktree): status 0 — the payoff assertion |
| `audit in worktree: in-scope clean` | gated worktree; append to `<worktree>/src/lib/thing.js` | `audit --task T2` (cwd worktree): status 0, verdict `clean`, `in_scope` includes `src/lib/thing.js` |
| `audit in worktree: delegate commit flagged` | gated worktree; edit + `git -C <worktree> add -A && commit` | audit (cwd worktree): status 2, verdict `violations`, `commits_past_base.length === 1` |
| `worktree remove: refuses dirty, --force succeeds` | created worktree with an uncommitted edit inside it | `worktree remove --task T2` (cwd fixture root): status 2, reason mentions `--force`; then with `--force`: status 0, `json.removed`, dir gone |

Implementation notes (binding): derive the T2 spec via `FIXTURE_SPEC.replace("**Task ID**: T1", "**Task ID**: T2")`; when several tests need their own fixture+worktree, build a small local `setup()` that returns `{ fx, wt }` — do NOT share one fixture across describes. Gate-in-worktree tests must pass the worktree path as `validate`'s cwd argument. Path assertions normalize `\` to `/`.

- [ ] **Step 2: Run** — bare `node --test`: 33/33 pass (26 + 7). Selftest green.

- [ ] **Step 3: Commit** — `git add tests/worktree.test.mjs && git commit -m "test: worktree lifecycle conformance — create/gate/audit/remove in isolation"`

---

### Task 3: Hook — `LANES-WORKTREE` header

**Files:**
- Modify: `hooks/lanes-dispatch-gate.mjs`

- [ ] **Step 1: Replace the main try block.** Replace:

```js
try {
  const prompt = String(input?.tool_input?.prompt ?? "");
  const header = prompt.match(/^LANES-SPEC:[ \t]*(.+?)[ \t]*(?:\r?\n|$)/);
  if (!header) process.exit(0); // not a Lanes dispatch — allow untouched

  const specPath = header[1];
  const validator = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "lanes-validate.mjs");
  try {
    execFileSync(process.execPath, [validator, "gate", "--spec", specPath], {
      encoding: "utf8",
      cwd: input.cwd || process.cwd(),
      timeout: 30_000,
    });
```

with:

```js
try {
  const prompt = String(input?.tool_input?.prompt ?? "");
  const header = prompt.match(/^LANES-SPEC:[ \t]*(.+?)[ \t]*(?:\r?\n|$)/);
  if (!header) process.exit(0); // not a Lanes dispatch — allow untouched

  const specPath = header[1];
  // Optional second header line (design spec 2026-07-25-worktree-isolation
  // §5): LANES-WORKTREE names the controller-created worktree; the gate
  // then runs THERE. The path must be a registered worktree of this repo
  // — a prompt must not be able to point the gate at an arbitrary
  // directory carrying a permissive config. Fail closed throughout.
  const wtHeader = prompt.match(/^LANES-SPEC:[^\n]*\n[ \t]*LANES-WORKTREE:[ \t]*(.+?)[ \t]*(?:\r?\n|$)/);
  let gateCwd = input.cwd || process.cwd();
  if (wtHeader) {
    const canon = (p) => {
      const abs = path.resolve(gateCwd, p).replace(/[\\/]+$/, "");
      return process.platform === "win32" ? abs.toLowerCase() : abs;
    };
    let listed;
    try {
      listed = execFileSync("git", ["-C", gateCwd, "worktree", "list", "--porcelain"], {
        encoding: "utf8",
        timeout: 30_000,
      });
    } catch {
      deny("Lanes gate: cannot enumerate worktrees — dispatch denied (fail closed)");
    }
    const registered = listed
      .split(/\r?\n/)
      .filter((l) => l.startsWith("worktree "))
      .map((l) => canon(l.slice("worktree ".length)));
    const target = canon(wtHeader[1]);
    if (!registered.includes(target)) {
      deny(`Lanes gate: LANES-WORKTREE is not a registered worktree of this repo: ${wtHeader[1]}`);
    }
    gateCwd = path.resolve(gateCwd, wtHeader[1]);
  }
  const validator = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "lanes-validate.mjs");
  try {
    execFileSync(process.execPath, [validator, "gate", "--spec", specPath], {
      encoding: "utf8",
      cwd: gateCwd,
      timeout: 30_000,
    });
```

Also update the hook's top-of-file comment: replace

```js
// Contract (design spec §4): a Lanes dispatch prompt's FIRST LINE is a
// "LANES-SPEC: <path>" header. With that header, run the gate and deny on
// failure (fail closed). Without it, allow untouched — this hook must
```

with

```js
// Contract (scope-gate spec §4 + worktree spec §5): a Lanes dispatch
// prompt's FIRST LINE is a "LANES-SPEC: <path>" header, optionally
// followed by "LANES-WORKTREE: <path>" on line 2 (gate runs in that
// worktree after a registered-worktree membership check). With the
// header, run the gate and deny on failure (fail closed). Without it,
// allow untouched — this hook must
```

- [ ] **Step 2: Node syntax check + manual verification** — `node --check hooks/lanes-dispatch-gate.mjs`. Then a scripted stdin simulation from a throwaway fixture repo with a created worktree: pipe `{"tool_input":{"prompt":"LANES-SPEC: docs/tasks/T2.md\nLANES-WORKTREE: .lanes/worktrees/T2\n\n<spec>"},"cwd":"<fixture>"}` into the hook and expect exit 0 with no deny output (gate passes in the worktree); pipe a variant with `LANES-WORKTREE: /tmp` and expect a deny JSON naming the unregistered worktree; pipe a headerless prompt and expect silent exit 0. Include the three outputs in the report.

- [ ] **Step 3: Run** bare `node --test` (33/33) + selftest.

- [ ] **Step 4: Commit** — `git add hooks/lanes-dispatch-gate.mjs && git commit -m "feat: hook honors LANES-WORKTREE header with registered-worktree check"`

---

### Task 4: Prose — thread the worktree through implementer, reviewer, skill, README

**Files:**
- Modify: `agents/lanes-implementer.md`, `agents/lanes-reviewer.md`, `skills/lanes/SKILL.md`, `README.md`

All edits are exact old → new replacements. The old text is current post-#5 text (config references already say `.lanes/config.json`).

- [ ] **Step 1: `agents/lanes-implementer.md`** — five edits:

(1) After the Input paragraph — replace:

```
Read it first. If you were invoked with prose instead of a spec file path,
report BLOCKED immediately — you do not accept freehand tasks.
```

with:

```
Read it first. If you were invoked with prose instead of a spec file path,
report BLOCKED immediately — you do not accept freehand tasks.

**Worktree mode.** The dispatcher may also hand you a worktree path — a
per-task isolation workspace it created with `lanes-validate.mjs worktree
create` (checked out at `.lanes/worktrees/<task-id>`, branch
`lanes/<task-id>`, clean at the recorded base). When it does, that
worktree is the working root for EVERYTHING: the Phase 1 gate, the
acceptance red-check, the dispatch, and every Phase 3 verification
command run from inside it, and the spec path is worktree-relative. The
baseline record still lands in the main repo's `.lanes/state/` — the
validator handles that placement itself; never write there. Without a
worktree path, work at the session root exactly as described below.
```

(2) Phase 1 item 1 — replace:

```
1. **Run the deterministic gate.** Execute (Bash):
```

with:

```
1. **Run the deterministic gate.** Execute (Bash; in worktree mode run it
   from inside the worktree — `cd <worktree> && …`):
```

(3) The prompt-prefix literal — replace:

```
      LANES-SPEC: <repo-relative path to the spec file>

      You are implementing a single scoped task.
```

with:

```
      LANES-SPEC: <repo-relative path to the spec file>
      LANES-WORKTREE: <worktree path — worktree mode ONLY; omit this
        line entirely otherwise, and make the spec path worktree-relative
        when you include it>

      You are implementing a single scoped task.
```

(4) The header explainer — replace:

```
  The `LANES-SPEC:` first line is the machine-readable header the
  plugin's PreToolUse hook parses to hard-gate the dispatch. Omitting it
  makes the call look like non-Lanes traffic and bypasses the gate —
  never omit or reword it.
```

with:

```
  The `LANES-SPEC:` first line is the machine-readable header the
  plugin's PreToolUse hook parses to hard-gate the dispatch. Omitting it
  makes the call look like non-Lanes traffic and bypasses the gate —
  never omit or reword it. In worktree mode the `LANES-WORKTREE:` second
  line is equally load-bearing: the hook verifies it against
  `git worktree list` and runs the gate inside that worktree — omitting
  it would gate (and demand a clean baseline from) the wrong tree.
```

(5) Parameters bullet — replace:

```
  fact, not a judgment call this agent makes per-task.
```

with:

```
  fact, not a judgment call this agent makes per-task. In worktree mode,
  also set the tool's working directory (its `cwd` parameter) to the
  worktree — the delegate's sandbox is the worktree, never the main tree.
```

And (6) Phase 3 intro — replace:

```
After the backend returns, regardless of what it claims:
```

with:

```
After the backend returns, regardless of what it claims (worktree mode:
every command below runs from inside the worktree):
```

- [ ] **Step 2: `agents/lanes-reviewer.md`** — one edit. After input item 3 (ends `any commit the delegate made would be invisible to that fallback.`) — replace:

```
   back to HEAD vs working tree — and say so in your verdict, because
   any commit the delegate made would be invisible to that fallback.
```

with:

```
   back to HEAD vs working tree — and say so in your verdict, because
   any commit the delegate made would be invisible to that fallback.
4. In worktree mode, the worktree path the implementer used — the SAME
   worktree, handed to you explicitly by the dispatcher (never a fresh
   one: a second worktree would audit different state than the one the
   implementer produced). Every command you run — the audit, diffs, the
   acceptance rerun, unit/static suites, e2e — runs from inside it. The
   baseline record is found automatically; it lives in the main repo's
   `.lanes/state/`.
```

- [ ] **Step 3: `skills/lanes/SKILL.md`** — replace Section C item 3:

```
3. Dispatch each DELEGATE spec to `lanes-implementer`. Its report — spec
   path plus the report content — is then dispatched to `lanes-reviewer`.
```

with:

```
3. For each DELEGATE spec, create its isolation worktree first:
   `node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" worktree create --spec <spec-path>`
   (per-task worktree at `.lanes/worktrees/<task-id>`, branch
   `lanes/<task-id>`, clean at the recorded base). Dispatch
   `lanes-implementer` with the spec path AND the worktree path; then
   dispatch `lanes-reviewer` with the spec path, the implementer's
   report, and the SAME worktree path — implementer and reviewer must
   audit the same tree. On APPROVE: commit the work inside the worktree,
   merge `lanes/<task-id>` into your working branch, then
   `… worktree remove --task <task-id>`. On REJECT: the worktree stays
   inspectable; dispose of it with `worktree remove` (add `--force` to
   discard its uncommitted work) when done.
```

- [ ] **Step 4: `README.md`** — replace:

```
3. **Dispatch DELEGATE specs to `lanes-implementer`.** It validates the
```

with:

```
3. **Dispatch DELEGATE specs to `lanes-implementer`.** Each task runs in
   its own controller-created git worktree (`.lanes/worktrees/<task-id>`),
   so delegated work never touches your tree or another task's — and a
   dirty main tree no longer blocks dispatch. The implementer validates the
```

(then the sentence continues `spec, hands it to the configured backend verbatim, …` — adjust the joined sentence so it reads grammatically: the original line began "It validates the / spec"; the replacement ends "The implementer validates the" so the following line is unchanged).

- [ ] **Step 5: Verify** — bare `node --test` (33/33 — conformance's cross-ref test now also sees SKILL.md's new `${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs` reference, which exists) + selftest.

- [ ] **Step 6: Commit** — `git add agents/lanes-implementer.md agents/lanes-reviewer.md skills/lanes/SKILL.md README.md && git commit -m "feat: thread per-task worktrees through implementer, reviewer, skill, README"`
