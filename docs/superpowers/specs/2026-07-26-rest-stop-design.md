# Rest Stop — Design

**Date:** 2026-07-26
**Status:** Approved (design review with Ken, 2026-07-26)
**Depends on:** nothing in the pipeline — this is a session-lifecycle
command, not a dispatch-path change. It reads Lanes surfaces when they
exist and touches none of the enforcement machinery.

## 1. Problem

Session endings are ad hoc. The summary, the whiteboard triage, and
"remember where we were" all depend on someone thinking to do them, and
the durable record of WHY things were done evaporates: git log records
what changed but not the reasoning; the SDD ledgers are git-ignored
scratch that gets deleted; specs capture per-feature decisions but not
the session narrative; the whiteboard holds only futures. Coming back to
a project weeks later means git archaeology.

Two artifacts fix this, with one command that maintains both:

- **The triplog** — permanent, append-style project memory: what each
  session did, what was decided, and why.
- **The seed** — a transient resume pointer: where we left off and the
  first action to take next time.

The seed answers "what do I do right now"; the triplog answers "what
happened and why."

## 2. The command: `/lanes-rest-stop`

`commands/lanes-rest-stop.md`. Road-trip family (lanes → roundabout →
highways → rest stop). A guided close-out ritual — the human is present
by definition, so every record update is proposed and confirmed, never
silent.

**Config-optional — unique among Lanes commands.** It runs in any git
repository. Without `.lanes/config.json` it skips the Lanes-specific
findings (pipeline ledger, task worktrees) and still delivers
summarize + triplog + seed. With config, those findings join the
gather step. It is the one Lanes command useful before `/lanes-init`.

### Procedure

1. **Gather** (read-only):
   - Session commits: `git log` from the previous seed's recorded HEAD
     (`.lanes/seed.md` header) to current HEAD; if no previous seed,
     ask the human for the session's starting point (a ref or "today").
   - Working-tree state: dirty files, unpushed commits
     (`git status`, `git log @{u}..` where an upstream exists).
   - Leftover task worktrees: `.lanes/worktrees/*` (config present
     only) — each is parked or abandoned work worth surfacing.
   - `whiteboard.md` at repo root, if present: entries to triage.
   - `triplog.md` at repo root, if present (created on first run
     otherwise).
   - Uncommitted Highways run docs
     (`docs/superpowers/highways/*-run.md` untracked/modified), if any.
   - The pipeline ledger named by config, if present — for the
     session's task outcomes.
2. **Summarize.** Draft the session summary from the gathered
   evidence; present it; the human corrects it.
3. **Whiteboard triage** (only if `whiteboard.md` exists). Propose a
   disposition per entry — graduate (with destination), keep parked,
   or drop (with reason) — the human rules on each. Apply only the
   rulings.
4. **Loose ends.** Present dirty/unpushed/parked findings; for each,
   the human chooses handle-now or record-in-seed. The command never
   resolves loose ends itself.
5. **Triplog entry.** Draft it (format §3), present it, apply the
   human's corrections, prepend it to `triplog.md`.
6. **Seed.** Write `.lanes/seed.md` fresh (format §4) — replaced
   wholesale, never appended.
7. **Commit the records** locally — the touched record files only
   (`triplog.md`, `.lanes/seed.md`, `whiteboard.md` when triage
   changed it), explicit paths, one commit. **Never push.** Publishing
   is the human's decision, as everywhere in Lanes.

### Hard rules

- Every record update is confirmed by the human before it is written —
  no silent triage, no silent summary.
- Read-only outside the record files: the command never modifies
  source, specs, plans, config, or anything in `.lanes/` other than
  `seed.md`, and never touches worktrees.
- Never push to a remote.
- No `.lanes/config.json` is not a refusal — degrade to the generic
  gather set.

## 3. The triplog: `triplog.md` (repo root)

Sibling convention to `whiteboard.md`. Committed. Entries newest-first
under a short preamble that states the file's purpose. Entry format:

