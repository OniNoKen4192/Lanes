# Implementer Status Taxonomy Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the implementer's `STATUS: DONE` into a five-value taxonomy (`IMPLEMENTED | IMPLEMENTED_WITH_DEVIATIONS | BLOCKED | BACKEND_FAILURE | RATE_LIMITED`) and update every file that enumerates or consumes the vocabulary, in lockstep (issue #6).

**Architecture:** Prose-only change across seven markdown files in a Claude Code plugin. No code, no validator changes. Verification is a grep sweep script (bash) asserting the old token is gone and the new enumeration is byte-identical at every site that lists it. Spec: `docs/superpowers/specs/2026-07-24-status-taxonomy-design.md`.

**Tech Stack:** Markdown, bash (grep) for the verification sweep. Repo root: `s:\Lanes`. The Bash tool runs Git Bash — use forward slashes and POSIX syntax in the sweep script.

## Global Constraints

- The five-status enumeration is byte-identical wherever it is enumerated with pipes: `IMPLEMENTED | IMPLEMENTED_WITH_DEVIATIONS | BLOCKED | BACKEND_FAILURE | RATE_LIMITED` (exactly two such sites: implementer Phase 4 and TEMPLATE.md Report Format).
- `IMPLEMENTED` requires `DEVIATIONS: none`; `IMPLEMENTED_WITH_DEVIATIONS` requires a non-empty DEVIATIONS list; a mismatched pairing is a malformed report the reviewer refuses.
- Reviewer intake accepts exactly `IMPLEMENTED` and `IMPLEMENTED_WITH_DEVIATIONS`; routing on refusal: BLOCKED → planner, BACKEND_FAILURE / RATE_LIMITED → dispatcher.
- After the change, the standalone token `DONE` appears nowhere in `agents/`, `commands/`, `skills/`, `templates/`, or `README.md`. Historical documents under `docs/superpowers/` are exempt and must NOT be edited.
- No changes to `bin/`, `hooks/`, or the reviewer's APPROVE/FIX/REJECT verdict taxonomy.
- Do not use the exact pipe enumeration string inside `agents/lanes-reviewer.md` (the sweep counts pipe-enumeration sites and expects exactly 2).

---

### Task 1: Rename the status vocabulary across all seven surfaces

**Files:**
- Modify: `agents/lanes-implementer.md:159-197`
- Modify: `agents/lanes-reviewer.md:4-10,46-55`
- Modify: `templates/TEMPLATE.md:146-150`
- Modify: `skills/lanes/SKILL.md:40-44`
- Modify: `README.md:57-60`
- Modify: `templates/config.example.md:33-34`
- Test: `.superpowers/sdd/2026-07-24-status-taxonomy/sweep.sh` (git-ignored scratch — never committed)

**Interfaces:**
- Consumes: nothing from other tasks (single-task plan).
- Produces: the status vocabulary `IMPLEMENTED`, `IMPLEMENTED_WITH_DEVIATIONS`, `BLOCKED`, `BACKEND_FAILURE`, `RATE_LIMITED` — the contract every future Lanes report and reviewer intake uses.

- [ ] **Step 1: Write the failing sweep script**

Write this exact content to `.superpowers/sdd/2026-07-24-status-taxonomy/sweep.sh` (create the directory if needed):

```bash
#!/usr/bin/env bash
# Verification sweep for the status taxonomy split (issue #6).
set -u
cd "$(git rev-parse --show-toplevel)"
fail=0

# 1. The old status token is gone from plugin sources.
if grep -rnw "DONE" agents commands skills templates README.md; then
  echo "FAIL: standalone DONE token found (above)"
  fail=1
fi

# 2. The pipe enumeration is byte-identical at exactly its two sites
#    (implementer Phase 4, TEMPLATE.md Report Format).
ENUM='IMPLEMENTED | IMPLEMENTED_WITH_DEVIATIONS | BLOCKED | BACKEND_FAILURE | RATE_LIMITED'
n=$(grep -rF "$ENUM" agents commands skills templates README.md | wc -l)
if [ "$n" -ne 2 ]; then
  echo "FAIL: expected exactly 2 pipe-enumeration sites, found $n"
  grep -rnF "$ENUM" agents commands skills templates README.md
  fail=1
fi

# 3. The reviewer names all five statuses (two accepted, three routed away).
for s in IMPLEMENTED IMPLEMENTED_WITH_DEVIATIONS BLOCKED BACKEND_FAILURE RATE_LIMITED; do
  if ! grep -qw "$s" agents/lanes-reviewer.md; then
    echo "FAIL: agents/lanes-reviewer.md does not mention $s"
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then echo "SWEEP OK"; fi
exit "$fail"
```

Note (grep semantics): `-w` treats `_` as a word character, so `grep -w IMPLEMENTED` does NOT match inside `IMPLEMENTED_WITH_DEVIATIONS`, and `grep -w DONE` does not match lowercase "done" in prose.