```markdown
## YYYY-MM-DD — <one-line session title>

**Shipped:** <commit range> — <prose summary of what landed>

**Decisions:**
- <decision>: <why — the reasoning, and what was rejected>

**Loose ends:** <parked/deferred items with paths — or "none">
```

The Decisions list is the load-bearing section: design forks taken,
adjudications made, alternatives rejected and why — mined from the
session's specs, review verdicts, and conversation, then confirmed by
the human. Entries link to spec files rather than restating them; the
triplog is the narrative index, the specs are the deep record.

First run creates the file with its preamble; every run prepends one
entry directly beneath the preamble.

## 4. The seed: `.lanes/seed.md` (rolling)

One file, replaced each rest-stop, committed as a record. Git history
is the archive of old seeds — no dated-file directory. Lean by design:

```markdown
# Seed — YYYY-MM-DD

**HEAD at close:** <sha>

**Where we left off:** <one paragraph>

**Parked:** <items with paths and reasons — or "none">

**See:** triplog.md (<date> entry) for the session narrative.

**First action on resume:** <one concrete action>
```

`HEAD at close` is load-bearing: the next rest-stop's gather step uses
it as the commit-range floor.

## 5. The pointer hook

`bin/lanes-validate.mjs` gains a `seed --check` subcommand:

- If `.lanes/seed.md` exists in the repository containing the current
  working directory: print exactly one line —
  `A rest-stop seed from <date> exists — read .lanes/seed.md to resume.`
  — where `<date>` is parsed from the seed's `# Seed — YYYY-MM-DD`
  heading (fall back to the file's mtime date if the heading is
  unparseable).
- Otherwise print nothing.
- **Exit 0 in every case** — including not-a-git-repo, unreadable
  file, or any unexpected error. This is the one deliberate exception
  to the validator's fail-closed rule: a session-start hook must never
  block or noise a session; its failure mode is silence. The
  subcommand does nothing but read and print, so failing open forfeits
  nothing the gate protects.

`hooks/hooks.json` gains a SessionStart entry invoking
`node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" seed --check`.
The existing PreToolUse entry is untouched.

The injected line is a pointer, not content: the session (or the
human) decides whether to read the seed. No automatic file reads.

## 6. Deliverables

1. **Command**: `commands/lanes-rest-stop.md` per §2.
2. **Validator**: `seed --check` subcommand per §5, wired into the CLI
   dispatch and the usage string.
3. **Hooks**: SessionStart entry in `hooks/hooks.json` per §5.
4. **Docs**: `docs/USER-GUIDE.md` — a short "Rest stops" section
   (command, triplog, seed, pointer line; existing conformance needles
   must stay true); README — one paragraph in or near the trust-ladder
   section introducing the close-out ritual and the triplog.
5. **Lanes' own records**: graduate the `### /rest-stop` whiteboard
   entry to Graduated, pointing at this spec.
6. **Tests**:
   - Validator suite: `seed --check` prints the exact pointer line
     (date parsed from heading) when a seed exists; prints nothing and
     exits 0 when absent; exits 0 outside a git repo.
   - Conformance: command-file needles (config-optional statement, the
     confirm-before-write rule, never-push, `triplog.md` and
     `.lanes/seed.md` paths, gather list items); `hooks/hooks.json`
     parses, keeps the PreToolUse entry, and carries a SessionStart
     entry naming `seed --check`; VOCAB untouched (no config schema
     change in this slice).

## 7. YAGNI — explicitly not building

- No dated seed archive; the rolling file's git history is the archive.
- No automatic triage, no automatic loose-end resolution.
- No machine-readable seed/triplog format (markdown convention only).
- No cross-project triplog aggregation.
- No auto-injection of full seed content at session start — pointer
  line only.
- No config schema changes; no changes to any existing command, agent,
  or the PreToolUse gate.
- No triplog backfill of pre-rest-stop history.