- [ ] **Step 2: Run the sweep to verify it fails**

Run: `bash .superpowers/sdd/2026-07-24-status-taxonomy/sweep.sh`
Expected: FAIL — check 1 prints the current `DONE` occurrences (implementer Phase 4 + Hard Rules, reviewer frontmatter + Phase 1, TEMPLATE.md line 146, SKILL.md lines 41/43, README.md line 60) and check 2 reports 0 enumeration sites. Exit code 1.

- [ ] **Step 3: Rewrite `agents/lanes-implementer.md` Phase 4**

Replace this exact block (the STATUS line and the `STATUS rules` list; leave the FILES_CHANGED/TEST_OUTPUT/DEVIATIONS/BLOCKED_REASON lines and the final "Implementation done but acceptance failing" bullet's surroundings as shown):

Old text (lines 163–183):

```
    STATUS: DONE | BLOCKED | RATE_LIMITED
```

New text:

```
    STATUS: IMPLEMENTED | IMPLEMENTED_WITH_DEVIATIONS | BLOCKED | BACKEND_FAILURE | RATE_LIMITED
```

Then replace the first three `STATUS rules` bullets. Old text:

```
- **DONE** requires: acceptance passes, regression guard passes, and zero
  scope violations — OR violations exist but are fully listed under
  DEVIATIONS for the reviewer to rule on. Failing tests are never DONE.
- **RATE_LIMITED**: the `dispatch_tool`'s response matches the project's
  `ratelimit_signal` (`.lanes/config.md`) — a rate-limit / usage-cap /
  429-class error. Report immediately with the error text. Do NOT retry,
  do NOT wait, do NOT fall back to implementing it yourself — the
  dispatcher owns rerouting, and you silently coding the task defeats
  the entire point of the pipeline.
- **BLOCKED**: spec gap, environment failure, or the backend declared the
  spec unsatisfiable. Include the backend's explanation verbatim if it
  gave one.
```

New text:

```
- **IMPLEMENTED** requires ALL of: acceptance passes, regression guard
  passes, the audit verdict is `clean`, and DEVIATIONS is "none".
  Failing tests are never IMPLEMENTED.
- **IMPLEMENTED_WITH_DEVIATIONS**: acceptance and regression pass, but
  deviations exist — scope violations, interface mismatches, anything
  done differently than specified — and every one is listed under
  DEVIATIONS for the reviewer to rule on. DEVIATIONS must be non-empty;
  if it would be "none", the status is IMPLEMENTED.
- **BLOCKED**: spec gap, environment failure, or the backend declared the
  spec unsatisfiable. Include the backend's explanation verbatim if it
  gave one.
- **BACKEND_FAILURE**: the `dispatch_tool` errored or crashed and the
  response does NOT match the project's `ratelimit_signal`
  (`.lanes/config.md`). Report immediately with the error text verbatim.
  Do NOT retry, do NOT fall back to implementing it yourself — the
  dispatcher owns rerouting.
- **RATE_LIMITED**: the `dispatch_tool`'s response matches the project's
  `ratelimit_signal` (`.lanes/config.md`) — a rate-limit / usage-cap /
  429-class error. Report immediately with the error text. Do NOT retry,
  do NOT wait, do NOT fall back to implementing it yourself — the
  dispatcher owns rerouting, and you silently coding the task defeats
  the entire point of the pipeline.
```

(The final bullet — "**Implementation done but acceptance failing**" through "Never loop on fix attempts." — stays exactly as is: that case remains BLOCKED.)

Then in `# Hard Rules`, replace:

```
- Never mark DONE on the backend's word alone.
```

with:

```
- Never report either IMPLEMENTED status on the backend's word alone.
```

- [ ] **Step 4: Widen `agents/lanes-reviewer.md` intake**

In the frontmatter, replace:

```
  Reviews a COMPLETED Lanes task: a Lanes task spec (`<tasks_dir>/<task-id>.md`,
  `.lanes/config.md`) plus the implementer's report with STATUS: DONE. Use
  ONLY when handed both a task spec path and the implementer's DONE
  report. Do not use for planning, implementation, exploratory review, or
```

with:

```
  Reviews a COMPLETED Lanes task: a Lanes task spec (`<tasks_dir>/<task-id>.md`,
  `.lanes/config.md`) plus the implementer's report with STATUS
  IMPLEMENTED or IMPLEMENTED_WITH_DEVIATIONS. Use ONLY when handed both
  a task spec path and such a report. Do not use for planning,
  implementation, exploratory review, or
```

In Phase 1, replace item 2:

```
2. **Report STATUS must be DONE.** BLOCKED and RATE_LIMITED reports go
   back to the dispatcher, not to review — refuse them:

       VERDICT: REJECT
       REASON: report STATUS is <X>; only DONE work is reviewable.
         Route BLOCKED to the planner, RATE_LIMITED to the dispatcher.
```

with:

```
2. **Report STATUS must be IMPLEMENTED or IMPLEMENTED_WITH_DEVIATIONS.**
   Every other status goes back upstream, not to review — refuse it:

       VERDICT: REJECT
       REASON: report STATUS is <X>; only IMPLEMENTED or
         IMPLEMENTED_WITH_DEVIATIONS work is reviewable. Route BLOCKED
         to the planner, BACKEND_FAILURE and RATE_LIMITED to the
         dispatcher.

   The status must also match the report's DEVIATIONS field:
   IMPLEMENTED requires DEVIATIONS "none";
   IMPLEMENTED_WITH_DEVIATIONS requires a non-empty DEVIATIONS list.
   A mismatched pairing is a malformed report — refuse it the same way
   (REASON: STATUS/DEVIATIONS pairing is inconsistent; the dispatcher
   must re-run the implementer's report phase).
```

- [ ] **Step 5: Update `templates/TEMPLATE.md` Report Format**

Replace:

```
STATUS: DONE | BLOCKED | RATE_LIMITED
FILES_CHANGED: <list with one-line summary each>
TEST_OUTPUT: <last 20 lines of the acceptance command>
DEVIATIONS: <anything done differently than specified, and why — or "none">
BLOCKED_REASON: <only if BLOCKED: what was needed that the spec didn't provide>
```

with:

```
STATUS: IMPLEMENTED | IMPLEMENTED_WITH_DEVIATIONS | BLOCKED | BACKEND_FAILURE | RATE_LIMITED
FILES_CHANGED: <list with one-line summary each>
TEST_OUTPUT: <last 20 lines of the acceptance command>
DEVIATIONS: <anything done differently than specified, and why — or "none".
  IMPLEMENTED requires "none"; IMPLEMENTED_WITH_DEVIATIONS requires a
  non-empty list>
BLOCKED_REASON: <only if BLOCKED: what was needed that the spec didn't provide>
```

(The `## Implementer Validation Rules` section's "Refuse the spec (STATUS: BLOCKED, …)" prose is still correct — do not change it.)

- [ ] **Step 6: Update `skills/lanes/SKILL.md` pipeline overview**

Replace:

```
   regression, interfaces — never the backend's word alone), and reports
   `DONE` / `BLOCKED` / `RATE_LIMITED`.
4. **`lanes-reviewer`** (frontier judgment, KEEP lane). Takes a spec plus a
   `DONE` report, reruns every check itself, and returns exactly one
   verdict: `APPROVE`, `FIX` (with a delta spec), or `REJECT`.
```

with:

```
   regression, interfaces — never the backend's word alone), and reports
   `IMPLEMENTED` / `IMPLEMENTED_WITH_DEVIATIONS` / `BLOCKED` /
   `BACKEND_FAILURE` / `RATE_LIMITED`.
4. **`lanes-reviewer`** (frontier judgment, KEEP lane). Takes a spec plus an
   `IMPLEMENTED` or `IMPLEMENTED_WITH_DEVIATIONS` report, reruns every
   check itself, and returns exactly one
   verdict: `APPROVE`, `FIX` (with a delta spec), or `REJECT`.
```

- [ ] **Step 7: Update `README.md` pipeline steps**

Replace:

```
   itself (scope, acceptance, regression, interfaces — never the backend's
   word alone), and reports DONE / BLOCKED / RATE_LIMITED.
```

with:

```
   itself (scope, acceptance, regression, interfaces — never the backend's
   word alone), and reports IMPLEMENTED / IMPLEMENTED_WITH_DEVIATIONS /
   BLOCKED / BACKEND_FAILURE / RATE_LIMITED.
```

- [ ] **Step 8: Update `templates/config.example.md` rate-limit comment**

Replace:

```
response as RATE_LIMITED, so the dispatcher knows to fall back a tier
instead of reporting a false BLOCKED. -->
```

with:

```
response as RATE_LIMITED, so the dispatcher knows to fall back a tier
instead of getting a false BACKEND_FAILURE. -->
```

- [ ] **Step 9: Run the sweep to verify it passes**

Run: `bash .superpowers/sdd/2026-07-24-status-taxonomy/sweep.sh`
Expected: `SWEEP OK`, exit code 0.

- [ ] **Step 10: Commit**

```bash
git add agents/lanes-implementer.md agents/lanes-reviewer.md templates/TEMPLATE.md templates/config.example.md skills/lanes/SKILL.md README.md
git commit -m "feat: split implementer status taxonomy (issue #6)

DONE becomes IMPLEMENTED | IMPLEMENTED_WITH_DEVIATIONS; BACKEND_FAILURE
added for non-ratelimit backend errors. Reviewer intake widened in
lockstep and enforces the STATUS/DEVIATIONS pairing rule.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Do NOT `git add` the sweep script — `.superpowers/` is git-ignored scratch.
